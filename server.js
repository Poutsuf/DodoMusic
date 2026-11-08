import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(os.homedir(), '.env') });
dotenv.config({ path: path.join(__dirname, '.env'), override: false });

export const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Кэш SoundCloud client_id
let cachedScClientId = '39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ';
let lastClientIdFetch = 0;

export async function getSoundCloudClientId() {
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
    } catch (e) {
        console.warn('SoundCloud client_id refresh warning:', e.message);
    }
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

/**
 * 1. Поиск полных песен на SoundCloud (3-6 минут, полные треки)
 */
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

                // Ищем предпочтительный поток: HLS AAC (лучшее качество) или progressive MP3
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
    } catch (e) {
        console.warn('SoundCloud search error:', e.message);
        return [];
    }
}

/**
 * 2. Поиск полных треков в Audius (полные MP3-потоки без ограничений)
 */
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

/**
 * Объединенный поиск полных песен (FULL-LENGTH)
 */
export async function searchFullMusicTracks(rawQuery) {
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
export async function getRelatedMusicTracks({ trackId = '', artist = '', title = '' }) {
    const results = [];
    const seenIds = new Set();
    const seenSignatures = new Set();

    if (trackId) seenIds.add(trackId);
    if (artist && title) {
        seenSignatures.add(`${artist.toLowerCase()}__${title.toLowerCase()}`);
    }

    // 1. Если это SoundCloud трек, опрашиваем официальный SoundCloud Related Tracks API
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

    // 2. Дополнительные рекомендации по исполнителю или похожим запросам
    if (results.length < 14) {
        try {
            const queryCandidates = [];
            if (artist && artist !== 'SoundCloud Artist' && artist !== 'Audius Artist') {
                queryCandidates.push(artist);
            }

            for (const q of queryCandidates.slice(0, 2)) {
                if (results.length >= 20) break;
                const moreTracks = await searchFullMusicTracks(q);
                for (const t of moreTracks) {
                    const sig = `${(t.artist || '').toLowerCase()}__${(t.title || '').toLowerCase()}`;
                    // Не добавляем копии и ремиксы одного и того же трека
                    const isSameTitle = title && t.title.toLowerCase().includes(title.toLowerCase().slice(0, 6));
                    if (!seenIds.has(t.id) && !seenSignatures.has(sig) && !isSameTitle) {
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
 * Эндпоинт разрешения потока (получает полную прямую ссылку на трек)
 */
app.get('/api/resolve-stream', async (req, res) => {
    const { transcodingUrl, source, streamUrl, previewUrl, artist, title, id } = req.query;

    if (source === 'spotify' || (id && String(id).startsWith('sp_'))) {
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

    // Резервная попытка через Audius, если артист и трек указаны
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

// Локальный потоковый прокси
app.get('/api/stream-proxy', async (req, res) => {
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

/**
 * Получение треков чартов и плейлистов Chart
 */
export async function getChartPlaylistTracks(playlistId = '37i9dQZF1DXcBWIGoYBM5M') {
    try {
        const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
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
            const trackId = (t.uri || '').replace('spotify:track:', '') || `sp_${index}`;
            const durationSec = Math.round((t.duration || 180000) / 1000);
            const mins = Math.floor(durationSec / 60);
            const secs = String(durationSec % 60).padStart(2, '0');
            return {
                id: `sp_${trackId}`,
                source: 'spotify',
                title: t.title || 'Unknown Title',
                artist: t.subtitle || 'Chart Artist',
                album: playlistName,
                duration: `${mins}:${secs}`,
                durationSeconds: durationSec,
                thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop',
                previewUrl: t.audioPreview?.url || '',
                permalinkUrl: `https://open.spotify.com/track/${trackId}`,
                isFullTrack: true,
                isChart: true,
            };
        });
    } catch (e) {
        console.warn('Chart playlist error:', e.message);
        return [];
    }
}

app.all('/api/spotify-charts', async (req, res) => {
    const chart = req.query?.chart || req.body?.chart || 'top';
    const PLAYLISTS = {
        'top': '37i9dQZF1DXcBWIGoYBM5M',     // Today's Top Hits
        'global': '37i9dQZEVXbMDoHDwVN2tF',  // Top 50 Global
        'russia': '37i9dQZF1DXcZDD7cfEKhW',  // Hot Hits Russia / CIS
        'viral': '37i9dQZEVXbLiRSasKsNU9',   // Viral 50 Global
        'rap': '37i9dQZF1DX0XUsuxWHRQd',     // RapCaviar
        'dance': '37i9dQZF1DX4dyzvuaRJ0n',   // Dance Hits
    };
    const plId = PLAYLISTS[chart] || chart;
    try {
        const tracks = await getChartPlaylistTracks(plId);
        return res.json({ tracks });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/search-music', async (req, res) => {
    const userQuery = req.body?.query?.trim();
    if (!userQuery) {
        return res.status(400).json({ error: 'Поисковый запрос пуст' });
    }

    try {
        const lower = userQuery.toLowerCase();
        if (userQuery.startsWith('spotify:') || lower.includes('spotify') || lower.includes('спотифай')) {
            let chartId = '37i9dQZF1DXcBWIGoYBM5M';
            if (lower.includes('russia') || lower.includes('россия') || lower.includes('хит')) {
                chartId = '37i9dQZF1DXcZDD7cfEKhW';
            } else if (lower.includes('global') || lower.includes('топ 50')) {
                chartId = '37i9dQZEVXbMDoHDwVN2tF';
            } else if (lower.includes('viral') || lower.includes('вирус')) {
                chartId = '37i9dQZEVXbLiRSasKsNU9';
            }
            const spotifyTracks = await getChartPlaylistTracks(chartId);
            if (spotifyTracks.length > 0) {
                return res.json({
                    cleanQuery: userQuery,
                    tracks: spotifyTracks,
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

app.all('/api/related-tracks', async (req, res) => {
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

const ARTIST_CLUSTERS = {
    phonk: ['DVRST', 'Kordhell', 'Ghostface Playa', 'SXMPRA', 'INTERWORLD', 'Dxrk ダーク', 'Pharmacist', 'Hensonn', 'green orxnge', 'g3ox_em'],
    rap_ru: ['Miyagi & Эндшпиль', 'MACAN', 'KME', 'Big Baby Tape', 'Kizaru', 'OG Buda', 'Платина', 'Friendly Thug 52 NGG', 'Скриптонит', 'SALUKI', 'Toxi$', 'Shadowraze', 'Markul'],
    pop_ru: ['JONY', 'HammAli & Navai', 'ANNA ASTI', 'Mary Gu', 'Три Дня Дождя', 'Zivert', 'Ramil\'', 'Xcho', 'Dabro', 'INSTASAMKA', 'Кравц', 'Моя Мишель', 'Гио Пика'],
    global_hits: ['The Weeknd', 'Post Malone', 'Travis Scott', 'Billie Eilish', 'Dua Lipa', 'Drake', 'Kendrick Lamar', 'Metro Boomin', 'Playboi Carti', 'Eminem', 'Arctic Monkeys'],
    rock_alt: ['Три Дня Дождя', 'Король и Шут', 'Полматери', 'Linkin Park', 'Skillet', 'Nirvana', 'Green Day', 'NЮ', 'Кино', 'Би-2'],
    chill_lofi: ['Lofi Girl', 'Idealism', 'Kupla', 'Kudasaibeats', 'Jinsang', 'potsu', 'Shiloh Dynasty']
};

function detectTrackGenre(title = '', artist = '') {
    const combined = `${artist} ${title}`.toLowerCase();
    if (combined.includes('phonk') || combined.includes('drift') || combined.includes('dvrst') || combined.includes('kordhell') || combined.includes('cowbell')) return 'phonk';
    if (combined.includes('rock') || combined.includes('рок') || combined.includes('metal') || combined.includes('панк') || combined.includes('дождя') || combined.includes('шут') || combined.includes('skillet') || combined.includes('linkin')) return 'rock_alt';
    if (combined.includes('lofi') || combined.includes('lo-fi') || combined.includes('chill') || combined.includes('ambient') || combined.includes('relax') || combined.includes('sleep') || combined.includes('study')) return 'chill_lofi';
    if (combined.includes('weeknd') || combined.includes('travis') || combined.includes('drake') || combined.includes('scott') || combined.includes('eilish') || combined.includes('post malone') || combined.includes('eminem')) return 'global_hits';
    if (combined.includes('miyagi') || combined.includes('эндшпиль') || combined.includes('macan') || combined.includes('kme') || combined.includes('buda') || combined.includes('tape') || combined.includes('kizaru') || combined.includes('платина') || combined.includes('рэп') || combined.includes('rap') || combined.includes('trap')) return 'rap_ru';
    return 'pop_ru';
}

export async function generateTasteAdaptiveWave({ seedTrack = {}, tasteProfile = {} }) {
    const results = [];
    const seenIds = new Set();
    const seenSignatures = new Set();

    const dislikedIds = new Set(tasteProfile.dislikedIds || []);
    const seedId = seedTrack.id || '';
    if (seedId) seenIds.add(seedId);

    const seedTitle = (seedTrack.title || '').trim();
    const seedArtist = (seedTrack.artist || '').trim();
    const seedSig = `${seedArtist.toLowerCase()}__${seedTitle.toLowerCase()}`;
    if (seedArtist && seedTitle) seenSignatures.add(seedSig);

    // 1. Определение жанра семенного трека
    const genre = detectTrackGenre(seedTitle, seedArtist);
    const cluster = ARTIST_CLUSTERS[genre] || ARTIST_CLUSTERS.pop_ru;

    // 2. Прямые рекомендации по семенному треку
    try {
        const directRelated = await getRelatedMusicTracks({
            trackId: seedTrack.id,
            artist: seedArtist,
            title: seedTitle
        });
        for (const t of directRelated) {
            const sig = `${(t.artist || '').toLowerCase()}__${(t.title || '').toLowerCase()}`;
            if (!seenIds.has(t.id) && !dislikedIds.has(t.id) && !seenSignatures.has(sig)) {
                if (seedTitle && t.title.toLowerCase().includes(seedTitle.toLowerCase().slice(0, 7))) continue;
                seenIds.add(t.id);
                seenSignatures.add(sig);
                results.push(t);
            }
        }
    } catch (e) {
        console.warn('[Taste Wave Direct Related Warning]', e.message);
    }

    // 3. Анализ вкуса пользователя и подбор похожих артистов
    const candidateArtists = [];

    // Добавляем 2-3 похожих артистов из кластера жанра
    const filteredCluster = cluster.filter(a => !a.toLowerCase().includes(seedArtist.toLowerCase()) && !seedArtist.toLowerCase().includes(a.toLowerCase()));
    const shuffledCluster = filteredCluster.sort(() => 0.5 - Math.random());
    candidateArtists.push(...shuffledCluster.slice(0, 3));

    // Добавляем 1-2 любимых артистов из профиля пользователя
    const userFavs = (tasteProfile.topArtists || []).filter(a => a && !candidateArtists.includes(a) && a !== seedArtist);
    if (userFavs.length > 0) {
        candidateArtists.push(...userFavs.slice(0, 2));
    }

    // Параллельный поиск композиций по кандидатам
    const searchPromises = candidateArtists.map(async (art) => {
        try {
            return await searchFullMusicTracks(art);
        } catch (_) {
            return [];
        }
    });

    const searchBatchResults = await Promise.all(searchPromises);
    const candidateTracks = [];

    for (const batch of searchBatchResults) {
        if (!Array.isArray(batch)) continue;
        for (const t of batch.slice(0, 4)) {
            const sig = `${(t.artist || '').toLowerCase()}__${(t.title || '').toLowerCase()}`;
            if (!seenIds.has(t.id) && !dislikedIds.has(t.id) && !seenSignatures.has(sig)) {
                if (seedTitle && t.title.toLowerCase().includes(seedTitle.toLowerCase().slice(0, 7))) continue;
                seenIds.add(t.id);
                seenSignatures.add(sig);
                candidateTracks.push(t);
            }
        }
    }

    // 4. Добавление свежих открытий из Chart
    try {
        const topChartTracks = await getChartPlaylistTracks('37i9dQZEVXbMDoHDwVN2tF');
        const shuffledChart = topChartTracks.sort(() => 0.5 - Math.random());
        for (const t of shuffledChart.slice(0, 4)) {
            const sig = `${(t.artist || '').toLowerCase()}__${(t.title || '').toLowerCase()}`;
            if (!seenIds.has(t.id) && !dislikedIds.has(t.id) && !seenSignatures.has(sig)) {
                seenIds.add(t.id);
                seenSignatures.add(sig);
                candidateTracks.push(t);
            }
        }
    } catch (_) {}

    // 5. Умное чередование треков (Radio Flow Shuffle)
    const finalQueue = [];
    let relIdx = 0;
    let candIdx = 0;

    const shuffledCandidates = candidateTracks.sort(() => 0.5 - Math.random());

    while (finalQueue.length < 25 && (relIdx < results.length || candIdx < shuffledCandidates.length)) {
        if (relIdx < results.length) {
            finalQueue.push(results[relIdx++]);
        }
        if (candIdx < shuffledCandidates.length) {
            finalQueue.push(shuffledCandidates[candIdx++]);
        }
        if (candIdx < shuffledCandidates.length && Math.random() > 0.4) {
            finalQueue.push(shuffledCandidates[candIdx++]);
        }
    }

    return {
        genre,
        detectedCluster: cluster.slice(0, 5),
        tracks: finalQueue.length > 0 ? finalQueue : results,
    };
}

app.post('/api/taste-wave', async (req, res) => {
    const seedTrack = req.body?.seedTrack || {};
    const tasteProfile = req.body?.tasteProfile || {};

    try {
        const wave = await generateTasteAdaptiveWave({ seedTrack, tasteProfile });
        return res.json(wave);
    } catch (err) {
        console.error('Error generating taste wave:', err);
        return res.status(500).json({ error: err.message || 'Ошибка генерации волны' });
    }
});

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
export async function fetchTrackLyrics(title = '', artist = '', duration = 0) {
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

    // 1. Поиск точного совпадения через LRCLIB API /api/get
    if (cleanTitle && cleanArtist) {
        try {
            let getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
            if (duration > 0) getUrl += `&duration=${Math.round(duration)}`;
            const res = await fetch(getUrl, {
                headers: { 'User-Agent': 'DodoMusic/1.1 (https://github.com/foridorpo-blip/DodoMusic)' },
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

    // 2. Поиск через поисковый метод LRCLIB API /api/search
    const searchQueries = [
        `${cleanArtist} ${cleanTitle}`.trim(),
        cleanTitle,
        title
    ].filter(Boolean);

    for (const q of searchQueries) {
        try {
            const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
            const res = await fetch(searchUrl, {
                headers: { 'User-Agent': 'DodoMusic/1.1 (https://github.com/foridorpo-blip/DodoMusic)' },
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

app.get('/api/lyrics', async (req, res) => {
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

/**
 * Получение профиля артиста, его дискографии и плейлистов
 */
export async function getArtistProfileAndDiscography(artistName) {
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
export async function getPlaylistTracks(playlistNumericId) {
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

app.all('/api/artist-profile', async (req, res) => {
    const artist = req.body?.artist || req.query?.artist || '';
    if (!artist) return res.status(400).json({ error: 'Артист не указан' });

    try {
        const data = await getArtistProfileAndDiscography(artist);
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.all('/api/playlist-tracks', async (req, res) => {
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

app.all('/api/check-update', async (req, res) => {
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
        message: 'У вас установлена последняя версия DodoMusic (v1.1).',
        downloadUrl: `https://github.com/${repo}/releases`,
    });
});

app.post('/api/system-notify', (req, res) => {
    return res.json({ ok: true, node: true });
});

const libraryPath = path.join(__dirname, 'dodomusic_library.json');

app.get('/api/library', (req, res) => {
    try {
        if (fs.existsSync(libraryPath)) {
            const content = fs.readFileSync(libraryPath, 'utf8');
            return res.json(JSON.parse(content));
        }
    } catch (_) {}
    return res.json({ favorites: [], history: [] });
});

app.post('/api/library/save', (req, res) => {
    try {
        const data = req.body || {};
        fs.writeFileSync(libraryPath, JSON.stringify(data, null, 2), 'utf8');
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/download-track', async (req, res) => {
    const { transcodingUrl, streamUrl, previewUrl, artist, title } = req.query;
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
        if (!finalAudioUrl) return res.status(400).send('Ссылка недоступна');
        return res.redirect(finalAudioUrl);
    } catch (err) {
        return res.status(500).send(err.message);
    }
});

export function startServer(preferredPort = Number(process.env.PORT) || 58240) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                server.listen(0, '127.0.0.1');
            } else {
                reject(err);
            }
        });
        server.on('listening', () => {
            const addr = server.address();
            const actualPort = typeof addr === 'object' ? addr.port : preferredPort;
            console.log(`🚀 Сервер ДодоСпоти запущен: http://localhost:${actualPort}`);
            resolve({ server, port: actualPort });
        });
        server.listen(preferredPort, '127.0.0.1');
    });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
    startServer();
}
