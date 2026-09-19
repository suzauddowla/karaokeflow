/**
 * YouTube Video & Audio Synchronization Manager
 * Coordinates YouTube player with WebAudio DSP Engine (for pitch/reverb/speed).
 * Supports both "Studio DSP" (Web Audio) and "Direct YouTube Audio" fallback modes.
 */

class YouTubeSync {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;
        this.player = null;
        this.isIFrameReady = false;
        this.currentVideoId = null;
        this.pendingVideoId = null;
        this.syncInterval = null;
        this.isSeeking = false;
        this.soundMode = 'dsp'; // 'dsp' or 'direct'
        this.onAutoplayBlocked = null;
        this.onAutoplayStarted = null;
    }

    init() {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            tag.onerror = () => {
                console.warn("YouTube API script blocked or offline. Using direct iframe fallback.");
            };
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }

        window.onYouTubeIframeAPIReady = () => {
            if (this.pendingVideoId) {
                this.createPlayer(this.pendingVideoId);
            }
        };

        if (window.YT && window.YT.Player && this.pendingVideoId) {
            this.createPlayer(this.pendingVideoId);
        }
    }

    createPlayer(videoId) {
        const container = document.getElementById('yt-player-container');
        if (!container) return;

        try {
            this.player = new YT.Player('yt-player-container', {
                height: '100%',
                width: '100%',
                videoId: videoId,
                playerVars: {
                    autoplay: 0,
                    controls: 1,
                    disablekb: 0,
                    fs: 1,
                    modestbranding: 1,
                    rel: 0,
                    playsinline: 1,
                    enablejsapi: 1,
                    origin: window.location.origin
                },
                events: {
                    onReady: (event) => {
                        this.isIFrameReady = true;
                        if (this.soundMode === 'dsp') {
                            event.target.mute();
                        } else {
                            event.target.unMute();
                        }
                    },
                    onStateChange: (event) => {
                        this.handlePlayerState(event.data);
                    },
                    onError: (event) => {
                        const code = event && event.data;
                        if (code === 101 || code === 150) {
                            this.showEmbedRestrictedNotice(videoId);
                        } else {
                            this.loadDirectIframe(videoId);
                        }
                    }
                }
            });
        } catch (e) {
            this.loadDirectIframe(videoId);
        }
    }

    showEmbedRestrictedNotice(videoId) {
        const container = document.getElementById('yt-player-container');
        if (!container) return;
        container.innerHTML = `
            <div class="embed-notice-overlay">
                <div class="embed-notice-icon">⚠️</div>
                <div class="embed-notice-title">Video Embed Restricted by Owner</div>
                <div class="embed-notice-text">
                    This publisher disabled external video playback. However, your <strong>live karaoke audio &amp; pitch/reverb DSP</strong> are playing! Pick another version from the search results for synchronized video.
                </div>
                <div class="embed-notice-actions">
                    <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" class="btn-primary" style="font-size: 0.8rem; padding: 6px 14px; text-decoration: none;">
                        Watch Video on YouTube
                    </a>
                </div>
            </div>
        `;
    }

    loadDirectIframe(videoId) {
        const container = document.getElementById('yt-player-container');
        if (!container) return;
        const muteParam = this.soundMode === 'dsp' ? '&mute=1' : '';
        container.innerHTML = `
            <iframe 
                id="yt-embed-frame"
                src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1${muteParam}&playsinline=1&enablejsapi=1&rel=0"
                style="width: 100%; height: 100%; border: none;"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen>
            </iframe>
        `;
    }

    loadVideo(videoId, streamProxyUrl = null) {
        this.currentVideoId = videoId;
        this.pendingVideoId = videoId;

        if (streamProxyUrl) {
            this.audioEngine.loadAudio(streamProxyUrl);
        }

        if (!this.player) {
            if (window.YT && window.YT.Player) {
                this.createPlayer(videoId);
            } else {
                this.loadDirectIframe(videoId);
            }
        } else if (this.isIFrameReady && this.player.loadVideoById) {
            try {
                this.player.loadVideoById({
                    videoId: videoId,
                    startSeconds: 0
                });
                if (this.soundMode === 'dsp') {
                    this.player.mute();
                } else {
                    this.player.unMute();
                }
            } catch (e) {
                this.loadDirectIframe(videoId);
            }
        } else {
            this.loadDirectIframe(videoId);
        }

        this.startDriftCorrection();
    }

    setAudioSource(streamProxyUrl) {
        this.audioEngine.loadAudio(streamProxyUrl);
    }

    setSoundMode(mode) {
        this.soundMode = mode;
        if (mode === 'direct') {
            // Unmute YouTube video directly, pause Web Audio
            this.audioEngine.pause();
            if (this.isIFrameReady && this.player && this.player.unMute) {
                try {
                    this.player.unMute();
                    this.player.playVideo();
                } catch (e) {}
            } else {
                const iframe = document.getElementById('yt-embed-frame');
                if (iframe && this.currentVideoId) {
                    iframe.src = `https://www.youtube-nocookie.com/embed/${this.currentVideoId}?autoplay=1&playsinline=1&enablejsapi=1&rel=0`;
                }
            }
        } else {
            // Mute YouTube video, route audio through Web Audio DSP
            if (this.isIFrameReady && this.player && this.player.mute) {
                try {
                    this.player.mute();
                } catch (e) {}
            }
            this.play();
        }
    }

    async play() {
        if (this.soundMode === 'direct') {
            if (this.isIFrameReady && this.player && this.player.playVideo) {
                try {
                    this.player.unMute();
                    this.player.playVideo();
                } catch (e) {}
            }
            return;
        }

        // DSP Mode: Play video muted + play Web Audio DSP
        if (this.isIFrameReady && this.player && this.player.playVideo) {
            try {
                this.player.mute();
                this.player.playVideo();
            } catch (e) {}
        }

        try {
            await this.audioEngine.play();
            if (this.onAutoplayStarted) this.onAutoplayStarted();
        } catch (err) {
            console.warn("Autoplay blocked by mobile browser:", err);
            if (this.onAutoplayBlocked) {
                this.onAutoplayBlocked();
            }
        }
    }

    pause() {
        if (this.isIFrameReady && this.player && this.player.pauseVideo) {
            try {
                this.player.pauseVideo();
            } catch (e) {}
        }
        this.audioEngine.pause();
    }

    seek(seconds) {
        this.isSeeking = true;
        this.audioEngine.seek(seconds);
        if (this.isIFrameReady && this.player && this.player.seekTo) {
            try {
                this.player.seekTo(seconds, true);
            } catch (e) {}
        }
        setTimeout(() => {
            this.isSeeking = false;
        }, 500);
    }

    setPlaybackRate(rate) {
        this.audioEngine.setTempo(rate);
        if (this.isIFrameReady && this.player && this.player.setPlaybackRate) {
            try {
                this.player.setPlaybackRate(rate);
            } catch (e) {}
        }
    }

    startDriftCorrection() {
        if (this.syncInterval) clearInterval(this.syncInterval);

        this.syncInterval = setInterval(() => {
            if (this.isSeeking || this.soundMode === 'direct') return;
            if (!this.audioEngine.isPlaying) return;
            if (!this.isIFrameReady || !this.player || !this.player.getCurrentTime) return;

            try {
                const ytTime = this.player.getCurrentTime();
                const audioTime = this.audioEngine.currentTime;

                if (Math.abs(ytTime - audioTime) > 0.45) {
                    this.player.seekTo(audioTime, true);
                }
            } catch (e) {}
        }, 1500);
    }

    handlePlayerState(state) {
        if (typeof YT === 'undefined') return;
        if (state === YT.PlayerState.PLAYING) {
            if (this.soundMode === 'dsp') {
                try { this.player.mute(); } catch (e) {}
                if (!this.audioEngine.isPlaying && !this.isSeeking) {
                    this.audioEngine.play().catch(() => {
                        if (this.onAutoplayBlocked) this.onAutoplayBlocked();
                    });
                }
            }
        } else if (state === YT.PlayerState.PAUSED) {
            if (this.audioEngine.isPlaying && !this.isSeeking) {
                this.audioEngine.pause();
            }
        } else if (state === YT.PlayerState.ENDED) {
            this.audioEngine.pause();
        }
    }

    destroy() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        if (this.player && this.player.destroy) {
            try { this.player.destroy(); } catch (e) {}
            this.player = null;
        }
    }
}

window.YouTubeSync = YouTubeSync;
