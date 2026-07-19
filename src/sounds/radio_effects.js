import { getLocalSpeechSegments } from '../utils/localSpeech.js';

const LOCAL_SPEECH_TRAILING_SILENCE_OVERLAP = 0.155;
const LOCAL_SPEECH_MIN_SEGMENT_ADVANCE = 0.12;
const LOCAL_RADIO_BURST_DURATION = 0.075;

export function getLocalSpeechSegmentAdvance(duration) {
  return Math.max(
    LOCAL_SPEECH_MIN_SEGMENT_ADVANCE,
    duration - LOCAL_SPEECH_TRAILING_SILENCE_OVERLAP,
  );
}

// 塔台无线电效果处理工具
class AirTrafficRadioEffects {
  constructor() {
    this.audioContext = null;
    this.initialized = false;
    this.speechUnlocked = false;
    this.localSpeechCache = new Map();
    this.activeSpeechSources = [];
  }

  getLocalSpeechUrl(segment) {
    return new URL(`speech/${segment}.m4a`, document.baseURI).href;
  }

  loadLocalSpeechBuffer(segment) {
    if (this.localSpeechCache.has(segment)) return this.localSpeechCache.get(segment);

    const loading = fetch(this.getLocalSpeechUrl(segment))
      .then(response => {
        if (!response.ok) throw new Error(`Missing local speech segment: ${segment}`);
        return response.arrayBuffer();
      })
      .then(arrayBuffer => new Promise((resolve, reject) => {
        this.audioContext.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      }));
    this.localSpeechCache.set(segment, loading);
    return loading;
  }

  scheduleLocalRadioBurst(startTime, duration = LOCAL_RADIO_BURST_DURATION, volume = 0.035) {
    const context = this.audioContext;
    if (!context?.createBuffer || !context.createBufferSource || !context.createGain) return null;

    const sampleRate = context.sampleRate || 44100;
    const frameCount = Math.max(1, Math.round(sampleRate * duration));
    const noiseBuffer = context.createBuffer(1, frameCount, sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      samples[index] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = noiseBuffer;

    const filter = context.createBiquadFilter?.();
    if (filter) {
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.75;
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(context.destination);

    const fadeTime = Math.min(0.01, duration / 4);
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + fadeTime);
    gain.gain.setValueAtTime(volume, startTime + duration - fadeTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    source.start(startTime);
    source.stop(startTime + duration);
    return source;
  }

  async playLocalSpeech(text) {
    if ((!this.initialized && !this.init()) || !this.audioContext) {
      throw new Error('Local speech audio is unavailable');
    }
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();

    const segments = getLocalSpeechSegments(text);
    if (!segments.length) throw new Error('No local speech segments were generated');
    const buffers = await Promise.all(segments.map(segment => this.loadLocalSpeechBuffer(segment)));

    this.activeSpeechSources.forEach(source => {
      try { source.stop(); } catch (error) { /* Source may already be stopped. */ }
    });
    this.activeSpeechSources = [];

    return new Promise(resolve => {
      const transmissionStart = this.audioContext.currentTime + 0.025;
      const openingBurst = this.scheduleLocalRadioBurst(transmissionStart);
      let startTime = transmissionStart + LOCAL_RADIO_BURST_DURATION + 0.025;
      let finalSpeechSource = null;
      buffers.forEach(buffer => {
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start(startTime);
        this.activeSpeechSources.push(source);
        finalSpeechSource = source;
        // The bundled Samantha clips contain about 0.17-0.20 seconds of
        // trailing silence. Overlap that silence so callsigns and instructions
        // sound like one continuous transmission on mobile Safari.
        startTime += getLocalSpeechSegmentAdvance(buffer.duration);
      });

      const closingBurst = this.scheduleLocalRadioBurst(startTime + 0.025);
      if (openingBurst) this.activeSpeechSources.push(openingBurst);
      if (closingBurst) this.activeSpeechSources.push(closingBurst);

      const completionSource = closingBurst || finalSpeechSource;
      completionSource.onended = () => {
        this.activeSpeechSources = [];
        resolve();
      };
    });
  }

  // 初始化音频上下文
  init() {
    if (this.initialized) return true;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn('Web Audio API is not supported in this browser');
        return false;
      }

      this.audioContext = new AudioContext();
      this.initialized = true;
      return true;
    } catch (e) {
      console.error('Failed to initialize Audio Context:', e);
      return false;
    }
  }

  unlock() {
    const audioReady = this.initialized || this.init();
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const synthesis = window.speechSynthesis;
    if (synthesis?.paused) synthesis.resume();
    if (synthesis && !this.speechUnlocked) {
      this.speechUnlocked = true;
    }
    return audioReady;
  }

  // 创建失真曲线
  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;

    for (let i = 0; i < n_samples; i++) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // 添加静电噪音
  addRadioNoise(duration = 500, volume = 0.05) {
    if (!this.initialized && !this.init()) {
      return null;
    }

    try {
      // 创建音频处理节点
      const bufferSize = 4096;
      let noiseProcessor;

      // 尝试使用不同的API方法创建处理器节点
      if (this.audioContext.createScriptProcessor) {
        noiseProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        // 生成静电噪音
        noiseProcessor.onaudioprocess = (e) => {
          const output = e.outputBuffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            // 基础静电噪音
            output[i] = (Math.random() * 2 - 1) * volume;

            // 随机添加噼啪声和爆音
            if (Math.random() > 0.995) {
              output[i] = Math.random() > 0.5 ? volume * 2 : -volume * 2;
            }
          }
        };
      } else if (this.audioContext.createGain) {
        // 备用方案：使用增益节点和振荡器
        noiseProcessor = this.audioContext.createGain();
        noiseProcessor.gain.value = volume * 0.3;

        const noiseSource = this.audioContext.createBufferSource();
        const noiseBuffer = this.audioContext.createBuffer(1, 32768, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        for (let i = 0; i < 32768; i++) {
          output[i] = Math.random() * 2 - 1;
        }

        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        noiseSource.connect(noiseProcessor);
        noiseSource.start();

        setTimeout(() => {
          noiseSource.stop();
        }, duration);
      } else {
        return null;
      }

      // 连接噪音到输出
      noiseProcessor.connect(this.audioContext.destination);

      // 设置定时器停止噪音
      setTimeout(() => {
        noiseProcessor.disconnect();
      }, duration);

      return noiseProcessor;
    } catch (e) {
      console.error('Failed to create radio noise:', e);
      return null;
    }
  }

  // 播放开始通信的哔声
  playBeep(frequency = 1000, duration = 200, volume = 0.1) {
    if (!this.initialized && !this.init()) {
      return null;
    }

    try {
      // 创建振荡器和增益节点
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      // 设置振荡器参数
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      // 连接节点
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // 设置音量和开始播放
      gainNode.gain.value = volume;
      oscillator.start();

      // 设置淡出效果
      setTimeout(() => {
        gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.1);

        // 停止振荡器
        setTimeout(() => {
          oscillator.stop();
        }, 100);
      }, duration - 100);

      return oscillator;
    } catch (e) {
      console.error('Failed to play beep:', e);
      return null;
    }
  }

  // 完整的无线电通信效果
  async applyRadioEffectToSpeech(text, options = {}) {
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      return Promise.reject(new Error('Speech synthesis is unavailable'));
    }

    if (!this.initialized) this.init();
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || 'en-US';
    utterance.pitch = options.pitch ?? 1;
    utterance.rate = options.rate ?? 1;
    utterance.volume = options.volume ?? 1;
    if (options.voice) utterance.voice = options.voice;

    if (!options.immediate && (synthesis.speaking || synthesis.pending)) synthesis.cancel();
    synthesis.resume();

    return new Promise((resolve, reject) => {
      let completed = false;
      let watchdog = null;
      const finish = () => {
        if (completed) return;
        completed = true;
        if (watchdog) clearTimeout(watchdog);
        resolve();
      };

      utterance.onstart = () => {};
      utterance.onend = () => {
        // Keep mobile system speech on a single audio route. Mixing WebAudio
        // noise with TTS can suppress the voice after microphone capture.
        if (!options.immediate && this.initialized) this.addRadioNoise(300, 0.02);
        setTimeout(finish, options.immediate ? 0 : 300);
      };
      utterance.onerror = event => {
        console.warn('Speech synthesis failed:', event.error || 'unknown error');
        if (completed) return;
        completed = true;
        if (watchdog) clearTimeout(watchdog);
        reject(new Error(event.error || 'Speech synthesis failed'));
      };

      const beginSpeech = () => {
        synthesis.resume();
        synthesis.speak(utterance);
        watchdog = setTimeout(finish, 20000);
      };

      if (options.immediate) {
        beginSpeech();
      } else {
        this.addRadioNoise(300, 0.03);
        setTimeout(beginSpeech, 300);
      }
    });
  }
}

// 导出单例实例
export const radioEffects = new AirTrafficRadioEffects();
