/**
 * KaraokeFlow Main Application Controller
 * Handles UI interactions, search, favorites, controls, and visualizer.
 * Supports both Web Browser (mobile/desktop) and Native Android APK (Capacitor).
 */

document.addEventListener('DOMContentLoaded', async () => {
    const audioEngine = window.audioEngine;
    const ytSync = new YouTubeSync(audioEngine);
    ytSync.init();

    // Determine Backend Server Base URL
    // When running inside Android APK (Capacitor), prioritize local network/USB server for instant zero-latency DSP
    const isNativeApp = window.Capacitor !== undefined || window.location.protocol === 'capacitor:' || (window.location.hostname === 'localhost' && window.location.port !== '5000');
    let API_BASE = localStorage.getItem('karaokeflow_server_url') || (isNativeApp ? 'http://192.168.0.105:5000' : window.location.origin);
    API_BASE = API_BASE.replace(/\/+$/, '');

    async function pingServer(url) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);
            const resp = await fetch(`${url}/api/network`, { signal: controller.signal });
            clearTimeout(timeoutId);
            return resp.ok;
        } catch (e) {
            return false;
        }
    }

    async function autoDetectServer(force = false) {
        if (!force && API_BASE) {
            const currentWorks = await pingServer(API_BASE);
            if (currentWorks) return API_BASE;
        }

        // Prioritize local network for native app, cloud for web browsers
        const candidates = isNativeApp ? [
            'http://192.168.0.105:5000',        // Wi-Fi LAN active IP
            'http://127.0.0.1:5000',            // USB ADB Reverse proxy
            localStorage.getItem('karaokeflow_server_url'),
            'https://karaoke.alsuza.com',       // Custom domain on Cloudflare
            'https://karaokeflow.onrender.com', // Live Render 24/7 cloud server
            'http://localhost:5000',
            window.location.origin
        ].filter(Boolean) : [
            'https://karaoke.alsuza.com',       // Custom domain on Cloudflare
            'https://karaokeflow.onrender.com', // Live Render 24/7 cloud server
            'http://192.168.0.105:5000',        // Wi-Fi LAN active IP
            'http://127.0.0.1:5000',            // USB ADB Reverse proxy
            localStorage.getItem('karaokeflow_server_url'),
            'http://localhost:5000',
            window.location.origin
        ].filter(Boolean);

        for (const candidate of candidates) {
            const clean = candidate.replace(/\/+$/, '');
            if (await pingServer(clean)) {
                API_BASE = clean;
                localStorage.setItem('karaokeflow_server_url', clean);
                console.log('KaraokeFlow connected to:', clean);
                const input = document.getElementById('server-url-input');
                if (input) input.value = clean;
                return clean;
            }
        }
        return API_BASE;
    }

    // Auto-detect server in background at launch
    autoDetectServer().catch(() => {});

    // DOM Elements
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const searchResults = document.getElementById('search-results');
    const searchLoading = document.getElementById('search-loading');
    const genreChips = document.querySelectorAll('.chip');
    const karaokeToggle = document.getElementById('karaoke-filter-toggle');

    // Player Elements
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    const playerTitle = document.getElementById('player-title');
    const playerChannel = document.getElementById('player-channel');
    const playerThumb = document.getElementById('player-thumb');
    const playerDock = document.getElementById('player-dock');

    // Sound Mode & Autoplay Prompts
    const audioSourceSelect = document.getElementById('audio-source-select');
    const autoplayPrompt = document.getElementById('autoplay-prompt');
    const tapToPlayBtn = document.getElementById('tap-to-play-btn');

    // Pitch Controls
    const pitchValEl = document.getElementById('pitch-value');
    const pitchDownBtn = document.getElementById('pitch-down-btn');
    const pitchUpBtn = document.getElementById('pitch-up-btn');
    const pitchResetBtn = document.getElementById('pitch-reset-btn');
    const pitchSlider = document.getElementById('pitch-slider');

    // Reverb Controls
    const reverbPresets = document.querySelectorAll('.reverb-preset-btn');
    const reverbMixSlider = document.getElementById('reverb-mix-slider');
    const reverbMixValEl = document.getElementById('reverb-mix-val');
    const reverbDecaySlider = document.getElementById('reverb-decay-slider');
    const reverbDecayValEl = document.getElementById('reverb-decay-val');

    // Tempo Controls
    const tempoSlider = document.getElementById('tempo-slider');
    const tempoValEl = document.getElementById('tempo-val');
    const tempoResetBtn = document.getElementById('tempo-reset-btn');

    // Vocal Reducer
    const vocalReducerBtn = document.getElementById('vocal-reducer-btn');
    const vocalReducerBadge = document.getElementById('vocal-reducer-badge');

    // Microphone Controls
    const micToggleBtn = document.getElementById('mic-toggle-btn');
    const micStatusBadge = document.getElementById('mic-status-badge');
    const micGainSlider = document.getElementById('mic-gain-slider');
    const micReverbSlider = document.getElementById('mic-reverb-slider');
    const micModal = document.getElementById('mic-advisory-modal');
    const micConfirmBtn = document.getElementById('mic-confirm-btn');
    const micCancelBtn = document.getElementById('mic-cancel-btn');

    // Visualizer Canvas
    const canvas = document.getElementById('visualizer-canvas');
    const canvasCtx = canvas ? canvas.getContext('2d') : null;

    // Mobile Install & Share Modals
    const installBtn = document.getElementById('install-app-btn');
    const shareBtn = document.getElementById('share-mobile-btn');
    const mobileModal = document.getElementById('mobile-connect-modal');
    const closeMobileModal = document.getElementById('close-mobile-modal');
    const mobileQrImg = document.getElementById('mobile-qr-img');
    const mobileUrlText = document.getElementById('mobile-url-text');
    const copyUrlBtn = document.getElementById('copy-url-btn');

    // Server Settings Modal
    const serverSettingsBtn = document.getElementById('server-settings-btn');
    const serverSettingsModal = document.getElementById('server-settings-modal');
    const serverUrlInput = document.getElementById('server-url-input');
    const saveServerBtn = document.getElementById('save-server-btn');
    const autoDetectServerBtn = document.getElementById('auto-detect-server-btn');
    const closeServerModal = document.getElementById('close-server-modal');

    // Songbook (Favorites)
    const songbookBtn = document.getElementById('songbook-btn');
    const favToggleBtn = document.getElementById('fav-toggle-btn');
    const favIcon = document.getElementById('fav-icon');

    // Local file input
    const localFileInput = document.getElementById('local-file-input');
    const localFileBtn = document.getElementById('local-file-btn');

    // State
    let currentTrack = null;
    let playlist = [];
    let playlistIndex = -1;
    let favorites = JSON.parse(localStorage.getItem('karaoke_favorites') || '[]');
    let deferredInstallPrompt = null;

    // Default search queries for genres
    const GENRE_QUERIES = {
        'all': 'popular karaoke instrumental',
        'trending': 'trending karaoke songs with lyrics',
        'pop': 'top pop hits karaoke instrumental',
        'rock': 'classic rock karaoke instrumental',
        'ballad': 'love songs ballad karaoke',
        'rnb': 'r&b soul karaoke instrumental'
    };

    // ==========================================
    // 1. Audio Engine Listeners
    // ==========================================
    audioEngine.onTimeUpdate = (currentTime, duration) => {
        if (!duration || duration <= 0) return;
        const pct = (currentTime / duration) * 100;
        progressFill.style.width = `${pct}%`;
        progressBar.value = pct;
        currentTimeEl.textContent = formatTime(currentTime);
        totalTimeEl.textContent = formatTime(duration);
    };

    audioEngine.onPlay = () => {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        if (autoplayPrompt) autoplayPrompt.classList.add('hidden');
    };

    audioEngine.onPause = () => {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
    };

    audioEngine.onEnded = () => {
        playNextTrack();
    };

    audioEngine.onError = (e) => {
        console.warn("Audio stream notice:", e);
    };

    // Autoplay Prompt Handling for Mobile Browsers
    ytSync.onAutoplayBlocked = () => {
        if (autoplayPrompt) autoplayPrompt.classList.remove('hidden');
    };

    ytSync.onAutoplayStarted = () => {
        if (autoplayPrompt) autoplayPrompt.classList.add('hidden');
    };

    if (tapToPlayBtn) {
        tapToPlayBtn.addEventListener('click', async () => {
            if (autoplayPrompt) autoplayPrompt.classList.add('hidden');
            await audioEngine.init();
            if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
                await audioEngine.ctx.resume();
            }
            await ytSync.play();
        });
    }

    // Sound Mode Selector
    if (audioSourceSelect) {
        audioSourceSelect.addEventListener('change', (e) => {
            const mode = e.target.value;
            ytSync.setSoundMode(mode);
            if (mode === 'direct') {
                showToast("Switched to Direct YouTube Audio", "info");
            } else {
                showToast("Switched to Studio DSP (Pitch & Reverb)", "info");
            }
        });
    }

    // ==========================================
    // 2. Playback Transport Controls
    // ==========================================
    playPauseBtn.addEventListener('click', async () => {
        if (!currentTrack) {
            showToast("Search and pick a song to start singing!", "info");
            return;
        }
        await audioEngine.init();
        if (audioEngine.isPlaying) {
            ytSync.pause();
        } else {
            ytSync.play().catch(err => {
                console.warn("Autoplay interaction required:", err);
                if (autoplayPrompt) autoplayPrompt.classList.remove('hidden');
            });
        }
    });

    progressBar.addEventListener('input', (e) => {
        const pct = parseFloat(e.target.value);
        progressFill.style.width = `${pct}%`;
        const dur = audioEngine.duration;
        if (dur > 0) {
            const targetSec = (pct / 100) * dur;
            currentTimeEl.textContent = formatTime(targetSec);
        }
    });

    progressBar.addEventListener('change', (e) => {
        const pct = parseFloat(e.target.value);
        const dur = audioEngine.duration;
        if (dur > 0) {
            ytSync.seek((pct / 100) * dur);
        }
    });

    prevBtn.addEventListener('click', () => {
        if (playlistIndex > 0) {
            loadSong(playlist[playlistIndex - 1], playlistIndex - 1);
        } else if (audioEngine.currentTime > 3) {
            ytSync.seek(0);
        }
    });

    nextBtn.addEventListener('click', () => {
        playNextTrack();
    });

    function playNextTrack() {
        if (playlistIndex + 1 < playlist.length) {
            loadSong(playlist[playlistIndex + 1], playlistIndex + 1);
        } else if (playlist.length > 0) {
            loadSong(playlist[0], 0);
        }
    }

    // ==========================================
    // 3. Pitch Controls
    // ==========================================
    function updatePitchUI(semitones) {
        pitchValEl.textContent = semitones === 0 ? "Original (0)" : (semitones > 0 ? `+${semitones}` : `${semitones}`);
        pitchSlider.value = semitones;
        if (semitones === 0) {
            pitchValEl.className = "control-badge neutral";
        } else if (semitones > 0) {
            pitchValEl.className = "control-badge sharp";
        } else {
            pitchValEl.className = "control-badge flat";
        }
    }

    pitchDownBtn.addEventListener('click', async () => {
        await audioEngine.init();
        const pitch = audioEngine.pitchDown();
        updatePitchUI(pitch);
    });

    pitchUpBtn.addEventListener('click', async () => {
        await audioEngine.init();
        const pitch = audioEngine.pitchUp();
        updatePitchUI(pitch);
    });

    pitchResetBtn.addEventListener('click', async () => {
        await audioEngine.init();
        const pitch = audioEngine.pitchReset();
        updatePitchUI(pitch);
    });

    pitchSlider.addEventListener('input', async (e) => {
        await audioEngine.init();
        const pitch = audioEngine.setPitch(parseInt(e.target.value, 10));
        updatePitchUI(pitch);
    });

    // ==========================================
    // 4. Reverb Controls
    // ==========================================
    reverbPresets.forEach(btn => {
        btn.addEventListener('click', async () => {
            await audioEngine.init();
            reverbPresets.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const preset = btn.dataset.preset;
            audioEngine.setReverbPreset(preset);

            reverbMixSlider.value = Math.round(audioEngine.reverbWet * 100);
            reverbMixValEl.textContent = `${reverbMixSlider.value}%`;
            reverbDecaySlider.value = audioEngine.reverbDecay.toFixed(1);
            reverbDecayValEl.textContent = `${reverbDecaySlider.value}s`;
        });
    });

    reverbMixSlider.addEventListener('input', async (e) => {
        await audioEngine.init();
        const mix = parseInt(e.target.value, 10) / 100;
        audioEngine.setReverbMix(mix);
        reverbMixValEl.textContent = `${e.target.value}%`;
    });

    reverbDecaySlider.addEventListener('input', async (e) => {
        await audioEngine.init();
        const decay = parseFloat(e.target.value);
        audioEngine.setReverbDecay(decay);
        reverbDecayValEl.textContent = `${decay.toFixed(1)}s`;
    });

    // ==========================================
    // 5. Tempo Controls
    // ==========================================
    tempoSlider.addEventListener('input', (e) => {
        const rate = parseFloat(e.target.value);
        ytSync.setPlaybackRate(rate);
        tempoValEl.textContent = `${rate.toFixed(2)}x`;
    });

    tempoResetBtn.addEventListener('click', () => {
        tempoSlider.value = 1.0;
        ytSync.setPlaybackRate(1.0);
        tempoValEl.textContent = "1.00x";
    });

    // ==========================================
    // 6. Vocal Reducer Toggle
    // ==========================================
    vocalReducerBtn.addEventListener('click', async () => {
        await audioEngine.init();
        const active = audioEngine.toggleVocalReducer();
        if (active) {
            vocalReducerBtn.classList.add('active');
            vocalReducerBadge.textContent = "ON (Active)";
            vocalReducerBadge.className = "badge on";
            showToast("Vocal Reducer active: center vocals attenuated", "info");
        } else {
            vocalReducerBtn.classList.remove('active');
            vocalReducerBadge.textContent = "OFF";
            vocalReducerBadge.className = "badge off";
        }
    });

    // ==========================================
    // 7. Live Vocal Microphone Controls
    // ==========================================
    micToggleBtn.addEventListener('click', () => {
        if (!audioEngine.isMicActive) {
            micModal.classList.remove('hidden');
        } else {
            audioEngine.stopMicrophone();
            micToggleBtn.classList.remove('active');
            micStatusBadge.textContent = "OFF";
            micStatusBadge.className = "badge off";
            showToast("Microphone muted", "info");
        }
    });

    micConfirmBtn.addEventListener('click', async () => {
        micModal.classList.add('hidden');
        try {
            await audioEngine.startMicrophone();
            micToggleBtn.classList.add('active');
            micStatusBadge.textContent = "LIVE";
            micStatusBadge.className = "badge live pulse";
            showToast("Microphone active with KTV reverb!", "success");
        } catch (err) {
            showToast("Microphone access denied or not supported on this connection", "error");
        }
    });

    micCancelBtn.addEventListener('click', () => {
        micModal.classList.add('hidden');
    });

    micGainSlider.addEventListener('input', (e) => {
        const gain = parseFloat(e.target.value);
        audioEngine.setMicGain(gain);
        document.getElementById('mic-gain-val').textContent = `${Math.round(gain * 100)}%`;
    });

    micReverbSlider.addEventListener('input', (e) => {
        const send = parseFloat(e.target.value);
        audioEngine.setMicReverbSend(send);
        document.getElementById('mic-reverb-val').textContent = `${Math.round(send * 100)}%`;
    });

    // ==========================================
    // 8. Search & Song Selection
    // ==========================================
    async function executeSearch(query, isRetry = false) {
        if (!query.trim()) return;
        searchLoading.classList.remove('hidden');
        searchResults.innerHTML = '';

        const isKaraoke = karaokeToggle.checked;
        try {
            const resp = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&karaoke=${isKaraoke}`);
            if (!resp.ok && !isRetry) throw new Error("Search response error");
            const songs = await resp.json();
            searchLoading.classList.add('hidden');

            if (!Array.isArray(songs) || songs.length === 0) {
                searchResults.innerHTML = `<div class="empty-state">No songs found. Try a different artist or title.</div>`;
                return;
            }

            playlist = songs;
            renderSearchResults(songs);
        } catch (err) {
            if (!isRetry) {
                const detected = await autoDetectServer(true);
                if (detected && detected !== API_BASE) {
                    return executeSearch(query, true);
                }
            }
            searchLoading.classList.add('hidden');
            searchResults.innerHTML = `<div class="empty-state error">Search error. Cannot reach server at: ${API_BASE}. Tap ⚙️ Server in the header to configure.</div>`;
        }
    }

    function renderSearchResults(songs) {
        searchResults.innerHTML = '';
        songs.forEach((song, idx) => {
            const card = document.createElement('div');
            card.className = 'song-card';
            if (currentTrack && currentTrack.id === song.id) {
                card.classList.add('now-playing');
            }

            const isFav = favorites.some(f => f.id === song.id);

            card.innerHTML = `
                <div class="song-thumb-container">
                    <img src="${song.thumbnail}" alt="${song.title}" class="song-thumb" loading="lazy" />
                    <span class="song-duration">${song.duration_str}</span>
                </div>
                <div class="song-info">
                    <div class="song-title">${escapeHtml(song.title)}</div>
                    <div class="song-channel">${escapeHtml(song.channel)}</div>
                </div>
                <div class="song-actions">
                    <button class="icon-btn fav-btn ${isFav ? 'active' : ''}" data-idx="${idx}" title="Save to Favorites">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="${isFav ? '#FF3366' : 'none'}" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </button>
                    <button class="sing-btn" data-idx="${idx}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        Sing
                    </button>
                </div>
            `;

            card.querySelector('.sing-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                loadSong(song, idx);
            });
            card.addEventListener('click', () => {
                loadSong(song, idx);
            });

            const favBtn = card.querySelector('.fav-btn');
            favBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFavorite(song);
                const active = favorites.some(f => f.id === song.id);
                favBtn.classList.toggle('active', active);
                favBtn.querySelector('svg').setAttribute('fill', active ? '#FF3366' : 'none');
            });

            searchResults.appendChild(card);
        });
    }

    async function loadSong(song, idx = -1) {
        currentTrack = song;
        playlistIndex = idx;

        // UI Updates
        playerTitle.textContent = song.title;
        playerChannel.textContent = song.channel;
        playerThumb.src = song.thumbnail;
        playerDock.classList.remove('hidden');

        updateFavoriteIcon(song.id);

        document.querySelectorAll('.song-card').forEach((el, i) => {
            el.classList.toggle('now-playing', i === idx);
        });

        // 1. Immediately unlock AudioContext during the user click gesture
        try {
            await audioEngine.init();
            if (audioEngine.ctx && audioEngine.ctx.state === 'suspended') {
                await audioEngine.ctx.resume();
            }
        } catch (e) {
            console.warn("AudioContext init note:", e);
        }

        // 2. Load Video into YouTube container immediately
        ytSync.loadVideo(song.id, null);

        showToast(`Loading: ${song.title}...`, "info");

        // 3. Fetch stream proxy URL for real-time DSP
        let fullStreamUrl = null;

        try {
            const resp = await fetch(`${API_BASE}/api/info?id=${song.id}`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.stream_proxy) {
                    fullStreamUrl = data.stream_proxy.startsWith('http') ? data.stream_proxy : `${API_BASE}${data.stream_proxy}`;
                }
            }
        } catch (err) {
            console.warn("Primary server info fetch failed, trying fallbacks...");
        }

        // If primary server failed, seamlessly check other available servers
        if (!fullStreamUrl) {
            const fallbacks = [
                'http://192.168.0.105:5000',
                'http://127.0.0.1:5000',
                'https://karaokeflow.onrender.com',
                'https://karaoke.alsuza.com'
            ].filter(u => u !== API_BASE);

            for (const candidate of fallbacks) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2000);
                    const resp = await fetch(`${candidate}/api/info?id=${song.id}`, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.stream_proxy) {
                            API_BASE = candidate;
                            localStorage.setItem('karaokeflow_server_url', candidate);
                            const input = document.getElementById('server-url-input');
                            if (input) input.value = candidate;
                            fullStreamUrl = data.stream_proxy.startsWith('http') ? data.stream_proxy : `${candidate}${data.stream_proxy}`;
                            break;
                        }
                    }
                } catch (e) {}
            }
        }

        if (fullStreamUrl) {
            ytSync.setAudioSource(fullStreamUrl);
            await ytSync.play();
            showToast(`Now Playing: ${song.title}`, "success");
        } else {
            showToast("Audio stream unavailable. Switched to Direct YouTube Audio.", "warning");
            ytSync.setSoundMode('direct');
            if (audioSourceSelect) audioSourceSelect.value = 'direct';
        }
    }

    searchBtn.addEventListener('click', () => executeSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') executeSearch(searchInput.value);
    });

    genreChips.forEach(chip => {
        chip.addEventListener('click', () => {
            genreChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const genre = chip.dataset.genre;
            if (genre === 'favorites') {
                showFavoritesList();
            } else if (GENRE_QUERIES[genre]) {
                searchInput.value = GENRE_QUERIES[genre];
                executeSearch(GENRE_QUERIES[genre]);
            }
        });
    });

    // ==========================================
    // 9. Local Audio File ("Sing Your Own")
    // ==========================================
    localFileBtn.addEventListener('click', () => {
        localFileInput.click();
    });

    localFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const objectUrl = URL.createObjectURL(file);
        const customSong = {
            id: 'local-' + Date.now(),
            title: file.name.replace(/\.[^/.]+$/, ""),
            channel: 'Local Device Audio',
            thumbnail: 'assets/icon-192.png',
            duration: 0,
            duration_str: '--:--'
        };

        currentTrack = customSong;
        playlist = [customSong];
        playlistIndex = 0;

        playerTitle.textContent = customSong.title;
        playerChannel.textContent = customSong.channel;
        playerThumb.src = customSong.thumbnail;
        playerDock.classList.remove('hidden');

        await audioEngine.init();
        audioEngine.loadAudio(objectUrl);
        await audioEngine.play();
        showToast(`Playing local audio: ${customSong.title}`, "success");
    });

    // ==========================================
    // 10. Favorites (Songbook)
    // ==========================================
    function toggleFavorite(song) {
        const existingIdx = favorites.findIndex(f => f.id === song.id);
        if (existingIdx >= 0) {
            favorites.splice(existingIdx, 1);
            showToast("Removed from My Songbook", "info");
        } else {
            favorites.unshift(song);
            showToast("Saved to My Songbook!", "success");
        }
        localStorage.setItem('karaoke_favorites', JSON.stringify(favorites));
        if (currentTrack && currentTrack.id === song.id) {
            updateFavoriteIcon(song.id);
        }
    }

    function updateFavoriteIcon(songId) {
        const isFav = favorites.some(f => f.id === songId);
        favIcon.setAttribute('fill', isFav ? '#FF3366' : 'none');
    }

    favToggleBtn.addEventListener('click', () => {
        if (currentTrack) {
            toggleFavorite(currentTrack);
        }
    });

    function showFavoritesList() {
        searchResults.innerHTML = '';
        if (favorites.length === 0) {
            searchResults.innerHTML = `
                <div class="empty-state">
                    <h3>Your Songbook is Empty</h3>
                    <p>Tap the star icon on any song to save it for quick access!</p>
                </div>
            `;
            return;
        }
        playlist = favorites;
        renderSearchResults(favorites);
    }

    songbookBtn.addEventListener('click', () => {
        genreChips.forEach(c => c.classList.remove('active'));
        document.querySelector('[data-genre="favorites"]')?.classList.add('active');
        showFavoritesList();
    });

    // ==========================================
    // 11. PWA Install & Network Sharing
    // ==========================================
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        installBtn.classList.remove('hidden');
    });

    installBtn.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.classList.add('hidden');
            }
            deferredInstallPrompt = null;
        } else {
            showToast("On iOS Safari: Tap Share -> 'Add to Home Screen'", "info");
        }
    });

    shareBtn.addEventListener('click', async () => {
        mobileModal.classList.remove('hidden');
        try {
            const resp = await fetch(`${API_BASE}/api/network`);
            const data = await resp.json();
            mobileUrlText.textContent = data.mobile_url;
            mobileQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data.mobile_url)}`;
        } catch (e) {
            mobileUrlText.textContent = window.location.href;
            mobileQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(window.location.href)}`;
        }
    });

    closeMobileModal.addEventListener('click', () => {
        mobileModal.classList.add('hidden');
    });

    copyUrlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(mobileUrlText.textContent);
        showToast("Mobile link copied to clipboard!", "success");
    });

    // ==========================================
    // 12. Server Settings Modal (for APK / Remote)
    // ==========================================
    if (serverSettingsBtn) {
        serverSettingsBtn.addEventListener('click', () => {
            if (serverUrlInput) serverUrlInput.value = API_BASE;
            if (serverSettingsModal) serverSettingsModal.classList.remove('hidden');
        });
    }

    if (closeServerModal) {
        closeServerModal.addEventListener('click', () => {
            if (serverSettingsModal) serverSettingsModal.classList.add('hidden');
        });
    }

    if (saveServerBtn) {
        saveServerBtn.addEventListener('click', () => {
            const val = serverUrlInput.value.trim().replace(/\/+$/, '');
            if (val) {
                API_BASE = val;
                localStorage.setItem('karaokeflow_server_url', val);
                showToast(`Server updated to: ${val}`, "success");
                if (serverSettingsModal) serverSettingsModal.classList.add('hidden');
                executeSearch(searchInput.value || GENRE_QUERIES['trending']);
            }
        });
    }

    if (autoDetectServerBtn) {
        autoDetectServerBtn.addEventListener('click', async () => {
            autoDetectServerBtn.textContent = "Scanning...";
            const found = await autoDetectServer(true);
            autoDetectServerBtn.textContent = "⚡ Auto Detect";
            if (found) {
                if (serverUrlInput) serverUrlInput.value = found;
                showToast(`Connected to: ${found}`, "success");
            } else {
                showToast("No server detected. Check Wi-Fi or USB connection.", "error");
            }
        });
    }

    // ==========================================
    // 13. Real-Time Visualizer Animation
    // ==========================================
    function drawVisualizer() {
        requestAnimationFrame(drawVisualizer);
        if (!canvasCtx || !audioEngine.analyser) return;

        const freqData = audioEngine.getFrequencyData();
        if (!freqData) return;

        const width = canvas.width;
        const height = canvas.height;
        canvasCtx.clearRect(0, 0, width, height);

        const barCount = 32;
        const barWidth = (width / barCount) - 2;

        for (let i = 0; i < barCount; i++) {
            const val = freqData[i * 2] || 0;
            const barHeight = (val / 255) * height;

            const gradient = canvasCtx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, '#00F0FF');
            gradient.addColorStop(0.5, '#7928CA');
            gradient.addColorStop(1, '#FF0080');

            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(i * (barWidth + 2), height - barHeight, barWidth, barHeight);
        }
    }
    drawVisualizer();

    // ==========================================
    // Helpers
    // ==========================================
    function formatTime(sec) {
        if (!sec || isNaN(sec)) return "0:00";
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Initial search
    executeSearch(GENRE_QUERIES['trending']);
});
