// Нативный HTML5 Audio + HLS.js + Web Audio API анализатор баса
const audioPlayer = new Audio();
audioPlayer.crossOrigin = 'anonymous';
audioPlayer.preload = 'auto';

let currentHls = null;
let audioCtx = null;
let analyser = null;
let freqData = null;

function initAudioAnalyser() {
    if (audioCtx) return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaElementSource(audioPlayer);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.78;
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
        console.warn('Web Audio API init warning:', e);
    }
}

// SVG иконки для кнопок воспроизведения
const SVG_PLAY = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const SVG_PAUSE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

let currentQueue = [];
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let isAutoWave = true;
let isFetchingRelated = false;
let waveQueue = [];
let lastRelatedTrackId = null;

const defaultSettings = {
    wallpaper: 'aurora',
    accentColor: '#1ed760',
    moveOnMusic: true,
    autoColor: true,
    bassIntensity: 130,
    glassOpacity: 62,
};

let userSettings = {
    ...defaultSettings,
    ...JSON.parse(localStorage.getItem('dodospoti_settings') || '{}'),
};

let favorites = JSON.parse(localStorage.getItem('dodospoti_favorites') || '[]');
let historyList = JSON.parse(localStorage.getItem('dodospoti_history') || '[]');

// DOM элементы
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const tracksContainer = document.getElementById('tracksContainer');
const favoritesContainer = document.getElementById('favoritesContainer');
const historyContainer = document.getElementById('historyContainer');
const resultsHeading = document.getElementById('resultsHeading');
const resultsCount = document.getElementById('resultsCount');
const vibeStatusText = document.getElementById('vibeStatusText');

const autoWaveBtn = document.getElementById('autoWaveBtn');
const smartWaveBanner = document.getElementById('smartWaveBanner');
const smartWaveStatusText = document.getElementById('smartWaveStatusText');
const waveTracksContainer = document.getElementById('waveTracksContainer');
const startSmartWaveBtn = document.getElementById('startSmartWaveBtn');
const refreshWaveBtn = document.getElementById('refreshWaveBtn');
const waveTitle = document.getElementById('waveTitle');
const waveDesc = document.getElementById('waveDesc');

const playerCover = document.getElementById('playerCover');
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const likeCurrentBtn = document.getElementById('likeCurrentBtn');
const openSourceBtn = document.getElementById('openSourceBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const seekBar = document.getElementById('seekBar');
const currentTimeEl = document.getElementById('currentTimeEl');
const durationTimeEl = document.getElementById('durationTimeEl');
const volumeBar = document.getElementById('volumeBar');
const muteBtn = document.getElementById('muteBtn');

// Страница артиста
const tabArtist = document.getElementById('tab-artist');
const artistHeroBg = document.getElementById('artistHeroBg');
const artistAvatar = document.getElementById('artistAvatar');
const artistNameTitle = document.getElementById('artistNameTitle');
const artistStats = document.getElementById('artistStats');
const artistSourceLink = document.getElementById('artistSourceLink');
const playAllArtistBtn = document.getElementById('playAllArtistBtn');
const radioArtistBtn = document.getElementById('radioArtistBtn');
const artistTracksContainer = document.getElementById('artistTracksContainer');
const artistTracksCount = document.getElementById('artistTracksCount');
const mainContent = document.querySelector('.main-content');

function updateSliderFill(slider) {
    if (!slider) return;
    const val = Number(slider.value) || 0;
    const max = Number(slider.max) || 100;
    const min = Number(slider.min) || 0;
    const pct = ((val - min) / (max - min)) * 100;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#1ed760';
    slider.style.background = `linear-gradient(to right, ${accent} ${pct}%, rgba(255, 255, 255, 0.2) ${pct}%)`;
}

function syncPlayPauseUI() {
    const activeTrack = currentQueue[currentIndex];
    const actuallyPlaying = Boolean(!audioPlayer.paused && !audioPlayer.ended && audioPlayer.readyState > 1);
    isPlaying = actuallyPlaying || (!audioPlayer.paused && audioPlayer.currentTime > 0);

    playPauseBtn.innerHTML = isPlaying ? SVG_PAUSE : SVG_PLAY;

    document.querySelectorAll('.track-card').forEach((card) => {
        const isCurrent = activeTrack && card.dataset.trackid === activeTrack.id;
        card.classList.toggle('playing', Boolean(isCurrent));
        const overlay = card.querySelector('.play-overlay');
        if (overlay) {
            overlay.innerHTML = isCurrent && isPlaying ? SVG_PAUSE : SVG_PLAY;
        }
    });

    if (vibeStatusText) {
        if (isPlaying) {
            vibeStatusText.textContent = 'Воспроизведение • Обои активны';
        } else if (activeTrack) {
            vibeStatusText.textContent = userSettings.moveOnMusic
                ? 'На паузе • Обои замерли'
                : 'На паузе';
        } else {
            vibeStatusText.textContent = 'Готов к воспроизведению';
        }
    }
}

audioPlayer.volume = Number(volumeBar.value) / 100;
updateSliderFill(volumeBar);
updateSliderFill(seekBar);

// События HTML5 Audio с жесткой синхронизацией состояния плеера
audioPlayer.addEventListener('play', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    syncPlayPauseUI();
});

audioPlayer.addEventListener('playing', syncPlayPauseUI);
audioPlayer.addEventListener('pause', syncPlayPauseUI);
audioPlayer.addEventListener('waiting', syncPlayPauseUI);

audioPlayer.addEventListener('timeupdate', () => {
    const current = audioPlayer.currentTime || 0;
    const track = currentQueue[currentIndex];
    const dur = (audioPlayer.duration && !isNaN(audioPlayer.duration) && audioPlayer.duration > 0)
        ? audioPlayer.duration
        : (track?.durationSeconds || 180);

    if (dur > 0) {
        seekBar.value = ((current / dur) * 100).toFixed(2);
        currentTimeEl.textContent = formatTime(current);
        durationTimeEl.textContent = formatTime(dur);
        updateSliderFill(seekBar);
    }
});

audioPlayer.addEventListener('ended', () => {
    if (isRepeat) {
        audioPlayer.currentTime = 0;
        audioPlayer.play();
    } else {
        playNext();
    }
});

function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Поиск музыки (полные треки)
async function searchMusic(query) {
    if (!query?.trim()) return;
    searchBtn.disabled = true;
    searchBtn.textContent = 'Поиск...';
    resultsHeading.textContent = query;
    resultsCount.textContent = 'Поиск полных треков...';

    try {
        const res = await fetch('/api/search-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка при поиске музыки');
        }

        currentQueue = data.tracks || [];
        resultsHeading.textContent = data.cleanQuery;
        resultsCount.textContent = `Треков: ${currentQueue.length} (полные версии)`;
        renderTracksGrid(tracksContainer, currentQueue);
    } catch (err) {
        tracksContainer.innerHTML = `<div class="empty-state">${err.message}</div>`;
    } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Найти';
    }
}

function decodeHtml(html) {
    const txt = document.createElement('textarea');
    txt.innerHTML = html || '';
    return txt.value;
}

// Отрисовка карточек песен
function renderTracksGrid(container, list) {
    container.innerHTML = '';
    if (!list || list.length === 0) {
        container.innerHTML = `<div class="empty-state">Песни не найдены. Введите название трека или артиста в поиске выше.</div>`;
        return;
    }

    const activeTrack = currentQueue[currentIndex];

    list.forEach((track, idx) => {
        const card = document.createElement('div');
        const isCurrent = activeTrack && activeTrack.id === track.id;
        card.className = `track-card ${isCurrent ? 'playing' : ''}`;
        card.dataset.trackid = track.id;

        const cleanTitle = decodeHtml(track.title);
        const cleanArtist = decodeHtml(track.artist);
        const durationText = track.duration || '';

        card.innerHTML = `
            <div class="cover-wrapper">
                <img src="${track.thumbnail}" alt="${cleanTitle}" loading="lazy" />
                ${durationText ? `<span class="duration-badge">${durationText}</span>` : ''}
                <div class="play-overlay">${isCurrent && isPlaying ? SVG_PAUSE : SVG_PLAY}</div>
                <button class="card-radio-btn" title="Запустить волну по этой песне">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.2" fill="none">
                        <path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-2"/>
                    </svg>
                </button>
                <button class="card-like-btn ${isTrackLiked(track.id) ? 'liked' : ''}" title="Сохранить в 'Мне нравится'">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="${isTrackLiked(track.id) ? 'currentColor' : 'none'}">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </button>
            </div>
            <div class="track-title" title="${cleanTitle}">${cleanTitle}</div>
            <div class="track-channel" title="${cleanArtist}">${cleanArtist}</div>
        `;

        const likeBtn = card.querySelector('.card-like-btn');
        if (likeBtn) {
            likeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTrackLike(track);
            });
        }

        const radioBtn = card.querySelector('.card-radio-btn');
        if (radioBtn) {
            radioBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startSmartWaveFromTrack(track);
            });
        }

        const channelEl = card.querySelector('.track-channel');
        if (channelEl) {
            channelEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openArtistPage(track.artist);
            });
        }

        card.addEventListener('click', () => {
            if (isCurrent) {
                if (!audioPlayer.paused) {
                    audioPlayer.pause();
                } else {
                    audioPlayer.play().catch(() => {});
                }
                return;
            }
            currentQueue = list;
            playTrackAtIndex(idx);
        });

        container.appendChild(card);
    });
}

/**
 * Умная волна (Smart Autoplay & Radio):
 * Бесконечный подбор треков на основе выбранной песни (например: «девочка в каре», «сайт»)
 */
async function fetchRelatedTracksForCurrent(track, forceRefresh = false) {
    if (!track || !isAutoWave) return;
    if (!forceRefresh && lastRelatedTrackId === track.id) return;
    if (isFetchingRelated) return;

    isFetchingRelated = true;
    lastRelatedTrackId = track.id;

    if (smartWaveBanner) {
        smartWaveBanner.style.display = 'inline-flex';
        smartWaveStatusText.textContent = `Умная волна: подбираем треки в стиле «${decodeHtml(track.title)}»...`;
    }

    try {
        const res = await fetch('/api/related-tracks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trackId: track.id,
                artist: track.artist || '',
                title: track.title || '',
            }),
        });

        if (!res.ok) throw new Error('Ошибка получения рекомендаций');
        const data = await res.json();
        const related = data.relatedTracks || [];

        if (related.length > 0) {
            const existingIds = new Set(currentQueue.map((t) => t.id));
            const existingSigs = new Set(
                currentQueue.map((t) => `${(t.artist || '').toLowerCase()}__${(t.title || '').toLowerCase()}`)
            );

            const newTracks = [];
            for (const t of related) {
                const sig = `${(t.artist || '').toLowerCase()}__${(t.title || '').toLowerCase()}`;
                if (!existingIds.has(t.id) && !existingSigs.has(sig)) {
                    existingIds.add(t.id);
                    existingSigs.add(sig);
                    newTracks.push(t);
                }
            }

            if (newTracks.length > 0) {
                currentQueue = currentQueue.concat(newTracks);
                waveQueue = currentQueue.slice(currentIndex + 1);

                if (smartWaveBanner) {
                    const nextTrack = waveQueue[0] || currentQueue[currentIndex + 1];
                    const nextInfo = nextTrack
                        ? `Далее: ${decodeHtml(nextTrack.artist)} - ${decodeHtml(nextTrack.title)}`
                        : `В очереди: +${newTracks.length} треков`;
                    smartWaveStatusText.textContent = `Умная волна активна • В стиле «${decodeHtml(track.title)}» • ${nextInfo}`;
                }

                renderWaveQueueView();
                if (waveTitle) {
                    waveTitle.textContent = `Моя Волна: в стиле «${decodeHtml(track.title)}»`;
                }
                if (waveDesc) {
                    waveDesc.textContent = `Бесконечный автомикс похожих песен на основе «${decodeHtml(track.artist)} - ${decodeHtml(track.title)}». Треки продолжают играть автоматически.`;
                }
            }
        }
    } catch (err) {
        console.warn('Ошибка загрузки рекомендаций волны:', err);
    } finally {
        isFetchingRelated = false;
    }
}

function renderWaveQueueView() {
    if (!waveTracksContainer) return;
    const waveQueueSub = document.getElementById('waveQueueSub');

    if (waveQueue && waveQueue.length > 0) {
        if (waveQueueSub) {
            waveQueueSub.textContent = `В очереди волны: ${waveQueue.length} треков`;
        }
        renderTracksGrid(waveTracksContainer, waveQueue);
    } else {
        if (waveQueueSub) {
            waveQueueSub.textContent = 'Очередь свободна';
        }
        waveTracksContainer.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 48px 24px; text-align: center;">
                <div style="font-size: 46px; margin-bottom: 12px;">🌊</div>
                <h3 style="font-size: 19px; margin-bottom: 8px; color: #fff; font-weight: 700;">Очередь волны свободна</h3>
                <p style="color: #a7a7a7; max-width: 440px; margin: 0 auto 20px; font-size: 14px; line-height: 1.5;">
                    Здесь будут появляться похожие композиции, только когда играет ваша «Моя волна».<br>
                    Включите любимый трек или нажмите кнопку ниже, чтобы запустить бесконечный поток!
                </p>
                <button id="waveStartEmptyBtn" class="primary-btn" style="margin: 0 auto; display: inline-flex;">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <span>Запустить волну</span>
                </button>
            </div>
        `;
        document.getElementById('waveStartEmptyBtn')?.addEventListener('click', () => {
            if (startSmartWaveBtn) startSmartWaveBtn.click();
        });
    }
}

function startSmartWaveFromTrack(track) {
    isAutoWave = true;
    autoWaveBtn?.classList.add('active');
    if (smartWaveBanner) smartWaveBanner.style.display = 'inline-flex';
    currentQueue = [track];
    waveQueue = [];
    playTrackAtIndex(0);
    renderWaveQueueView();
    fetchRelatedTracksForCurrent(track, true);
    const waveTabBtn = document.querySelector('[data-tab="wave"]');
    if (waveTabBtn) waveTabBtn.click();
}

function highlightActiveCards() {
    syncPlayPauseUI();
}

// Воспроизведение полной песни (3-6 минут)
async function playTrackAtIndex(index) {
    if (index < 0 || index >= currentQueue.length) return;
    initAudioAnalyser();

    currentIndex = index;
    const track = currentQueue[currentIndex];

    const cleanTitle = decodeHtml(track.title);
    const cleanArtist = decodeHtml(track.artist);

    playerCover.src = track.thumbnail || '/icon.png';
    playerTitle.textContent = cleanTitle;
    playerArtist.textContent = cleanArtist;
    currentTimeEl.textContent = '0:00';
    durationTimeEl.textContent = track.duration || '3:00';
    seekBar.value = '0';

    updateLikeButtonState(track.id);
    addToHistory(track);
    highlightActiveCards();

    // Системный медиа-оверлей Windows SMTC и медиа-клавиши
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: cleanTitle,
                artist: cleanArtist,
                album: 'DodoSpoti',
                artwork: [
                    { src: track.thumbnail || '/icon.png', sizes: '512x512', type: 'image/png' },
                ],
            });
            navigator.mediaSession.playbackState = 'playing';
        } catch (_) {}
    }

    // Запускаем подбор умной волны для этого трека
    if (isAutoWave) {
        waveQueue = currentQueue.slice(currentIndex + 1);
        renderWaveQueueView();
        fetchRelatedTracksForCurrent(track);
    }

    // Останавливаем предыдущий поток HLS
    if (currentHls) {
        currentHls.destroy();
        currentHls = null;
    }

    try {
        // Разрешаем прямую ссылку на полный аудио-поток
        const params = new URLSearchParams({
            trackId: track.id,
            source: track.source || 'soundcloud',
            transcodingUrl: track.transcodingUrl || '',
            streamUrl: track.streamUrl || '',
        });

        const res = await fetch(`/api/resolve-stream?${params.toString()}`);
        if (!res.ok) throw new Error('Ошибка разрешения потока');
        const data = await res.json();
        const fullStreamUrl = data.streamUrl;

        if (data.protocol === 'hls' && window.Hls && Hls.isSupported()) {
            currentHls = new Hls({
                maxBufferLength: 45,
                maxMaxBufferLength: 120,
            });
            currentHls.loadSource(fullStreamUrl);
            currentHls.attachMedia(audioPlayer);
            currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
                audioPlayer.play().catch(() => {});
            });
            currentHls.on(Hls.Events.ERROR, (event, errData) => {
                if (errData.fatal) {
                    console.warn('HLS fatal error:', errData.type);
                    if (errData.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        currentHls.startLoad();
                    } else {
                        currentHls.destroy();
                    }
                }
            });
        } else {
            audioPlayer.src = fullStreamUrl;
            audioPlayer.play().catch(() => {});
        }
    } catch (err) {
        console.error('Ошибка воспроизведения полного трека:', err);
    }
}

function playNext() {
    if (!currentQueue.length) return;

    if (isShuffle) {
        // Умный рандом: если играем вперемешку и осталось мало треков, пополняем очередь
        if (currentIndex >= currentQueue.length - 4 && isAutoWave) {
            fetchRelatedTracksForCurrent(currentQueue[currentIndex], true);
        }
        const nextIdx = Math.floor(Math.random() * currentQueue.length);
        playTrackAtIndex(nextIdx);
    } else {
        const nextIdx = currentIndex + 1;
        if (nextIdx < currentQueue.length) {
            // Если подходим к концу очереди, заранее подгружаем следующую пачку похожих треков
            if (nextIdx >= currentQueue.length - 3 && isAutoWave) {
                fetchRelatedTracksForCurrent(currentQueue[nextIdx], true);
            }
            playTrackAtIndex(nextIdx);
        } else if (isAutoWave) {
            // Достигли последнего трека, запрашиваем ещё и бесшовно продолжаем
            const currentTrack = currentQueue[currentIndex];
            fetchRelatedTracksForCurrent(currentTrack, true).then(() => {
                if (currentIndex + 1 < currentQueue.length) {
                    playTrackAtIndex(currentIndex + 1);
                } else {
                    playTrackAtIndex(0);
                }
            });
        } else {
            playTrackAtIndex(0);
        }
    }
}

function playPrev() {
    if (!currentQueue.length) return;
    const prevIdx = (currentIndex - 1 + currentQueue.length) % currentQueue.length;
    playTrackAtIndex(prevIdx);
}

// Любимые треки и история с перманентным сохранением на диске
function isTrackLiked(id) {
    if (!id) return false;
    return favorites.some((t) => t.id === id);
}

function updateLikeButtonState(id) {
    const liked = isTrackLiked(id);
    if (likeCurrentBtn) {
        likeCurrentBtn.classList.toggle('liked', liked);
        const svg = likeCurrentBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', liked ? 'currentColor' : 'none');
    }
    const badge = document.getElementById('favCountBadge');
    if (badge) badge.textContent = favorites.length;
}

function updateAllCardsLikeUI() {
    document.querySelectorAll('.track-card').forEach((card) => {
        const tid = card.dataset.trackid;
        const btn = card.querySelector('.card-like-btn');
        if (btn) {
            const liked = isTrackLiked(tid);
            btn.classList.toggle('liked', liked);
            const svg = btn.querySelector('svg');
            if (svg) svg.setAttribute('fill', liked ? 'currentColor' : 'none');
        }
    });
}

function saveLibraryToDisk() {
    try {
        localStorage.setItem('dodospoti_favorites', JSON.stringify(favorites));
        localStorage.setItem('dodospoti_history', JSON.stringify(historyList));
    } catch (_) {}

    const badge = document.getElementById('favCountBadge');
    if (badge) badge.textContent = favorites.length;

    // Перманентное сохранение в JSON-файл базы данных через бэкенд
    fetch('/api/library/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorites, history: historyList }),
    }).catch(() => {});
}

async function loadLibraryFromDisk() {
    try {
        const res = await fetch('/api/library');
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.favorites) && data.favorites.length > 0) {
                favorites = data.favorites;
            }
            if (Array.isArray(data.history) && data.history.length > 0) {
                historyList = data.history;
            }
        }
    } catch (_) {}

    const badge = document.getElementById('favCountBadge');
    if (badge) badge.textContent = favorites.length;
    renderTracksGrid(favoritesContainer, favorites);
    renderTracksGrid(historyContainer, historyList);
    updateAllCardsLikeUI();
    const current = currentQueue[currentIndex];
    if (current) updateLikeButtonState(current.id);
}

function toggleTrackLike(track) {
    if (!track) return;
    const isLiked = isTrackLiked(track.id);
    if (isLiked) {
        favorites = favorites.filter((t) => t.id !== track.id);
        showSystemNotification('Удалено из избранного', `«${decodeHtml(track.title)}» убрана из «Мне нравится»`, 'info');
    } else {
        favorites.unshift(track);
        showSystemNotification('Сохранено в избранное ❤️', `«${decodeHtml(track.title)}» сохранена в «Мне нравится»`, 'success');
    }

    saveLibraryToDisk();
    updateLikeButtonState(track.id);
    updateAllCardsLikeUI();
    if (favoritesContainer) {
        renderTracksGrid(favoritesContainer, favorites);
    }
}

function addToHistory(track) {
    if (!track) return;
    historyList = [track, ...historyList.filter((t) => t.id !== track.id)].slice(0, 30);
    saveLibraryToDisk();
    renderTracksGrid(historyContainer, historyList);
}

likeCurrentBtn?.addEventListener('click', () => {
    const current = currentQueue[currentIndex];
    if (!current) return;
    toggleTrackLike(current);
});

// Скачивание текущего трека
const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');
if (downloadCurrentBtn) {
    downloadCurrentBtn.addEventListener('click', () => {
        const track = currentQueue[currentIndex];
        if (!track) return;
        showSystemNotification('Скачивание трека', `Загрузка «${decodeHtml(track.title)}»...`, 'music');
        const params = new URLSearchParams({
            trackId: track.id,
            source: track.source || 'soundcloud',
            transcodingUrl: track.transcodingUrl || '',
            streamUrl: track.streamUrl || '',
            title: track.title,
            artist: track.artist,
        });
        window.open(`/api/download-track?${params.toString()}`, '_blank');
    });
}

// Управление плеером
playPauseBtn.addEventListener('click', () => {
    if (currentIndex === -1 && currentQueue.length > 0) {
        playTrackAtIndex(0);
        return;
    }
    if (!audioPlayer.paused) {
        audioPlayer.pause();
    } else {
        audioPlayer.play().catch(() => {});
    }
});

nextBtn.addEventListener('click', playNext);
prevBtn.addEventListener('click', playPrev);

if (autoWaveBtn) {
    autoWaveBtn.addEventListener('click', () => {
        isAutoWave = !isAutoWave;
        autoWaveBtn.classList.toggle('active', isAutoWave);
        if (isAutoWave) {
            if (smartWaveBanner) smartWaveBanner.style.display = 'inline-flex';
            const activeTrack = currentQueue[currentIndex];
            if (activeTrack) fetchRelatedTracksForCurrent(activeTrack, true);
        } else {
            if (smartWaveBanner) smartWaveBanner.style.display = 'none';
        }
    });
}

if (startSmartWaveBtn) {
    startSmartWaveBtn.addEventListener('click', () => {
        const activeTrack = currentQueue[currentIndex];
        if (activeTrack) {
            if (!isPlaying) audioPlayer.play();
            fetchRelatedTracksForCurrent(activeTrack, true);
        } else if (favorites.length > 0) {
            startSmartWaveFromTrack(favorites[0]);
        } else {
            searchMusic('девочка в каре').then(() => {
                if (currentQueue[0]) startSmartWaveFromTrack(currentQueue[0]);
            });
        }
    });
}

if (refreshWaveBtn) {
    refreshWaveBtn.addEventListener('click', () => {
        const activeTrack = currentQueue[currentIndex];
        if (activeTrack) {
            fetchRelatedTracksForCurrent(activeTrack, true);
        }
    });
}

const clearWaveBtn = document.getElementById('clearWaveBtn');
if (clearWaveBtn) {
    clearWaveBtn.addEventListener('click', () => {
        waveQueue = [];
        if (currentIndex >= 0 && currentIndex < currentQueue.length) {
            currentQueue = [currentQueue[currentIndex]];
            currentIndex = 0;
        } else {
            currentQueue = [];
            currentIndex = -1;
        }
        renderWaveQueueView();
        showSystemNotification('Моя волна', 'Очередь волны полностью очищена', 'info');
    });
}

shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
});

repeatBtn.addEventListener('click', () => {
    isRepeat = !isRepeat;
    repeatBtn.classList.toggle('active', isRepeat);
});

seekBar.addEventListener('input', () => {
    const track = currentQueue[currentIndex];
    const dur = (audioPlayer.duration && !isNaN(audioPlayer.duration) && audioPlayer.duration > 0)
        ? audioPlayer.duration
        : (track?.durationSeconds || 180);

    if (dur > 0) {
        audioPlayer.currentTime = (Number(seekBar.value) / 100) * dur;
    }
    updateSliderFill(seekBar);
});

volumeBar.addEventListener('input', () => {
    const vol = Number(volumeBar.value) / 100;
    audioPlayer.volume = vol;
    audioPlayer.muted = vol === 0;
    updateSliderFill(volumeBar);
});

muteBtn.addEventListener('click', () => {
    audioPlayer.muted = !audioPlayer.muted;
    muteBtn.classList.toggle('active', audioPlayer.muted);
});

// Клик по артисту в нижней панели плеера
if (playerArtist) {
    playerArtist.addEventListener('click', () => {
        const track = currentQueue[currentIndex];
        if (track?.artist) {
            openArtistPage(track.artist);
        }
    });
}

// Открыть трек на SoundCloud / Audius
if (openSourceBtn) {
    openSourceBtn.addEventListener('click', () => {
        const track = currentQueue[currentIndex];
        if (track?.permalinkUrl) {
            window.open(track.permalinkUrl, '_blank');
        } else if (track) {
            window.open(`https://soundcloud.com/search?q=${encodeURIComponent(track.artist + ' ' + track.title)}`, '_blank');
        }
    });
}

// Фиксация окна от нежелательной прокрутки viewport
window.addEventListener('scroll', () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
    }
});

/**
 * Открытие страницы артиста: биография, аватарка и все треки
 */
async function openArtistPage(artistName) {
    if (!artistName) return;
    const cleanName = decodeHtml(artistName).trim();

    // Переключаем вкладку на страницу артиста
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tabArtist?.classList.add('active');
    if (mainContent) mainContent.scrollTop = 0;

    // Начальное состояние
    if (artistNameTitle) artistNameTitle.textContent = cleanName;
    if (artistStats) artistStats.textContent = 'Загрузка профиля и композиций...';
    if (artistTracksContainer) artistTracksContainer.innerHTML = '<div class="empty-state">Загружаем композиции...</div>';

    try {
        const res = await fetch(`/api/artist-profile?artist=${encodeURIComponent(cleanName)}`);
        if (!res.ok) throw new Error('Ошибка загрузки данных артиста');
        const data = await res.json();

        const artist = data.artist || { name: cleanName, avatar: '/icon.png', permalinkUrl: '#' };
        if (artistNameTitle) artistNameTitle.textContent = artist.name;
        if (artistAvatar) artistAvatar.src = artist.avatar || '/icon.png';
        if (artistHeroBg) artistHeroBg.src = artist.avatar || '/icon.png';
        if (artistStats) {
            const followers = artist.followersCount ? `${Number(artist.followersCount).toLocaleString('ru-RU')} подписчиков • ` : '';
            artistStats.textContent = `${followers}${data.tracks?.length || 0} треков`;
        }
        if (artistSourceLink) {
            artistSourceLink.href = artist.permalinkUrl || `https://soundcloud.com/search/people?q=${encodeURIComponent(cleanName)}`;
        }

        // Все треки артиста
        if (artistTracksCount) {
            artistTracksCount.textContent = `${data.tracks?.length || 0} композиций`;
        }
        renderTracksGrid(artistTracksContainer, data.tracks || []);

        if (playAllArtistBtn) {
            playAllArtistBtn.onclick = () => {
                if (data.tracks && data.tracks.length > 0) {
                    currentQueue = data.tracks;
                    playTrackAtIndex(0);
                }
            };
        }

        if (radioArtistBtn) {
            radioArtistBtn.onclick = () => {
                if (data.tracks && data.tracks.length > 0) {
                    startSmartWaveFromTrack(data.tracks[0]);
                }
            };
        }
    } catch (err) {
        console.error('Artist profile error:', err);
        if (artistStats) artistStats.textContent = 'Официальная страница артиста';
    }
}

// Навигация и карточки чартов
document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const tabId = `tab-${btn.dataset.tab}`;
        document.getElementById(tabId)?.classList.add('active');

        if (btn.dataset.tab === 'wave') {
            renderWaveQueueView();
        }
    });
});

document.querySelectorAll('.mood-card').forEach((card) => {
    card.addEventListener('click', () => {
        const q = card.dataset.chart;
        searchInput.value = q;
        searchMusic(q);
    });
});

searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    document.querySelector('[data-tab="discover"]')?.click();
    searchMusic(searchInput.value);
});

// НАСТРОЙКИ И РЕАКТИВНЫЕ ВИДЕО-ОБОИ
const wpColors = {
    aurora: '#1ed760',
    dodo: '#ff6900',
    synthwave: '#d946ef',
    galaxy: '#3b82f6',
    phonk: '#ef4444',
};

function hexToRgba(hex, alpha) {
    const clean = (hex || '#1ed760').replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) || 30;
    const g = parseInt(clean.substring(2, 4), 16) || 215;
    const b = parseInt(clean.substring(4, 6), 16) || 96;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applySettingsToDOM() {
    const color = userSettings.autoColor
        ? wpColors[userSettings.wallpaper] || '#1ed760'
        : userSettings.accentColor;

    document.documentElement.style.setProperty('--accent-color', color);
    document.documentElement.style.setProperty('--accent-glow', hexToRgba(color, 0.42));
    document.documentElement.style.setProperty('--surface-alpha', (userSettings.glassOpacity / 100).toFixed(2));

    document.querySelectorAll('.wp-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.wp === userSettings.wallpaper);
    });

    document.getElementById('toggleMoveOnMusic').checked = Boolean(userSettings.moveOnMusic);
    document.getElementById('toggleAutoColor').checked = Boolean(userSettings.autoColor);
    document.getElementById('bassIntensitySlider').value = userSettings.bassIntensity;
    document.getElementById('glassOpacitySlider').value = userSettings.glassOpacity;

    localStorage.setItem('dodospoti_settings', JSON.stringify(userSettings));
    updateSliderFill(volumeBar);
    updateSliderFill(seekBar);
}

document.querySelectorAll('.wp-card').forEach((card) => {
    card.addEventListener('click', () => {
        userSettings.wallpaper = card.dataset.wp;
        if (userSettings.autoColor) {
            userSettings.accentColor = card.dataset.color;
        }
        applySettingsToDOM();
    });
});

document.getElementById('toggleMoveOnMusic').addEventListener('change', (e) => {
    userSettings.moveOnMusic = e.target.checked;
    applySettingsToDOM();
});

document.getElementById('toggleAutoColor').addEventListener('change', (e) => {
    userSettings.autoColor = e.target.checked;
    applySettingsToDOM();
});

document.querySelectorAll('.swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
        userSettings.autoColor = false;
        userSettings.accentColor = btn.dataset.swatch;
        applySettingsToDOM();
    });
});

document.getElementById('bassIntensitySlider').addEventListener('input', (e) => {
    userSettings.bassIntensity = Number(e.target.value);
    applySettingsToDOM();
});

document.getElementById('glassOpacitySlider').addEventListener('input', (e) => {
    userSettings.glassOpacity = Number(e.target.value);
    applySettingsToDOM();
});

// ДВИЖОК АНИМИРОВАННЫХ ВИДЕО-ОБОЕВ С АНАЛИЗОМ БАСА
const wpCanvas = document.getElementById('wallpaperCanvas');
const wpCtx = wpCanvas.getContext('2d');
const miniCanvas = document.getElementById('miniVisualizer');
const miniCtx = miniCanvas.getContext('2d');

function resizeCanvas() {
    wpCanvas.width = window.innerWidth;
    wpCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let animPhase = 0;
const particles = Array.from({ length: 75 }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: 1.5 + Math.random() * 3.5,
    speedX: (Math.random() - 0.5) * 0.002,
    speedY: -0.001 - Math.random() * 0.0025,
}));

function getRealBassEnergy() {
    if (!isPlaying) return 0;
    if (analyser && freqData) {
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += freqData[i];
        }
        const avg = sum / (10 * 255);
        if (avg > 0.01) return avg;
    }
    return (Math.sin(animPhase * 4.5) * 0.5 + 0.5) * 0.65;
}

function renderLiveWallpaper() {
    const w = wpCanvas.width;
    const h = wpCanvas.height;

    const shouldAnimate = isPlaying || !userSettings.moveOnMusic;
    const bassScale = Number(userSettings.bassIntensity) / 100;
    const realBass = getRealBassEnergy() * bassScale;

    if (shouldAnimate) {
        animPhase += isPlaying ? 0.024 + realBass * 0.04 : 0.008;
    }

    const activeHex = userSettings.autoColor
        ? wpColors[userSettings.wallpaper] || '#1ed760'
        : userSettings.accentColor;

    wpCtx.fillStyle = '#06070b';
    wpCtx.fillRect(0, 0, w, h);

    const wp = userSettings.wallpaper;

    if (wp === 'aurora') {
        for (let band = 0; band < 4; band++) {
            wpCtx.beginPath();
            for (let x = 0; x <= w; x += 18) {
                const y =
                    h * (0.24 + band * 0.14) +
                    Math.sin(x * 0.004 + animPhase + band * 1.1) * (45 + realBass * 95);
                if (x === 0) wpCtx.moveTo(x, y);
                else wpCtx.lineTo(x, y);
            }
            wpCtx.lineTo(w, h);
            wpCtx.lineTo(0, h);
            wpCtx.closePath();
            const grad = wpCtx.createLinearGradient(0, h * 0.15, 0, h);
            grad.addColorStop(0, hexToRgba(activeHex, 0.25 + realBass * 0.22));
            grad.addColorStop(1, 'rgba(6, 7, 11, 0)');
            wpCtx.fillStyle = grad;
            wpCtx.fill();
        }
    } else if (wp === 'dodo' || wp === 'phonk') {
        const orbs = [
            { x: w * (0.28 + 0.14 * Math.sin(animPhase * 0.7)), y: h * (0.38 + 0.1 * Math.cos(animPhase * 0.5)), r: Math.max(w, h) * (0.36 + 0.14 * realBass) },
            { x: w * (0.72 + 0.12 * Math.cos(animPhase * 0.6)), y: h * (0.62 + 0.12 * Math.sin(animPhase * 0.8)), r: Math.max(w, h) * (0.32 + 0.14 * realBass) },
        ];
        orbs.forEach((orb) => {
            const grad = wpCtx.createRadialGradient(orb.x, orb.y, 10, orb.x, orb.y, orb.r);
            grad.addColorStop(0, hexToRgba(activeHex, 0.45 + realBass * 0.25));
            grad.addColorStop(0.5, hexToRgba(activeHex, 0.15));
            grad.addColorStop(1, 'rgba(6, 7, 11, 0)');
            wpCtx.fillStyle = grad;
            wpCtx.fillRect(0, 0, w, h);
        });

        wpCtx.strokeStyle = hexToRgba(activeHex, 0.4);
        wpCtx.lineWidth = 2.5;
        for (let line = 0; line < 3; line++) {
            wpCtx.beginPath();
            for (let x = 0; x <= w; x += 16) {
                const y =
                    h * 0.55 +
                    Math.sin(x * 0.006 + animPhase * (1.5 + line * 0.4)) * (30 + realBass * 85) +
                    line * 26;
                if (x === 0) wpCtx.moveTo(x, y);
                else wpCtx.lineTo(x, y);
            }
            wpCtx.stroke();
        }
    } else if (wp === 'synthwave') {
        const sunRadius = 110 + realBass * 55;
        const sunGrad = wpCtx.createRadialGradient(w * 0.5, h * 0.38, 10, w * 0.5, h * 0.38, sunRadius * 2.2);
        sunGrad.addColorStop(0, hexToRgba(activeHex, 0.68));
        sunGrad.addColorStop(0.5, 'rgba(244, 63, 94, 0.24)');
        sunGrad.addColorStop(1, 'rgba(6, 7, 11, 0)');
        wpCtx.fillStyle = sunGrad;
        wpCtx.fillRect(0, 0, w, h);

        wpCtx.strokeStyle = hexToRgba(activeHex, 0.35);
        wpCtx.lineWidth = 1.5;
        const horizon = h * 0.52;
        for (let i = -12; i <= 12; i++) {
            wpCtx.beginPath();
            wpCtx.moveTo(w * 0.5 + i * 30, horizon);
            wpCtx.lineTo(w * 0.5 + i * 180, h);
            wpCtx.stroke();
        }
        const offset = (animPhase * 45) % 40;
        for (let y = horizon; y < h; y += 32) {
            const drawY = y + offset * ((y - horizon) / (h - horizon));
            wpCtx.beginPath();
            wpCtx.moveTo(0, drawY);
            wpCtx.lineTo(w, drawY);
            wpCtx.stroke();
        }
    } else if (wp === 'galaxy') {
        const grad = wpCtx.createRadialGradient(w * 0.5, h * 0.5, 20, w * 0.5, h * 0.5, Math.max(w, h) * (0.48 + realBass * 0.15));
        grad.addColorStop(0, hexToRgba(activeHex, 0.42 + realBass * 0.25));
        grad.addColorStop(0.5, 'rgba(30, 58, 138, 0.2)');
        grad.addColorStop(1, 'rgba(6, 7, 11, 0)');
        wpCtx.fillStyle = grad;
        wpCtx.fillRect(0, 0, w, h);
    }

    particles.forEach((p) => {
        if (shouldAnimate) {
            p.x += p.speedX * (1 + realBass * 3.2);
            p.y += p.speedY * (1 + realBass * 3.2);
            if (p.y < 0) p.y = 1;
            if (p.x < 0) p.x = 1;
            if (p.x > 1) p.x = 0;
        }
        const px = p.x * w;
        const py = p.y * h;
        const radius = p.size * (1 + realBass * 0.85);
        wpCtx.beginPath();
        wpCtx.arc(px, py, radius, 0, Math.PI * 2);
        wpCtx.fillStyle = hexToRgba(activeHex, 0.6);
        wpCtx.fill();
    });

    const mw = miniCanvas.width;
    const mh = miniCanvas.height;
    miniCtx.clearRect(0, 0, mw, mh);
    const bars = 24;
    const barW = mw / bars - 3;
    for (let i = 0; i < bars; i++) {
        let amp = 0.1;
        if (isPlaying && freqData) {
            amp = Math.max(0.12, (freqData[i] || 0) / 255);
        } else if (isPlaying) {
            amp = Math.abs(Math.sin(animPhase * 3.2 + i * 0.45));
        }
        const barH = Math.max(4, amp * (mh - 6));
        miniCtx.fillStyle = activeHex;
        miniCtx.fillRect(i * (barW + 3), mh - barH, barW, barH);
    }

    requestAnimationFrame(renderLiveWallpaper);
}

// СИСТЕМНЫЕ УВЕДОМЛЕНИЯ И ТОСТЫ (WINDOWS + ACTION CENTER)
let toastTimer = null;

function showSystemNotification(title, body, type = 'info', icon = '/icon.png') {
    // 1. Нативное системное уведомление Windows (Windows Action Center Toast) через Electron
    try {
        fetch('/api/system-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, icon }),
        }).catch(() => {});
    } catch (_) {}

    // 2. Нативное Web Notification API
    try {
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                new Notification(title, { body, icon });
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((perm) => {
                    if (perm === 'granted') new Notification(title, { body, icon });
                });
            }
        }
    } catch (_) {}

    // 3. Системный плавающий тост в интерфейсе (полная замена alert)
    const toastEl = document.getElementById('systemToast');
    const toastTitle = document.getElementById('toastTitle');
    const toastBody = document.getElementById('toastBody');
    const toastIconWrap = document.getElementById('toastIconWrap');

    if (toastEl && toastTitle && toastBody) {
        toastTitle.textContent = title;
        toastBody.textContent = body;

        toastEl.className = `system-toast ${type} visible`;

        if (toastIconWrap) {
            if (type === 'update') toastIconWrap.textContent = '🚀';
            else if (type === 'success') toastIconWrap.textContent = '⚡';
            else if (type === 'music') toastIconWrap.textContent = '🎵';
            else toastIconWrap.textContent = 'ℹ️';
        }

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastEl.classList.remove('visible');
        }, 4500);
    }
}

document.getElementById('toastCloseBtn')?.addEventListener('click', () => {
    document.getElementById('systemToast')?.classList.remove('visible');
});

// Экспорт плеера для системного трея Windows
window.audioPlayer = audioPlayer;
window.playNext = playNext;
window.playPrev = playPrev;

// Системные медиа-клавиши Windows (SMTC: Play, Pause, Next, Prev на клавиатуре)
if ('mediaSession' in navigator) {
    try {
        navigator.mediaSession.setActionHandler('play', () => audioPlayer.play().catch(() => {}));
        navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime && !isNaN(details.seekTime)) {
                audioPlayer.currentTime = details.seekTime;
            }
        });
    } catch (_) {}
}

// СИСТЕМА ОБНОВЛЕНИЙ ЧЕРЕЗ GITHUB (v1.1)
async function checkAppUpdates(manual = false) {
    const updateBadgeBtn = document.getElementById('updateBadgeBtn');
    const updateBadgeLabel = document.getElementById('updateBadgeLabel');
    const updateStatusText = document.getElementById('updateStatusText');
    const updateNotesText = document.getElementById('updateNotesText');
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    const githubRepoLink = document.getElementById('githubRepoLink');

    if (checkUpdateBtn) {
        checkUpdateBtn.disabled = true;
        checkUpdateBtn.innerHTML = `<span>Проверяем...</span>`;
    }

    try {
        const res = await fetch('/api/check-update');
        if (!res.ok) throw new Error('Сетевая ошибка при проверке');
        const data = await res.json();

        if (githubRepoLink && data.downloadUrl) {
            githubRepoLink.href = data.downloadUrl;
        }

        if (data.hasUpdate) {
            if (updateBadgeBtn) {
                updateBadgeBtn.classList.add('has-update');
                updateBadgeBtn.title = `Доступно обновление: ${data.latestVersion}! Нажмите для перехода`;
            }
            if (updateBadgeLabel) {
                updateBadgeLabel.textContent = `Доступно ${data.latestVersion}`;
                updateBadgeLabel.style.color = '#ff9800';
            }
            if (updateStatusText) {
                updateStatusText.className = 'update-status-badge available';
                updateStatusText.textContent = `Доступно обновление ${data.latestVersion}`;
            }
            if (updateNotesText) {
                updateNotesText.textContent = data.releaseNotes || `Новая версия ${data.latestVersion} готова к установке с GitHub.`;
            }
            if (manual) {
                showSystemNotification(
                    `Доступно обновление DodoSpoti ${data.latestVersion}`,
                    data.releaseNotes || 'Новая версия готова к установке с GitHub.',
                    'update'
                );
            }
        } else {
            if (updateBadgeBtn) {
                updateBadgeBtn.classList.remove('has-update');
                updateBadgeBtn.title = 'У вас установлена последняя версия v1.1';
            }
            if (updateBadgeLabel) {
                updateBadgeLabel.textContent = 'v1.1 Актуально';
                updateBadgeLabel.style.color = '';
            }
            if (updateStatusText) {
                updateStatusText.className = 'update-status-badge ok';
                updateStatusText.textContent = 'Установлена последняя версия v1.1';
            }
            if (updateNotesText) {
                updateNotesText.textContent = 'DodoSpoti v1.1 — Постоянное сохранение библиотеки на диск, скачивание MP3, сердечки лайков на карточках и системная интеграция Windows.';
            }
            if (manual) {
                showSystemNotification(
                    'DodoSpoti v1.1',
                    'У вас установлена самая актуальная версия! Обновлений не требуется.',
                    'success'
                );
            }
        }
    } catch (err) {
        console.warn('Update check error:', err);
        if (updateStatusText) {
            updateStatusText.textContent = 'v1.1 (Офлайн)';
        }
        if (manual) {
            showSystemNotification(
                'Проверка обновлений',
                'Не удалось связаться с сервером релизов GitHub. Проверьте интернет-соединение.',
                'info'
            );
        }
    } finally {
        if (checkUpdateBtn) {
            checkUpdateBtn.disabled = false;
            checkUpdateBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                <span>Проверить обновления</span>
            `;
        }
    }
}

document.getElementById('updateBadgeBtn')?.addEventListener('click', () => {
    document.querySelector('[data-tab="settings"]')?.click();
    checkAppUpdates(true);
});

document.getElementById('checkUpdateBtn')?.addEventListener('click', () => {
    checkAppUpdates(true);
});

async function loadHomeFeed() {
    resultsHeading.textContent = 'Популярные треки';
    resultsCount.textContent = 'Загрузка лучших композиций...';
    try {
        const res = await fetch('/api/search-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'KME Miyagi MACAN' }),
        });
        if (res.ok) {
            const data = await res.json();
            if (data.tracks && data.tracks.length > 0) {
                renderTracksGrid(tracksContainer, data.tracks);
                resultsHeading.textContent = 'Популярные треки';
                resultsCount.textContent = `Топ треков: ${data.tracks.length} (полные версии)`;
                return;
            }
        }
    } catch (_) {}

    searchMusic('KME Джентльмены');
}

if (!localStorage.getItem('dodospoti_avatar_theme_v2')) {
    userSettings.wallpaper = 'aurora';
    userSettings.accentColor = '#1ed760';
    localStorage.setItem('dodospoti_avatar_theme_v2', '1');
}

applySettingsToDOM();
requestAnimationFrame(renderLiveWallpaper);
loadLibraryFromDisk();
loadHomeFeed();
checkAppUpdates(false);
