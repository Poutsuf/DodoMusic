const { app, BrowserWindow, shell, Tray, Menu, Notification, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');

const debugLogPath = path.join(__dirname, 'electron-debug.log');
fs.writeFileSync(debugLogPath, `[INIT] Process started at ${new Date().toISOString()}\n`);
process.on('uncaughtException', (err) => {
    fs.appendFileSync(debugLogPath, `[CRASH] uncaughtException: ${err && (err.stack || err)}\n`);
});
process.on('unhandledRejection', (reason) => {
    fs.appendFileSync(debugLogPath, `[CRASH] unhandledRejection: ${reason && (reason.stack || reason)}\n`);
});
process.on('exit', (code) => {
    fs.appendFileSync(debugLogPath, `[PROCESS_EXIT] code: ${code}\n`);
});
process.on('beforeExit', (code) => {
    fs.appendFileSync(debugLogPath, `[BEFORE_EXIT] code: ${code}\n`);
});

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('DodoMusic.Player.v1');

let cachedScClientId = '39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ';
let lastClientIdFetch = 0;

async function getSoundCloudClientId() {
    const now = Date.now();
    if (cachedScClientId && now - lastClientIdFetch < 3600000) {
        return cachedScClientId;
    }
    try {
        const res = await fetch('https://soundcloud.com', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000),
        });
        const html = await res.text();
        const matches = html.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g) || [];
        for (const s of matches.slice(-6)) {
            const js = await (await fetch(s, { signal: AbortSignal.timeout(6000) })).text();
            const m = js.match(/client_id[:=]"([a-zA-Z0-9]{32})"/);
            if (m) {
                cachedScClientId = m[1];
                lastClientIdFetch = now;
                return cachedScClientId;
            }
        }
    } catch (_) {}
    return cachedScClientId;
}

function cleanUserQuery(rawQuery) {
    return (
        rawQuery
            .replace(/\b(скачать|песню|песня|слушать|онлайн|бесплатно|без рекламы|клип|mp3|shorts)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim() || rawQuery.trim()
    );
}

function formatDuration(sec) {
    if (!sec || isNaN(sec)) return '3:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function cleanTitleAndArtist(rawTitle, rawUser) {
    let title = (rawTitle || '').replace(/\.(mp3|wav|flac)$/i, '').trim();
    let artist = rawUser || 'Исполнитель';

    const match = title.match(/^(.+?)\s+[-—–]\s+(.+)$/);
    if (match) {
        artist = match[1].trim();
        title = match[2].trim();
    }
    return { artist, title };
}

async function searchSoundCloudFullTracks(query) {
    try {
        const cid = await getSoundCloudClientId();
        const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${cid}&limit=16`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return [];
        const data = await res.json();
        const items = data.collection || [];

        return items
            .filter((t) => t.id && t.duration >= 60000 && t.duration <= 900000 && t.media?.transcodings?.length)
            .map((t) => {
                const totalSec = Math.round(t.duration / 1000);
                const { artist, title } = cleanTitleAndArtist(t.title, t.user?.username || t.user?.name);

                let cover = t.artwork_url || t.user?.avatar_url || '/icon.png';
                cover = cover.replace('-large', '-t500x500');

                const hls = t.media.transcodings.find(
                    (tc) => tc.format?.protocol === 'hls' && tc.format?.mime_type?.includes('mp4a')
                );
                const progressive = t.media.transcodings.find((tc) => tc.format?.protocol === 'progressive');
                const selectedTc = hls || progressive || t.media.transcodings[0];

                return {
                    id: `sc_${t.id}`,
                    source: 'soundcloud',
                    title,
                    artist,
                    duration: formatDuration(totalSec),
                    durationSeconds: totalSec,
                    thumbnail: cover,
                    transcodingUrl: selectedTc?.url || '',
                    protocol: selectedTc?.format?.protocol || 'hls',
                    permalinkUrl: t.permalink_url || `https://soundcloud.com/search?q=${encodeURIComponent(artist + ' ' + title)}`,
                    isFullTrack: true,
                };
            });
    } catch (_) {
        return [];
    }
}

async function searchAudiusFullTracks(query) {
    try {
        const url = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=dodomusic`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.data || [])
            .filter((item) => item.id && item.duration >= 60 && item.duration <= 900)
            .slice(0, 8)
            .map((item) => {
                const { artist, title } = cleanTitleAndArtist(item.title, item.user?.name);
                return {
                    id: `au_${item.id}`,
                    source: 'audius',
                    title,
                    artist,
                    duration: formatDuration(item.duration),
                    durationSeconds: item.duration,
                    thumbnail: item.artwork?.['480x480'] || item.artwork?.['150x150'] || '/icon.png',
                    streamUrl: `https://api.audius.co/v1/tracks/${item.id}/stream?app_name=dodomusic`,
                    protocol: 'progressive',
                    permalinkUrl: `https://audius.co${item.permalink || ''}`,
                    isFullTrack: true,
                };
            });
    } catch (_) {
        return [];
    }
}

async function searchFullMusicTracks(rawQuery) {
    const cleanQuery = cleanUserQuery(rawQuery);
    const [scTracks, auTracks] = await Promise.all([
        searchSoundCloudFullTracks(cleanQuery),
        searchAudiusFullTracks(cleanQuery),
    ]);

    const combined = [];
    const seen = new Set();

    for (const t of [...scTracks, ...auTracks]) {
        const key = `${t.artist.toLowerCase()}__${t.title.toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            combined.push(t);
        }
    }

    return combined.slice(0, 24);
}

/**
 * Получение похожих треков / Умный автомикс (Smart Radio)
 */
async function getRelatedMusicTracks({ trackId = '', artist = '', title = '' }) {
    const results = [];
    const seenIds = new Set();
    const seenSignatures = new Set();

    if (trackId) seenIds.add(trackId);
    if (artist && title) {
        seenSignatures.add(`${artist.toLowerCase()}__${title.toLowerCase()}`);
    }

    if (trackId && trackId.startsWith('sc_')) {
        const numId = trackId.replace('sc_', '');
        try {
            const cid = await getSoundCloudClientId();
            const res = await fetch(`https://api-v2.soundcloud.com/tracks/${numId}/related?client_id=${cid}&limit=20`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
                const data = await res.json();
                for (const item of (data.collection || [])) {
                    if (!item || !item.media?.transcodings?.length) continue;
                    const durationSec = Math.round((item.duration || 0) / 1000);
                    if (durationSec < 45 || durationSec > 900) continue;

                    let itemArtist = item.user?.username || 'SoundCloud Artist';
                    let itemTitle = item.title || 'Unknown Title';
                    if (itemTitle.includes(' - ')) {
                        const parts = itemTitle.split(' - ');
                        itemArtist = parts[0].trim();
                        itemTitle = parts.slice(1).join(' - ').trim();
                    }

                    const sig = `${itemArtist.toLowerCase()}__${itemTitle.toLowerCase()}`;
                    const sid = `sc_${item.id}`;
                    if (seenIds.has(sid) || seenSignatures.has(sig)) continue;
                    seenIds.add(sid);
                    seenSignatures.add(sig);

                    const hlsStream = item.media.transcodings.find(
                        (t) => t.format?.protocol === 'hls' && t.format?.mime_type?.includes('mp4')
                    ) || item.media.transcodings.find((t) => t.format?.protocol === 'hls') || item.media.transcodings[0];

                    const artwork = item.artwork_url
                        ? item.artwork_url.replace('-large.', '-t500x500.')
                        : (item.user?.avatar_url || '');

                    results.push({
                        id: sid,
                        source: 'soundcloud',
                        title: itemTitle,
                        artist: itemArtist,
                        duration: formatDuration(durationSec),
                        durationSeconds: durationSec,
                        thumbnail: artwork,
                        transcodingUrl: hlsStream?.url || '',
                        protocol: hlsStream?.format?.protocol === 'hls' ? 'hls' : 'progressive',
                        isFullTrack: true,
                    });
                }
            }
        } catch (err) {
            console.warn('[Related SoundCloud Warning]', err.message);
        }
    }

    if (results.length < 12) {
        try {
            const queryCandidates = [];
            if (artist && artist !== 'SoundCloud Artist' && artist !== 'Audius Artist') {
                queryCandidates.push(artist);
            }
            const cleanTitleWords = title
                .replace(/[()\[\]{}_]/g, ' ')
                .replace(/\b(feat|ft|official|audio|video|prod|remix|speed up|slowed|bass boosted)\b/gi, '')
                .trim();
            if (cleanTitleWords && cleanTitleWords !== artist) {
                queryCandidates.push(cleanTitleWords);
            }

            for (const q of queryCandidates.slice(0, 2)) {
                if (results.length >= 18) break;
                const moreTracks = await searchFullMusicTracks(q);
                for (const t of moreTracks) {
                    const sig = `${(t.artist || '').toLowerCase()}__${(t.title || '').toLowerCase()}`;
                    if (!seenIds.has(t.id) && !seenSignatures.has(sig)) {
                        seenIds.add(t.id);
                        seenSignatures.add(sig);
                        results.push(t);
                    }
                }
            }
        } catch (_) {}
    }

    return results;
}

/**
 * Получение профиля артиста, его дискографии и плейлистов
 */
async function getArtistProfileAndDiscography(artistName) {
    const cid = await getSoundCloudClientId();
    const cleanName = (artistName || '').trim();
    if (!cleanName) return null;

    const isKme = cleanName.toLowerCase().includes('kme');

    let artistProfile = {
        name: isKme ? 'KME' : cleanName,
        avatar: isKme ? 'https://i1.sndcdn.com/artworks-JIp3enfT7rTm-0-t500x500.jpg' : '/icon.png',
        permalinkUrl: `https://soundcloud.com/search/people?q=${encodeURIComponent(cleanName)}`,
        followersCount: 0,
        trackCount: 0,
        verified: true,
        bio: isKme
            ? 'Официальный профиль артиста KME (kme_dota). Популярные треки «Джентльмены», «Дагон», «Slam», «Солнечный день».'
            : `Официальная дискография и релизы артиста ${cleanName}`,
    };

    let tracks = [];
    let playlists = [];

    const searchQueries = isKme ? ['kme dota', 'KME'] : [cleanName];

    for (const q of searchQueries) {
        try {
            const uRes = await fetch(
                `https://api-v2.soundcloud.com/search/users?q=${encodeURIComponent(q)}&client_id=${cid}&limit=3`,
                {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    signal: AbortSignal.timeout(6000),
                }
            );
            if (uRes.ok) {
                const uData = await uRes.json();
                const topUser = uData.collection?.[0];
                if (topUser && !isKme) {
                    artistProfile.name = topUser.username || cleanName;
                    artistProfile.avatar = topUser.avatar_url
                        ? topUser.avatar_url.replace('-large', '-t500x500')
                        : '/icon.png';
                    artistProfile.permalinkUrl = topUser.permalink_url || artistProfile.permalinkUrl;
                    artistProfile.followersCount = topUser.followers_count || 0;
                    artistProfile.trackCount = topUser.track_count || 0;
                    if (topUser.description) artistProfile.bio = topUser.description.slice(0, 300);
                }

                if (topUser?.id) {
                    try {
                        const utRes = await fetch(
                            `https://api-v2.soundcloud.com/users/${topUser.id}/tracks?client_id=${cid}&limit=30`,
                            { signal: AbortSignal.timeout(6000) }
                        );
                        if (utRes.ok) {
                            const utData = await utRes.json();
                            for (const item of utData.collection || []) {
                                if (!item || !item.media?.transcodings?.length) continue;
                                const sec = Math.round((item.duration || 0) / 1000);
                                if (sec < 45 || sec > 1200) continue;

                                const { artist, title } = cleanTitleAndArtist(item.title, topUser.username);
                                const hls =
                                    item.media.transcodings.find(
                                        (tc) =>
                                            tc.format?.protocol === 'hls' && tc.format?.mime_type?.includes('mp4a')
                                    ) || item.media.transcodings[0];

                                tracks.push({
                                    id: `sc_${item.id}`,
                                    source: 'soundcloud',
                                    title,
                                    artist: artist || cleanName,
                                    duration: formatDuration(sec),
                                    durationSeconds: sec,
                                    thumbnail: item.artwork_url
                                        ? item.artwork_url.replace('-large', '-t500x500')
                                        : artistProfile.avatar,
                                    transcodingUrl: hls?.url || '',
                                    protocol: hls?.format?.protocol || 'hls',
                                    permalinkUrl: item.permalink_url || '',
                                    isFullTrack: true,
                                });
                            }
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }

    // Дополняем прямым поиском всех треков артиста
    for (const q of searchQueries) {
        try {
            const searchTracks = await searchFullMusicTracks(q);
            const seen = new Set(tracks.map((t) => `${t.artist.toLowerCase()}__${t.title.toLowerCase()}`));
            for (const st of searchTracks) {
                const sig = `${(st.artist || '').toLowerCase()}__${(st.title || '').toLowerCase()}`;
                if (!seen.has(sig)) {
                    seen.add(sig);
                    tracks.push(st);
                }
            }
        } catch (_) {}
    }

    // Если аватар дефолтный — берем обложку самого первого трека
    if ((!artistProfile.avatar || artistProfile.avatar.includes('default_avatar')) && tracks[0]?.thumbnail) {
        artistProfile.avatar = tracks[0].thumbnail;
    }

    if (isKme) {
        tracks.sort((a, b) => {
            const aHit = a.title.toLowerCase().startsWith('джентльмены') ? 1 : 0;
            const bHit = b.title.toLowerCase().startsWith('джентльмены') ? 1 : 0;
            return bHit - aHit;
        });
    }

    return {
        artist: artistProfile,
        tracks: tracks.slice(0, 50),
    };
}

/**
 * Получение треков конкретного плейлиста или альбома
 */
async function getPlaylistTracks(playlistNumericId) {
    const cid = await getSoundCloudClientId();
    try {
        const res = await fetch(`https://api-v2.soundcloud.com/playlists/${playlistNumericId}?client_id=${cid}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        const tracks = [];
        for (const t of data.tracks || []) {
            if (!t || !t.id || !t.media?.transcodings?.length) continue;
            const sec = Math.round((t.duration || 0) / 1000);
            if (sec < 30) continue;

            const { artist, title } = cleanTitleAndArtist(t.title, t.user?.username);
            const hls =
                t.media.transcodings.find(
                    (tc) => tc.format?.protocol === 'hls' && tc.format?.mime_type?.includes('mp4a')
                ) || t.media.transcodings[0];

            tracks.push({
                id: `sc_${t.id}`,
                source: 'soundcloud',
                title,
                artist,
                duration: formatDuration(sec),
                durationSeconds: sec,
                thumbnail: t.artwork_url
                    ? t.artwork_url.replace('-large', '-t500x500')
                    : t.user?.avatar_url || '/icon.png',
                transcodingUrl: hls?.url || '',
                protocol: hls?.format?.protocol || 'hls',
                permalinkUrl: t.permalink_url || '',
                isFullTrack: true,
            });
        }
        return tracks;
    } catch (e) {
        console.warn('Playlist tracks error:', e.message);
        return [];
    }
}

/**
 * Получение треков чартов и плейлистов Chart
 */
async function getChartPlaylistTracks(playlistId = '37i9dQZF1DXcBWIGoYBM5M') {
    try {
        const res = await fetch(`https://open.chart.com/embed/playlist/${playlistId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const html = await res.text();
        const idx = html.indexOf('__NEXT_DATA__');
        if (idx === -1) return [];
        const start = html.indexOf('>', idx) + 1;
        const end = html.indexOf('</script>', start);
        const data = JSON.parse(html.slice(start, end));
        const entity = data.props?.pageProps?.state?.data?.entity;
        if (!entity || !entity.trackList) return [];

        const playlistName = entity.name || 'Chart Top Hits';

        return entity.trackList.map((t, index) => {
            const trackId = (t.uri || '').replace('chart:track:', '') || `sp_${index}`;
            const durationSec = Math.round((t.duration || 180000) / 1000);
            const mins = Math.floor(durationSec / 60);
            const secs = String(durationSec % 60).padStart(2, '0');
            return {
                id: `sp_${trackId}`,
                source: 'chart',
                title: t.title || 'Unknown Title',
                artist: t.subtitle || 'Chart Artist',
                album: playlistName,
                duration: `${mins}:${secs}`,
                durationSeconds: durationSec,
                thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop',
                previewUrl: t.audioPreview?.url || '',
                permalinkUrl: `https://open.chart.com/track/${trackId}`,
                isFullTrack: true,
                isChart: true,
            };
        });
    } catch (e) {
        console.warn('Chart playlist error:', e.message);
        return [];
    }
}

/**
 * Парсер LRC текста с таймкодами [mm:ss.xx]
 */
function parseLrc(lrcString) {
    if (!lrcString || typeof lrcString !== 'string') return [];
    const lines = lrcString.split(/\r?\n/);
    const parsed = [];
    const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        if (/^\[(ti|ar|al|au|by|offset|length|re|ve):/i.test(trimmed)) continue;

        const times = [];
        let match;
        timeRegex.lastIndex = 0;
        while ((match = timeRegex.exec(trimmed)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const msStr = (match[3] || '0').padEnd(3, '0').slice(0, 3);
            const ms = parseInt(msStr, 10);
            times.push(minutes * 60 + seconds + ms / 1000);
        }

        const text = trimmed.replace(timeRegex, '').trim();
        if (times.length > 0) {
            for (const time of times) {
                parsed.push({ time, text });
            }
        }
    }

    parsed.sort((a, b) => a.time - b.time);
    return parsed;
}

/**
 * Поиск синхронизированного или обычного текста песни
 */
async function fetchTrackLyrics(title = '', artist = '', duration = 0) {
    const cleanTitle = (title || '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/feat\..*$/i, '')
        .replace(/ft\..*$/i, '')
        .trim();
    const cleanArtist = (artist || '')
        .replace(/\(.*?\)/g, '')
        .replace(/feat\..*$/i, '')
        .replace(/ft\..*$/i, '')
        .trim();

    if (cleanTitle && cleanArtist) {
        try {
            let getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
            if (duration > 0) getUrl += `&duration=${Math.round(duration)}`;
            const res = await fetch(getUrl, {
                headers: { 'User-Agent': 'DodoMusic/1.2 (https://github.com/redmi157312/DodoMusic)' },
                signal: AbortSignal.timeout(6000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.syncedLyrics) {
                    return {
                        found: true,
                        synced: true,
                        lines: parseLrc(data.syncedLyrics),
                        plainLyrics: data.plainLyrics || '',
                        trackName: data.name,
                        artistName: data.artistName
                    };
                } else if (data.plainLyrics) {
                    return {
                        found: true,
                        synced: false,
                        lines: [],
                        plainLyrics: data.plainLyrics,
                        trackName: data.name,
                        artistName: data.artistName
                    };
                }
            }
        } catch (_) {}
    }

    const searchQueries = [
        `${cleanArtist} ${cleanTitle}`.trim(),
        cleanTitle,
        `${cleanTitle} ${cleanArtist}`.trim()
    ].filter(Boolean);

    for (const q of searchQueries) {
        try {
            const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
            const res = await fetch(searchUrl, {
                headers: { 'User-Agent': 'DodoMusic/1.2 (https://github.com/redmi157312/DodoMusic)' },
                signal: AbortSignal.timeout(6000)
            });
            if (res.ok) {
                const list = await res.json();
                if (Array.isArray(list) && list.length > 0) {
                    const best = list.find(item => item.syncedLyrics) || list[0];
                    if (best && (best.syncedLyrics || best.plainLyrics)) {
                        return {
                            found: true,
                            synced: Boolean(best.syncedLyrics),
                            lines: best.syncedLyrics ? parseLrc(best.syncedLyrics) : [],
                            plainLyrics: best.plainLyrics || '',
                            trackName: best.name,
                            artistName: best.artistName
                        };
                    }
                }
            }
        } catch (_) {}
    }

    return { found: false, synced: false, lines: [], plainLyrics: '' };
}

function startEmbeddedServer() {
    return new Promise((resolve, reject) => {
        const exp = express();
        exp.use(cors());
        exp.use(express.json());
        exp.use(express.static(path.join(__dirname, 'public')));

        exp.get('/api/resolve-stream', async (req, res) => {
            const { transcodingUrl, source, streamUrl, previewUrl, artist, title, id } = req.query;

            if (source === 'chart' || (id && String(id).startsWith('sp_'))) {
                try {
                    const query = `${artist || ''} ${title || ''}`.trim();
                    if (query) {
                        const searchResults = await searchFullMusicTracks(query);
                        if (searchResults && searchResults.length > 0) {
                            const best = searchResults[0];
                            if (best.transcodingUrl) {
                                const cid = await getSoundCloudClientId();
                                const resolved = await fetch(`${best.transcodingUrl}?client_id=${cid}`);
                                if (resolved.ok) {
                                    const data = await resolved.json();
                                    return res.json({
                                        streamUrl: data.url,
                                        protocol: best.protocol || (best.transcodingUrl.includes('/hls') ? 'hls' : 'progressive'),
                                    });
                                }
                            } else if (best.streamUrl) {
                                return res.json({
                                    streamUrl: best.streamUrl,
                                    protocol: 'progressive',
                                });
                            }
                        }
                    }
                } catch (_) {}

                if (previewUrl) {
                    return res.json({ streamUrl: previewUrl, protocol: 'progressive' });
                }
            }

            if (source === 'audius' && streamUrl) {
                return res.json({ streamUrl, protocol: 'progressive' });
            }

            if (transcodingUrl) {
                try {
                    const cid = await getSoundCloudClientId();
                    const resolved = await fetch(`${transcodingUrl}?client_id=${cid}`);
                    if (resolved.ok) {
                        const data = await resolved.json();
                        if (data.url) {
                            return res.json({
                                streamUrl: data.url,
                                protocol: transcodingUrl.includes('/hls') ? 'hls' : 'progressive',
                            });
                        }
                    }
                } catch (_) {}
            }

            // Fallback через Audius, если артист и название известны
            if (artist || title) {
                try {
                    const q = `${artist || ''} ${title || ''}`.trim();
                    const audTracks = await searchAudiusFullTracks(q);
                    if (audTracks.length > 0 && audTracks[0].streamUrl) {
                        return res.json({
                            streamUrl: audTracks[0].streamUrl,
                            protocol: 'progressive',
                        });
                    }
                } catch (_) {}
            }

            if (previewUrl) {
                return res.json({ streamUrl: previewUrl, protocol: 'progressive' });
            }

            return res.status(400).json({ error: 'Не указаны параметры потока' });
        });

        // Локальный прокси для обхода блокировок CDN / CORS на компьютерах пользователей
        exp.get('/api/stream-proxy', async (req, res) => {
            const targetUrl = req.query?.url;
            if (!targetUrl) return res.status(400).send('No url');
            try {
                const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
                if (req.headers.range) {
                    headers['Range'] = req.headers.range;
                }
                const upstream = await fetch(targetUrl, { headers });
                res.status(upstream.status);
                for (const [k, v] of upstream.headers.entries()) {
                    if (['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(k.toLowerCase())) {
                        res.setHeader(k, v);
                    }
                }
                const reader = upstream.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
                res.end();
            } catch (e) {
                if (!res.headersSent) res.status(502).send(e.message);
            }
        });

        exp.all('/api/chart-charts', async (req, res) => {
            const chart = req.query?.chart || req.body?.chart || 'top';
            const PLAYLISTS = {
                'top': '37i9dQZF1DXcBWIGoYBM5M',
                'global': '37i9dQZEVXbMDoHDwVN2tF',
                'russia': '37i9dQZF1DXcZDD7cfEKhW',
                'viral': '37i9dQZEVXbLiRSasKsNU9',
                'rap': '37i9dQZF1DX0XUsuxWHRQd',
                'dance': '37i9dQZF1DX4dyzvuaRJ0n',
            };
            const plId = PLAYLISTS[chart] || chart;
            try {
                const tracks = await getChartPlaylistTracks(plId);
                return res.json({ tracks });
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        });

        exp.post('/api/search-music', async (req, res) => {
            const userQuery = req.body?.query?.trim();
            if (!userQuery) {
                return res.status(400).json({ error: 'Поисковый запрос пуст' });
            }

            try {
                const lower = userQuery.toLowerCase();
                if (userQuery.startsWith('chart:') || lower.includes('chart') || lower.includes('спотифай')) {
                    let chartId = '37i9dQZF1DXcBWIGoYBM5M';
                    if (lower.includes('russia') || lower.includes('россия') || lower.includes('хит')) {
                        chartId = '37i9dQZF1DXcZDD7cfEKhW';
                    } else if (lower.includes('global') || lower.includes('топ 50')) {
                        chartId = '37i9dQZEVXbMDoHDwVN2tF';
                    } else if (lower.includes('viral') || lower.includes('вирус')) {
                        chartId = '37i9dQZEVXbLiRSasKsNU9';
                    }
                    const chartTracks = await getChartPlaylistTracks(chartId);
                    if (chartTracks.length > 0) {
                        return res.json({
                            cleanQuery: userQuery,
                            tracks: chartTracks,
                        });
                    }
                }

                const cleanQuery = cleanUserQuery(userQuery);
                const tracks = await searchFullMusicTracks(cleanQuery);
                return res.json({
                    cleanQuery,
                    tracks,
                });
            } catch (error) {
                return res.status(500).json({ error: error.message || 'Ошибка при поиске музыки' });
            }
        });

        exp.all('/api/related-tracks', async (req, res) => {
            const trackId = req.body?.trackId || req.query?.trackId || '';
            const artist = req.body?.artist || req.query?.artist || '';
            const title = req.body?.title || req.query?.title || '';

            try {
                const related = await getRelatedMusicTracks({ trackId, artist, title });
                return res.json({
                    trackId,
                    artist,
                    title,
                    relatedTracks: related,
                });
            } catch (err) {
                return res.status(500).json({ error: err.message || 'Ошибка рекомендаций' });
            }
        });

        exp.all('/api/artist-profile', async (req, res) => {
            const artist = req.body?.artist || req.query?.artist || '';
            if (!artist) return res.status(400).json({ error: 'Артист не указан' });

            try {
                const data = await getArtistProfileAndDiscography(artist);
                return res.json(data);
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        });

        exp.all('/api/playlist-tracks', async (req, res) => {
            const id = req.body?.id || req.query?.id || '';
            const numericId = String(id).replace('pl_', '');
            if (!numericId) return res.status(400).json({ error: 'ID плейлиста не указан' });

            try {
                const tracks = await getPlaylistTracks(numericId);
                return res.json({ tracks });
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        });

        const CURRENT_APP_VERSION = 'v1.1';

        exp.all('/api/check-update', async (req, res) => {
            const repo = (req.body?.repo || req.query?.repo || 'foridorpo-blip/DodoMusic').trim();
            try {
                const ghRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
                    headers: {
                        'User-Agent': 'DodoMusic-Desktop-v1.1',
                        'Accept': 'application/vnd.github.v3+json',
                    },
                    signal: AbortSignal.timeout(5000),
                });

                if (ghRes.ok) {
                    const data = await ghRes.json();
                    const latestTag = data.tag_name || '';
                    const latestName = data.name || '';
                    const cleanTag = latestTag.toLowerCase().trim();
                    const cleanName = latestName.toLowerCase().trim();

                    // Проверка версии
                    let hasUpdate = false;
                    const matchLatest = (latestTag + ' ' + latestName).match(/v?(\d+)\.(\d+)/);
                    if (matchLatest) {
                        const lMajor = parseInt(matchLatest[1], 10);
                        const lMinor = parseInt(matchLatest[2], 10);
                        hasUpdate = (lMajor > 1) || (lMajor === 1 && lMinor > 1);
                    } else {
                        hasUpdate = cleanTag !== 'v1.1' && cleanTag !== 'v1.0' && cleanTag !== 'dodomusic';
                    }

                    return res.json({
                        currentVersion: CURRENT_APP_VERSION,
                        latestVersion: latestName || latestTag || CURRENT_APP_VERSION,
                        hasUpdate,
                        releaseNotes: data.body || 'Новая версия доступна на GitHub.',
                        downloadUrl: data.html_url || `https://github.com/${repo}/releases`,
                        publishedAt: data.published_at,
                    });
                }
            } catch (_) {}

            return res.json({
                currentVersion: CURRENT_APP_VERSION,
                latestVersion: CURRENT_APP_VERSION,
                hasUpdate: false,
                message: 'У вас установлена актуальная версия DodoMusic (v1.1).',
                downloadUrl: `https://github.com/${repo}/releases`,
            });
        });

        exp.post('/api/system-notify', (req, res) => {
            const { title, body, icon } = req.body || {};
            try {
                if (Notification.isSupported()) {
                    const iconPath = icon || path.join(__dirname, 'public', 'icon.png');
                    const notif = new Notification({
                        title: title || 'DodoMusic v1.1',
                        body: body || '',
                        icon: iconPath,
                    });
                    notif.on('click', () => {
                        if (mainWindow) {
                            if (mainWindow.isMinimized()) mainWindow.restore();
                            mainWindow.show();
                            mainWindow.focus();
                        }
                    });
                    notif.show();
                }
                return res.json({ ok: true });
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        });

        // ПЕРМАНЕНТНАЯ БАЗА ДАННЫХ ПОЛЬЗОВАТЕЛЯ НА ДИСКЕ (ИЗБРАННОЕ И ИСТОРИЯ)
        const userDataDir = app.getPath('userData');
        if (!fs.existsSync(userDataDir)) {
            try { fs.mkdirSync(userDataDir, { recursive: true }); } catch (_) {}
        }
        const libraryPath = path.join(userDataDir, 'dodomusic_library.json');

        exp.get('/api/library', (req, res) => {
            try {
                if (fs.existsSync(libraryPath)) {
                    const content = fs.readFileSync(libraryPath, 'utf8');
                    return res.json(JSON.parse(content));
                }
            } catch (_) {}
            return res.json({ favorites: [], history: [] });
        });

        exp.post('/api/library/save', (req, res) => {
            try {
                const data = req.body || {};
                fs.writeFileSync(libraryPath, JSON.stringify(data, null, 2), 'utf8');
                return res.json({ success: true });
            } catch (err) {
                return res.status(500).json({ error: err.message });
            }
        });

        // Скачивание трека (MP3 / Audio)
        exp.get('/api/download-track', async (req, res) => {
            const { transcodingUrl, source, streamUrl, previewUrl, title, artist } = req.query;
            try {
                let finalAudioUrl = streamUrl;
                if (!finalAudioUrl && (artist || title)) {
                    const searchResults = await searchFullMusicTracks(`${artist || ''} ${title || ''}`.trim());
                    if (searchResults && searchResults[0]) {
                        const best = searchResults[0];
                        if (best.transcodingUrl) {
                            const cid = await getSoundCloudClientId();
                            const resolved = await fetch(`${best.transcodingUrl}?client_id=${cid}`);
                            if (resolved.ok) {
                                const data = await resolved.json();
                                finalAudioUrl = data.url;
                            }
                        } else if (best.streamUrl) {
                            finalAudioUrl = best.streamUrl;
                        }
                    }
                }
                if (!finalAudioUrl && transcodingUrl) {
                    const cid = await getSoundCloudClientId();
                    const resolved = await fetch(`${transcodingUrl}?client_id=${cid}`);
                    if (resolved.ok) {
                        const data = await resolved.json();
                        finalAudioUrl = data.url;
                    }
                }
                if (!finalAudioUrl && previewUrl) {
                    finalAudioUrl = previewUrl;
                }
                if (!finalAudioUrl) {
                    return res.status(400).send('Ссылка на трек недоступна для скачивания');
                }

                return res.redirect(finalAudioUrl);
            } catch (err) {
                return res.status(500).send(err.message);
            }
        });

        exp.get('/api/lyrics', async (req, res) => {
            const title = req.query.title || '';
            const artist = req.query.artist || '';
            const duration = parseFloat(req.query.duration || '0');

            try {
                const lyrics = await fetchTrackLyrics(title, artist, duration);
                return res.json(lyrics);
            } catch (err) {
                console.error('Error fetching lyrics:', err);
                return res.status(500).json({ error: err.message || 'Ошибка поиска текста' });
            }
        });

        // ФИКСИРОВАННЫЙ ПОРТ ДЛЯ СОХРАНЕНИЯ ОРИДЖИНА LOCALSTORAGE
        const PREFERRED_PORT = 58240;
        const srv = http.createServer(exp);

        srv.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                const fallback = http.createServer(exp);
                fallback.listen(0, '127.0.0.1', () => {
                    resolve({ server: fallback, port: fallback.address().port });
                });
                fallback.on('error', reject);
            } else {
                reject(err);
            }
        });

        srv.listen(PREFERRED_PORT, '127.0.0.1', () => {
            resolve({ server: srv, port: PREFERRED_PORT });
        });
    });
}

let mainWindow = null;
let serverInstance = null;
let tray = null;

function setupSystemTray() {
    try {
        const iconPath = path.join(__dirname, 'public', 'icon.png');
        if (!fs.existsSync(iconPath)) return;
        if (tray) return;

        tray = new Tray(iconPath);
        tray.setToolTip('DodoMusic v1.1');

        const contextMenu = Menu.buildFromTemplate([
            { label: 'DodoMusic v1.1', enabled: false },
            { type: 'separator' },
            {
                label: 'Показать / Скрыть плеер',
                click: () => {
                    if (!mainWindow) return;
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                },
            },
            {
                label: 'Пауза / Воспроизведение',
                click: () => {
                    if (mainWindow) {
                        mainWindow.webContents.executeJavaScript(`
                            if (window.audioPlayer) {
                                if (window.audioPlayer.paused) window.audioPlayer.play();
                                else window.audioPlayer.pause();
                            }
                        `);
                    }
                },
            },
            {
                label: 'Следующий трек',
                click: () => {
                    if (mainWindow) {
                        mainWindow.webContents.executeJavaScript(`
                            if (typeof window.playNext === 'function') window.playNext();
                        `);
                    }
                },
            },
            {
                label: 'Предыдущий трек',
                click: () => {
                    if (mainWindow) {
                        mainWindow.webContents.executeJavaScript(`
                            if (typeof window.playPrev === 'function') window.playPrev();
                        `);
                    }
                },
            },
            { type: 'separator' },
            {
                label: 'Выход',
                click: () => {
                    app.isQuitting = true;
                    app.quit();
                },
            },
        ]);

        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
            if (!mainWindow) return;
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        });
    } catch (err) {
        fs.appendFileSync(debugLogPath, `[TRAY_ERROR] ${err.message}\n`);
    }
}

async function createWindow() {
    fs.appendFileSync(debugLogPath, `[CREATE_WINDOW] Starting embedded server...\n`);
    const { server, port } = await startEmbeddedServer();
    serverInstance = server;
    fs.appendFileSync(debugLogPath, `[CREATE_WINDOW] Embedded server running on port ${port}\n`);

    const icoPath = path.join(__dirname, 'public', 'icon.ico');
    const pngIconPath = path.join(__dirname, 'public', 'icon.png');
    const iconFilePath = fs.existsSync(icoPath) ? icoPath : pngIconPath;
    const appIcon = nativeImage.createFromPath(iconFilePath);

    const winOptions = {
        width: 1320,
        height: 840,
        useContentSize: true,
        minWidth: 980,
        minHeight: 660,
        title: 'DodoMusic',
        backgroundColor: '#07080c',
        autoHideMenuBar: true,
        icon: appIcon,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    };

    mainWindow = new BrowserWindow(winOptions);
    try {
        mainWindow.setIcon(appIcon);
    } catch (_) {}
    fs.appendFileSync(debugLogPath, `[CREATE_WINDOW] BrowserWindow created\n`);

    setupSystemTray();
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        fs.appendFileSync(debugLogPath, `[RENDERER_GONE] reason: ${details.reason}, exitCode: ${details.exitCode}\n`);
    });
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        fs.appendFileSync(debugLogPath, `[LOAD_FAILED] code: ${errorCode}, desc: ${errorDescription}\n`);
    });
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        fs.appendFileSync(debugLogPath, `[CONSOLE] (${level}) ${message} [${sourceId}:${line}]\n`);
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
    fs.appendFileSync(debugLogPath, `[CREATE_WINDOW] loadURL called\n`);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    mainWindow.on('close', (e) => {
        fs.appendFileSync(debugLogPath, `[WINDOW_CLOSE] mainWindow close event\n`);
    });
    mainWindow.on('closed', () => {
        fs.appendFileSync(debugLogPath, `[WINDOW_CLOSED] mainWindow closed event\n`);
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('will-quit', (e) => {
    fs.appendFileSync(debugLogPath, `[APP] will-quit event\n`);
});

app.on('quit', (e, exitCode) => {
    fs.appendFileSync(debugLogPath, `[APP] quit event, exitCode: ${exitCode}\n`);
});

app.on('window-all-closed', () => {
    fs.appendFileSync(debugLogPath, `[APP] window-all-closed fired\n`);
    if (serverInstance) {
        try {
            serverInstance.close();
        } catch (_) {}
    }
    app.quit();
});
