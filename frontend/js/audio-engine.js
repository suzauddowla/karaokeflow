/**
 * KaraokeFlow Audio DSP Engine
 * Real-time Web Audio API processing:
 * - Granular Doppler Pitch Shifter (-6 to +6 semitones)
 * - Synthetic Impulse Response Reverb (KTV Room, Concert Hall, Stage, Arena)
 * - Center-Channel Vocal Reducer (Middle-Side Phase Filter)
 * - Live Vocal Microphone Studio with Reverb & Low Latency Monitoring
 */

class AudioEngine {
    constructor() {
        this.ctx = null;
        this.isInitialized = false;

        // Audio Elements & Sources
        this.audioElement = new Audio();
        this.audioElement.crossOrigin = "anonymous";
        this.mediaSourceNode = null;

        // State variables
        this.pitchSemitones = 0;
        this.tempo = 1.0;
        this.reverbWet = 0.35;
        this.reverbPreset = "ktv";
        this.reverbDecay = 1.6;
        this.isVocalReducerActive = false;
        this.isMicActive = false;
        this.micGainValue = 1.0;

        // Microphone Stream
        this.micStream = null;
        this.micSourceNode = null;
        this.micGainNode = null;
        this.micHighpass = null;
        this.micReverbSend = null;

        // Visualizer Analyser
        this.analyser = null;
        this.dataArray = null;

        // Event callbacks
        this.onTimeUpdate = null;
        this.onEnded = null;
        this.onError = null;
        this.onPlay = null;
        this.onPause = null;
    }

    async init() {
        if (this.isInitialized) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // Unlock audio context on iOS/Chrome autoplay policies
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        this.setupAudioGraph();
        this.setupMediaListeners();
        this.isInitialized = true;
    }

    setupAudioGraph() {
        // 1. Source Node from HTML5 Audio
        this.mediaSourceNode = this.ctx.createMediaElementSource(this.audioElement);

        // 2. Vocal Reducer Section
        this.splitter = this.ctx.createChannelSplitter(2);
        this.merger = this.ctx.createChannelMerger(2);

        // Vocal Reducer DSP nodes (Center Cancellation with Bass Preservation)
        this.vrInvertRight = this.ctx.createGain();
        this.vrInvertRight.gain.value = -1; // Phase inversion
        this.vrBandpass = this.ctx.createBiquadFilter();
        this.vrBandpass.type = "bandpass";
        this.vrBandpass.frequency.value = 1500;
        this.vrBandpass.Q.value = 0.8;

        this.vrDryGain = this.ctx.createGain();
        this.vrWetGain = this.ctx.createGain();
        this.vrDryGain.gain.value = 1.0;
        this.vrWetGain.gain.value = 0.0;

        // 3. Granular Pitch Shifter
        this.pitchShifter = new WebAudioPitchShifter(this.ctx);

        // 4. Reverb Section (Convolver + Dry/Wet matrix)
        this.reverbConvolver = this.ctx.createConvolver();
        this.reverbDryGain = this.ctx.createGain();
        this.reverbWetGain = this.ctx.createGain();
        this.reverbInput = this.ctx.createGain();
        this.reverbOutput = this.ctx.createGain();

        this.updateReverbImpulse(this.reverbDecay);
        this.setReverbMix(this.reverbWet);

        // Connect Reverb Matrix
        this.reverbInput.connect(this.reverbDryGain);
        this.reverbDryGain.connect(this.reverbOutput);

        this.reverbInput.connect(this.reverbConvolver);
        this.reverbConvolver.connect(this.reverbWetGain);
        this.reverbWetGain.connect(this.reverbOutput);

        // 5. Visualizer & Master Output
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;

        // Wire Music Flow:
        // Source -> VocalReducer Matrix -> PitchShifter -> ReverbInput -> MasterGain -> Analyser -> Output
        this.mediaSourceNode.connect(this.vrDryGain);
        this.vrDryGain.connect(this.pitchShifter.input);

        // Wire Vocal Reducer path
        this.mediaSourceNode.connect(this.splitter);
        // Left - Right cancellation into Bandpass
        this.splitter.connect(this.vrBandpass, 0);
        this.splitter.connect(this.vrInvertRight, 1);
        this.vrInvertRight.connect(this.vrBandpass);
        this.vrBandpass.connect(this.vrWetGain);
        this.vrWetGain.connect(this.pitchShifter.input);

        // Pitch Shifter to Reverb
        this.pitchShifter.output.connect(this.reverbInput);

        // Reverb to Master
        this.reverbOutput.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
    }

    setupMediaListeners() {
        this.audioElement.addEventListener('timeupdate', () => {
            if (this.onTimeUpdate) {
                this.onTimeUpdate(this.audioElement.currentTime, this.audioElement.duration || 0);
            }
        });

        this.audioElement.addEventListener('play', () => {
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            if (this.onPlay) this.onPlay();
        });

        this.audioElement.addEventListener('pause', () => {
            if (this.onPause) this.onPause();
        });

        this.audioElement.addEventListener('ended', () => {
            if (this.onEnded) this.onEnded();
        });

        this.audioElement.addEventListener('error', (e) => {
            if (this.onError) this.onError(e);
        });
    }

    // ==========================================
    // Playback Controls
    // ==========================================
    loadAudio(url) {
        this.audioElement.src = url;
        this.audioElement.load();
    }

    play() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.audioElement.play();
    }

    pause() {
        this.audioElement.pause();
    }

    seek(seconds) {
        if (Number.isFinite(seconds)) {
            this.audioElement.currentTime = seconds;
        }
    }

    get currentTime() {
        return this.audioElement.currentTime;
    }

    get duration() {
        return this.audioElement.duration || 0;
    }

    get isPlaying() {
        return !this.audioElement.paused && !this.audioElement.ended;
    }

    // ==========================================
    // Real-Time Pitch Shifting
    // ==========================================
    setPitch(semitones) {
        this.pitchSemitones = Math.max(-6, Math.min(6, semitones));
        if (this.pitchShifter) {
            this.pitchShifter.setPitch(this.pitchSemitones);
        }
        return this.pitchSemitones;
    }

    pitchUp() {
        return this.setPitch(this.pitchSemitones + 1);
    }

    pitchDown() {
        return this.setPitch(this.pitchSemitones - 1);
    }

    pitchReset() {
        return this.setPitch(0);
    }

    // ==========================================
    // Tempo / Speed Control
    // ==========================================
    setTempo(speed) {
        this.tempo = Math.max(0.7, Math.min(1.3, speed));
        this.audioElement.playbackRate = this.tempo;
        return this.tempo;
    }

    // ==========================================
    // Reverberation Engine (Impulse Synthesis)
    // ==========================================
    setReverbPreset(name) {
        this.reverbPreset = name;
        switch (name) {
            case 'off':
                this.setReverbMix(0.0);
                return;
            case 'ktv':
                this.reverbDecay = 1.4;
                this.setReverbMix(0.38);
                break;
            case 'hall':
                this.reverbDecay = 2.6;
                this.setReverbMix(0.50);
                break;
            case 'stage':
                this.reverbDecay = 1.9;
                this.setReverbMix(0.42);
                break;
            case 'arena':
                this.reverbDecay = 4.2;
                this.setReverbMix(0.60);
                break;
            default:
                this.reverbDecay = 1.4;
                this.setReverbMix(0.38);
        }
        this.updateReverbImpulse(this.reverbDecay);
    }

    setReverbMix(wetLevel) {
        this.reverbWet = Math.max(0, Math.min(1, wetLevel));
        if (this.reverbDryGain && this.reverbWetGain && this.ctx) {
            // Equal-power crossfade with smooth transition
            const dry = Math.cos(this.reverbWet * 0.5 * Math.PI);
            const wet = Math.sin(this.reverbWet * 0.5 * Math.PI) * 0.85;
            this.reverbDryGain.gain.setTargetAtTime(dry, this.ctx.currentTime, 0.03);
            this.reverbWetGain.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.03);
        }
    }

    setReverbDecay(seconds) {
        this.reverbDecay = Math.max(0.4, Math.min(5.0, seconds));
        this.updateReverbImpulse(this.reverbDecay);
    }

    updateReverbImpulse(decayDuration) {
        if (!this.ctx) return;
        const rate = this.ctx.sampleRate;
        const length = Math.max(1024, Math.floor(rate * decayDuration));
        const impulse = this.ctx.createBuffer(2, length, rate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        // 1. Acoustic parameters
        const preDelaySec = Math.min(0.025, decayDuration * 0.015);
        const preDelaySamples = Math.floor(rate * preDelaySec);
        
        // Early reflection taps: [delaySec, gainL, gainR]
        const earlyTaps = [
            [0.015, 0.45, 0.25],
            [0.028, 0.20, 0.40],
            [0.042, 0.35, 0.30],
            [0.059, 0.22, 0.18],
            [0.076, 0.15, 0.24],
            [0.095, 0.12, 0.10]
        ];

        for (const [tapSec, gainL, gainR] of earlyTaps) {
            const tapIdx = Math.floor(rate * tapSec);
            if (tapIdx < length) {
                left[tapIdx] += gainL;
                right[tapIdx] += gainR;
            }
        }

        // 2. Late diffuse reverberation with air absorption (lowpass roll-off)
        let prevL = 0;
        let prevR = 0;
        const decayRate = 5.0 / decayDuration;

        for (let i = preDelaySamples; i < length; i++) {
            const t = (i - preDelaySamples) / rate;
            const env = Math.exp(-decayRate * t);

            // High frequency absorption: damp factor increases over time
            const damp = Math.min(0.85, 0.25 + 0.4 * (i / length));

            const noiseL = (Math.random() * 2 - 1) * env;
            const noiseR = (Math.random() * 2 - 1) * env;

            prevL = prevL * damp + noiseL * (1 - damp);
            prevR = prevR * damp + noiseR * (1 - damp);

            left[i] += prevL;
            right[i] += prevR;
        }

        // 3. RMS normalization to guarantee consistent studio volume
        let sumSq = 0;
        for (let i = 0; i < length; i++) {
            sumSq += left[i] * left[i] + right[i] * right[i];
        }
        const rms = Math.sqrt(sumSq / (length * 2)) || 1.0;
        const targetRms = 0.22;
        const normFactor = targetRms / rms;

        for (let i = 0; i < length; i++) {
            left[i] = Math.max(-1.0, Math.min(1.0, left[i] * normFactor));
            right[i] = Math.max(-1.0, Math.min(1.0, right[i] * normFactor));
        }

        this.reverbConvolver.buffer = impulse;
    }

    // ==========================================
    // Vocal Reducer (Center Cancellation)
    // ==========================================
    toggleVocalReducer() {
        this.isVocalReducerActive = !this.isVocalReducerActive;
        if (this.isVocalReducerActive) {
            this.vrDryGain.gain.setTargetAtTime(0.15, this.ctx.currentTime, 0.05);
            this.vrWetGain.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.05);
        } else {
            this.vrDryGain.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.05);
            this.vrWetGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.05);
        }
        return this.isVocalReducerActive;
    }

    // ==========================================
    // Live Vocal Microphone Studio
    // ==========================================
    async startMicrophone() {
        if (this.isMicActive) return true;
        try {
            await this.init();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    latency: 0
                }
            });

            this.micStream = stream;
            this.micSourceNode = this.ctx.createMediaStreamSource(stream);

            // Vocal Chain: Highpass (80Hz) -> Peaking EQ (3.2kHz) -> Mic Gain -> Reverb & Master
            this.micHighpass = this.ctx.createBiquadFilter();
            this.micHighpass.type = "highpass";
            this.micHighpass.frequency.value = 85; // Low-end rumble filter

            this.micPresence = this.ctx.createBiquadFilter();
            this.micPresence.type = "peaking";
            this.micPresence.frequency.value = 3200;
            this.micPresence.gain.value = 3.0; // Vocal shine

            this.micGainNode = this.ctx.createGain();
            this.micGainNode.gain.value = this.micGainValue;

            // Mic Reverb Send
            this.micReverbSend = this.ctx.createGain();
            this.micReverbSend.gain.value = 0.45; // Dedicated vocal reverb depth

            // Connections
            this.micSourceNode.connect(this.micHighpass);
            this.micHighpass.connect(this.micPresence);
            this.micPresence.connect(this.micGainNode);

            // Direct vocal to master
            this.micGainNode.connect(this.masterGain);

            // Send vocal to Reverb engine
            this.micGainNode.connect(this.micReverbSend);
            this.micReverbSend.connect(this.reverbConvolver);

            this.isMicActive = true;
            return true;
        } catch (err) {
            console.error("Microphone access failed:", err);
            this.isMicActive = false;
            throw err;
        }
    }

    stopMicrophone() {
        if (!this.isMicActive) return;
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }
        if (this.micSourceNode) {
            this.micSourceNode.disconnect();
            this.micSourceNode = null;
        }
        this.isMicActive = false;
    }

    setMicGain(val) {
        this.micGainValue = Math.max(0, Math.min(2.5, val));
        if (this.micGainNode) {
            this.micGainNode.gain.setTargetAtTime(this.micGainValue, this.ctx.currentTime, 0.02);
        }
    }

    setMicReverbSend(val) {
        if (this.micReverbSend) {
            this.micReverbSend.gain.setTargetAtTime(val, this.ctx.currentTime, 0.02);
        }
    }

    // ==========================================
    // Audio Visualizer Frequency Data
    // ==========================================
    getFrequencyData() {
        if (!this.analyser) return null;
        this.analyser.getByteFrequencyData(this.dataArray);
        return this.dataArray;
    }
}

/**
 * WebAudioPitchShifter
 * Real-time zero-latency Pitch Shifter using Granular Doppler delay modulation.
 * Works seamlessly with streaming audio without buffer lag.
 */
class WebAudioPitchShifter {
    constructor(ctx) {
        this.ctx = ctx;
        this.semitones = 0;

        this.input = ctx.createGain();
        this.output = ctx.createGain();

        this.bypassGain = ctx.createGain();
        this.effectGain = ctx.createGain();
        this.bypassGain.gain.value = 1.0;
        this.effectGain.gain.value = 0.0;

        // Grain duration: 65ms (optimal vocal/music pitch balance)
        this.grainDuration = 0.065;
        this.baseDelay = 0.025; // 25ms base delay prevents negative delay clamping

        // Dual delay lines for overlapping crossfade
        this.delayA = ctx.createDelay(1.0);
        this.delayB = ctx.createDelay(1.0);
        this.delayA.delayTime.value = this.baseDelay;
        this.delayB.delayTime.value = this.baseDelay;

        // CRITICAL: Gain nodes must start with gain = 0 so Hann window (0 to 1) provides the exact gain without DC offset
        this.gainA = ctx.createGain();
        this.gainB = ctx.createGain();
        this.gainA.gain.value = 0.0;
        this.gainB.gain.value = 0.0;

        // Create modulation curves
        this.setupModulation();

        // Wire graph
        this.input.connect(this.bypassGain);
        this.bypassGain.connect(this.output);

        this.input.connect(this.delayA);
        this.input.connect(this.delayB);

        this.delayA.connect(this.gainA);
        this.delayB.connect(this.gainB);

        this.gainA.connect(this.effectGain);
        this.gainB.connect(this.effectGain);
        this.effectGain.connect(this.output);
    }

    setupModulation() {
        const rate = this.ctx.sampleRate;
        const length = rate; // 1 second normalized buffer
        const modBuffer = this.ctx.createBuffer(2, length, rate);
        const lfoDataA = modBuffer.getChannelData(0);
        const lfoDataB = modBuffer.getChannelData(1);

        // Cyclic normalized phase [0, 1)
        for (let i = 0; i < length; i++) {
            const phaseA = i / length;
            const phaseB = (phaseA + 0.5) % 1.0;
            lfoDataA[i] = phaseA;
            lfoDataB[i] = phaseB;
        }

        // LFO Players
        this.lfoSource = this.ctx.createBufferSource();
        this.lfoSource.buffer = modBuffer;
        this.lfoSource.loop = true;

        this.lfoSplitter = this.ctx.createChannelSplitter(2);
        this.lfoSource.connect(this.lfoSplitter);

        this.lfoModA = this.ctx.createGain();
        this.lfoModB = this.ctx.createGain();
        this.lfoModA.gain.value = 0.0;
        this.lfoModB.gain.value = 0.0;

        this.lfoSplitter.connect(this.lfoModA, 0);
        this.lfoSplitter.connect(this.lfoModB, 1);

        this.lfoModA.connect(this.delayA.delayTime);
        this.lfoModB.connect(this.delayB.delayTime);

        // Hann windows: sin^2(pi * phi) for A, cos^2(pi * phi) for B
        // sin^2 + cos^2 = 1.0 constant sum -> NO Tremolo, NO Clicks!
        const winBuffer = this.ctx.createBuffer(2, length, rate);
        const winDataA = winBuffer.getChannelData(0);
        const winDataB = winBuffer.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const pA = i / length;
            const pB = (pA + 0.5) % 1.0;
            winDataA[i] = Math.pow(Math.sin(pA * Math.PI), 2);
            winDataB[i] = Math.pow(Math.sin(pB * Math.PI), 2);
        }

        this.winSource = this.ctx.createBufferSource();
        this.winSource.buffer = winBuffer;
        this.winSource.loop = true;

        this.winSplitter = this.ctx.createChannelSplitter(2);
        this.winSource.connect(this.winSplitter);
        this.winSplitter.connect(this.gainA.gain, 0);
        this.winSplitter.connect(this.gainB.gain, 1);

        this.lfoSource.start();
        this.winSource.start();
    }

    setPitch(semitones) {
        this.semitones = semitones;
        const now = this.ctx.currentTime;

        if (semitones === 0) {
            // Pure bit-perfect bypass when pitch is 0
            this.bypassGain.gain.setTargetAtTime(1.0, now, 0.02);
            this.effectGain.gain.setTargetAtTime(0.0, now, 0.02);
            return;
        }

        // Active pitch shift
        this.bypassGain.gain.setTargetAtTime(0.0, now, 0.02);
        this.effectGain.gain.setTargetAtTime(1.0, now, 0.02);

        // Exact Doppler frequency ratio: R = 2^(semitones / 12)
        const ratio = Math.pow(2, semitones / 12);
        const delta = 1.0 - ratio;
        const f_mod = Math.max(0.1, Math.abs(delta) / this.grainDuration);

        // Pitch up vs Pitch down delay calibration
        const isPitchUp = semitones > 0;
        const targetBaseDelay = isPitchUp ? (this.baseDelay + this.grainDuration) : this.baseDelay;
        const targetModGain = isPitchUp ? -this.grainDuration : this.grainDuration;

        this.delayA.delayTime.setTargetAtTime(targetBaseDelay, now, 0.02);
        this.delayB.delayTime.setTargetAtTime(targetBaseDelay, now, 0.02);

        this.lfoModA.gain.setTargetAtTime(targetModGain, now, 0.02);
        this.lfoModB.gain.setTargetAtTime(targetModGain, now, 0.02);

        this.lfoSource.playbackRate.setTargetAtTime(f_mod, now, 0.02);
        this.winSource.playbackRate.setTargetAtTime(f_mod, now, 0.02);
    }
}

// Global audio engine instance
window.audioEngine = new AudioEngine();
