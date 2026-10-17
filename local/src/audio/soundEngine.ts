import {
  AiVoiceEngineStatus,
  AtcSoundEvent,
  GameSettings,
  SpeechQueueItem,
  VhfStaticLevel,
  VoiceProfileConfig,
} from '../aircraft/types';
import { formatKokoroAviationPhonetics } from '../atc/voiceRecognizer';

export { formatKokoroAviationPhonetics };

export const LOCAL_AI_SERVER_URL = 'http://127.0.0.1:18765';

import { BUILTIN_LOCAL_VOICES, CuratedVoiceItem, getVoiceOption, recommendedSpeechRate, resolveVoiceIdForLanguage } from './voiceCatalog';
export { resolveVoiceIdForLanguage } from './voiceCatalog';
const VHF_GAIN_MAP: Record<VhfStaticLevel, number> = { OFF: 0, LOW: 0.045, MEDIUM: 0.095, HIGH: 0.165 };

/**
 * 兼容并增强中文陆空通话读法格式化（如 09L -> 洞九左, 5213 -> 五两幺三, 航向 090 -> 航向 洞九洞）
 */
export function formatChineseAtcRadiotelephonySpeech(rawCn: string): string {
  return formatKokoroAviationPhonetics(rawCn, 'CN');
}

/**
 * 将 Float32 录音采样数据编码为 16kHz 16-bit 单声道标准 WAV 二进制数据，并自动执行音量增益归一化 (AGC)
 */
function encodeFloat32ToWav16kMono(samples: Float32Array, inputSampleRate: number): { wavBlob: Blob; peakAmp: number } {
  const targetRate = 16000;
  const ratio = inputSampleRate / targetRate;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const buffer = new ArrayBuffer(44 + outLength * 2);
  const view = new DataView(buffer);

  // 计算峰值振幅并进行自动增益放大（防止麦克风声音偏小时 SenseVoice 识别不出）
  let peakAmp = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peakAmp) peakAmp = abs;
  }
  const gainFactor = peakAmp > 0.004 && peakAmp < 0.65 ? Math.min(18.0, 0.82 / peakAmp) : 1.0;

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + outLength * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, outLength * 2, true);

  let offset = 44;
  for (let i = 0; i < outLength; i++) {
    const srcIdx = Math.min(samples.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, samples[srcIdx] * gainFactor));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return {
    wavBlob: new Blob([buffer], { type: 'audio/wav' }),
    peakAmp,
  };
}

/**
 * 航空甚高频 (VHF AM 118.000–136.975 MHz) 电台音效 + SenseVoice Small 双通道收音 + 标准普通话/Kokoro TTS 播音引擎
 */
class AtcSoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private noiseBuffer: AudioBuffer | null = null;
  private activeStaticSource: AudioBufferSourceNode | null = null;
  private activeStaticGain: GainNode | null = null;
  private fallbackStaticTimer: number | null = null;
  private activeBufferSource: AudioBufferSourceNode | null = null;
  private speechQueueChain: Promise<void> = Promise.resolve();
  private speechGenerationId = 0;

  // 常驻内存 LRU 语音缓存（避免重复合成相同指令复诵，降低交互延迟至 <10ms）
  private kokoroAudioCache = new Map<string, AudioBuffer>();
  private lastSpokenPhoneticPreview = '';

  // SenseVoice Small 本地短句收音
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micProcessorNode: ScriptProcessorNode | null = null;
  private micSilentGainNode: GainNode | null = null;
  private recordedChunks: Float32Array[] = [];
  private isRecordingPtt = false;
  private pttSessionId = 0;
  private livePeakVolume = 0;

  // Cancel an in-flight local synthesis when the player starts transmitting.
  private activeTtsController: AbortController | null = null;

  private aiStatus: AiVoiceEngineStatus = {
    connected: false,
    senseVoiceLoaded: false,
    kokoroLoaded: false,
    qwenLoaded: false,
    lastTtsError: '',
    device: '探测本地推理引擎 (127.0.0.1:18765)...',
    cachedUtterancesCount: 0,
    lastLatencyMs: 0,
    endpointUrl: LOCAL_AI_SERVER_URL,
  };

  public getAiEngineStatus(): AiVoiceEngineStatus {
    return {
      ...this.aiStatus,
      cachedUtterancesCount: this.kokoroAudioCache.size,
    };
  }

  public getLastPhoneticPreview(): string {
    return this.lastSpokenPhoneticPreview;
  }

  public getLiveMicVolumePercent(): number {
    return Math.min(100, Math.round(this.livePeakVolume * 220));
  }

  /**
   * 探测本地启动器部署的 SenseVoice Small + Kokoro TTS + 标准普通话服务状态
   */
  public async checkLocalAiEngineHealth(): Promise<AiVoiceEngineStatus> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return this.getAiEngineStatus();
    }
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 1100);
      const res = await fetch('http://127.0.0.1:18765/api/health', {
        method: 'GET',
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        this.aiStatus = {
          connected: true,
          senseVoiceLoaded: Boolean(data.sensevoice_ready),
          kokoroLoaded: Boolean(data.kokoro_ready),
          qwenLoaded: Boolean(data.qwen_ready),
          lastTtsError: this.aiStatus.lastTtsError,
          device: data.device || 'Local RAM Resident (CPU/GPU/MPS)',
          cachedUtterancesCount: (data.cache_size || 0) + this.kokoroAudioCache.size,
          lastLatencyMs: data.last_latency_ms || this.aiStatus.lastLatencyMs,
          endpointUrl: LOCAL_AI_SERVER_URL,
        };
      }
    } catch {
      this.aiStatus = {
        ...this.aiStatus,
        connected: false,
        device: '待启动本地引擎 (请运行 Windows11 / macOS 启动器)',
      };
    }
    return this.getAiEngineStatus();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (mute) {
      this.stopAllSpeech();
    }
  }

  public toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public stopAllSpeech(): void {
    this.speechGenerationId += 1;
    this.stopContinuousVhfStatic();
    if (this.activeBufferSource) {
      try {
        this.activeBufferSource.stop();
        this.activeBufferSource.disconnect();
      } catch {
        // ignore
      }
      this.activeBufferSource = null;
    }
    this.activeTtsController?.abort();
    this.activeTtsController = null;
    this.speechQueueChain = Promise.resolve();
  }

  public getAvailableVoices(preferLang?: 'CN' | 'EN'): CuratedVoiceItem[] {
    const all = [...BUILTIN_LOCAL_VOICES];
    if (preferLang === 'CN') {
      return all.filter((voice) => voice.engine === 'qwen3-tts-0.6b');
    }
    if (preferLang === 'EN') return [...all.filter(voice => voice.engine === 'kokoro-82m'), ...all.filter(voice => voice.engine === 'qwen3-tts-0.6b')];
    return all;
  }

  /**
   * 【阶段 1：按住 Shift 开启短句麦克风收音】
   * 修复重点：
   * 1. 使用 pttSessionId 防止首次 getUserMedia 弹窗授权期间松开 Shift 导致状态卡死；
   * 2. 显式 await ctx.resume() 并挂载零增益节点，确保 ScriptProcessorNode 100% 持续触发采样；
   * 3. 收音时显示本地麦克风电平，松键后由本地 SenseVoice 识别。
   */
  public async startPttRecording(
    _preferLang: 'CN' | 'EN' = 'CN',
    onInterimUpdate?: (liveText: string, volPct: number) => void
  ): Promise<{ ok: boolean; errorMsg?: string }> {
    const sessionId = ++this.pttSessionId;
    this.isRecordingPtt = true;
    this.recordedChunks = [];
    this.livePeakVolume = 0;


    // Recognition stays on the local SenseVoice model; no browser speech service.

    if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        errorMsg: '当前浏览器不支持 getUserMedia 麦克风采样',
      };
    }

    try {
      if (!this.micStream) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.micStream = stream;
      }

      // 如果在等待麦克风权限弹窗期间用户已经松开了 Shift，立即终止本次录音
      if (this.pttSessionId !== sessionId || !this.isRecordingPtt) {
        return { ok: false, errorMsg: '麦克风已授权完成，请再次按住 Shift 键说话即可识别！' };
      }

      const ctx = this.ensureContext(true);
      if (!ctx) {
        return { ok: false, errorMsg: 'AudioContext 音频上下文初始化失败' };
      }
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // ignore
        }
      }

      if (!this.micSourceNode || !this.micProcessorNode) {
        this.micSourceNode = ctx.createMediaStreamSource(this.micStream);
        this.micProcessorNode = ctx.createScriptProcessor(2048, 1, 1);
        this.micSilentGainNode = ctx.createGain();
        this.micSilentGainNode.gain.setValueAtTime(0.00001, ctx.currentTime);

        this.micProcessorNode.onaudioprocess = (e: AudioProcessingEvent) => {
          const out = e.outputBuffer.getChannelData(0);
          for (let i = 0; i < out.length; i++) out[i] = 0;

          if (!this.isRecordingPtt) return;
          const input = e.inputBuffer.getChannelData(0);
          const copy = new Float32Array(input.length);
          let chunkPeak = 0;
          for (let i = 0; i < input.length; i++) {
            const v = input[i];
            copy[i] = v;
            const a = Math.abs(v);
            if (a > chunkPeak) chunkPeak = a;
          }
          this.livePeakVolume = chunkPeak;
          this.recordedChunks.push(copy);

          if (onInterimUpdate && this.recordedChunks.length % 4 === 0) {
            const liveTxt = ''; 
            onInterimUpdate(liveTxt, this.getLiveMicVolumePercent());
          }
        };

        this.micSourceNode.connect(this.micProcessorNode);
        this.micProcessorNode.connect(this.micSilentGainNode);
        this.micSilentGainNode.connect(ctx.destination);
      }

      return { ok: true };
    } catch {
      return {
        ok: false,
        errorMsg: '麦克风权限未开启（请在浏览器地址栏左侧允许麦克风权限）',
      };
    }
  }

  /**
   * 【阶段 2：松开 Shift 结束收音并送入 SenseVoice Small 本地常驻模型完成短句识别】
   * 仅使用本地 SenseVoice Small；失败时返回提示并保留文字指令入口。
   */
  public async stopPttRecordingAndTranscribe(airspaceContext: {
    activeCallsigns: string[];
    waypoints: string[];
    runways: string[];
    lang: 'CN' | 'EN';
  }): Promise<{
    ok: boolean;
    rawTranscript: string;
    itnTranscript: string;
    verifiedTranscript: string;
    alternatives?: string[];
    latencyMs: number;
    engineOffline?: boolean;
    errorDetail?: string;
  }> {
    this.pttSessionId += 1;
    this.isRecordingPtt = false;

    const ctx = this.ctx;
    const sampleRate = ctx?.sampleRate || 48000;
    let totalLen = 0;
    for (const chunk of this.recordedChunks) {
      totalLen += chunk.length;
    }
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of this.recordedChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.recordedChunks = [];

    // 同步等待并行识别流收尾（最多 260ms）


    const durationSec = totalLen / sampleRate;
    const { wavBlob, peakAmp } =
      totalLen > 0
        ? encodeFloat32ToWav16kMono(merged, sampleRate)
        : { wavBlob: new Blob([]), peakAmp: 0 };

    const t0 = performance.now();
    let serverErrorDetail = '';
    let serverOffline = false;

    if (durationSec >= 0.15) {
      try {
        const formData = new FormData();
        formData.append('audio', wavBlob, 'ptt_command.wav');
        formData.append('language', airspaceContext.lang === 'EN' ? 'en' : 'zh');
        formData.append('compare_itn', 'true');
        formData.append('callsigns', JSON.stringify(airspaceContext.activeCallsigns));
        formData.append('waypoints', JSON.stringify(airspaceContext.waypoints));
        formData.append('runways', JSON.stringify(airspaceContext.runways));

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5000);
        const res = await fetch('http://127.0.0.1:18765/api/asr', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const latencyMs = Math.round(performance.now() - t0);
          this.aiStatus.connected = true;
          this.aiStatus.senseVoiceLoaded = Boolean(data.sensevoice_ready ?? true);
          this.aiStatus.lastLatencyMs = latencyMs;

          const verified = (data.verified_text || data.itn_text || data.text || '').trim();
          if (verified) {
            return {
              ok: true,
              rawTranscript: data.raw_text || verified,
              itnTranscript: data.itn_text || verified,
              verifiedTranscript: verified,
              alternatives: [...new Set([data.raw_text, data.itn_text, verified].filter(Boolean))] as string[],
              latencyMs,
            };
          }
          if (data.error) {
            serverErrorDetail = String(data.error);
          }
        } else {
          serverErrorDetail = `HTTP ${res.status}`;
        }
      } catch {
        this.aiStatus.connected = false;
        serverOffline = true;
      }
    }

    if (durationSec < 0.15) {
      return {
        ok: false,
        rawTranscript: '',
        itnTranscript: '',
        verifiedTranscript: '',
        latencyMs: 0,
        errorDetail: '按键时间过短（请按住 Shift 键不放、说完指令后再松开）',
      };
    }

    if (peakAmp < 0.002) {
      return {
        ok: false,
        rawTranscript: '',
        itnTranscript: '',
        verifiedTranscript: '',
        latencyMs: 0,
        errorDetail: '麦克风输入音量为 0（请检查系统麦克风是否静音或未选择正确输入设备）',
      };
    }

    return {
      ok: false,
      rawTranscript: '',
      itnTranscript: '',
      verifiedTranscript: '',
      latencyMs: 0,
      engineOffline: serverOffline,
      errorDetail: serverErrorDetail || undefined,
    };
  }

  private getOrCreateNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const durationSec = 2.0;
    const bufferSize = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      const crackle = Math.random() < 0.0025 ? (Math.random() * 2 - 1) * 0.9 : 0;
      const avionicsHum = Math.sin((2 * Math.PI * 400 * i) / ctx.sampleRate) * 0.06;
      data[i] = Math.max(
        -1,
        Math.min(1, (b0 + b1 + b2 + white * 0.28) * 0.65 + crackle + avionicsHum)
      );
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  public playVhfSquelchBurst(
    phase: 'START' | 'END',
    role: 'ATC' | 'PILOT',
    level: VhfStaticLevel = 'MEDIUM'
  ): void {
    if (this.muted || level === 'OFF') return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const baseGain = VHF_GAIN_MAP[level] || 0.095;
    const now = ctx.currentTime;

    try {
      const clickOsc = ctx.createOscillator();
      const clickGain = ctx.createGain();
      clickOsc.type = 'triangle';
      if (phase === 'START') {
        clickOsc.frequency.setValueAtTime(role === 'ATC' ? 1950 : 2150, now);
        clickOsc.frequency.exponentialRampToValueAtTime(920, now + 0.035);
      } else {
        clickOsc.frequency.setValueAtTime(role === 'ATC' ? 2475 : 2225, now);
        clickOsc.frequency.setValueAtTime(1780, now + 0.04);
      }
      clickGain.gain.setValueAtTime(0.001, now);
      clickGain.gain.exponentialRampToValueAtTime(baseGain * 0.72, now + 0.006);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + (phase === 'START' ? 0.042 : 0.068));
      clickOsc.connect(clickGain);
      clickGain.connect(ctx.destination);
      clickOsc.start(now);
      clickOsc.stop(now + 0.075);

      const burstDuration = phase === 'START' ? 0.085 : 0.125;
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = this.getOrCreateNoiseBuffer(ctx);
      noiseSrc.loop = true;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(role === 'PILOT' ? 1550 : 1280, now);
      bandpass.Q.setValueAtTime(1.1, now);

      const burstGain = ctx.createGain();
      const peak = baseGain * (phase === 'END' ? 1.55 : 1.25);
      burstGain.gain.setValueAtTime(0.001, now);
      burstGain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
      burstGain.gain.exponentialRampToValueAtTime(0.0001, now + burstDuration);

      noiseSrc.connect(bandpass);
      bandpass.connect(burstGain);
      burstGain.connect(ctx.destination);
      noiseSrc.start(now, Math.random() * 1.2);
      noiseSrc.stop(now + burstDuration + 0.01);
    } catch {
      // ignore audio context errors
    }
  }

  public startContinuousVhfStatic(
    role: 'ATC' | 'PILOT',
    level: VhfStaticLevel = 'MEDIUM',
    maxDurationSec = 4.5
  ): void {
    this.stopContinuousVhfStatic();
    if (this.muted || level === 'OFF') return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const baseGain = VHF_GAIN_MAP[level] || 0.095;
    const now = ctx.currentTime;

    try {
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = this.getOrCreateNoiseBuffer(ctx);
      noiseSrc.loop = true;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(role === 'PILOT' ? 1480 : 1220, now);
      bandpass.Q.setValueAtTime(0.95, now);

      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.setValueAtTime(320, now);

      const staticGain = ctx.createGain();
      const roleMultiplier = role === 'PILOT' ? 1.15 : 0.88;
      staticGain.gain.setValueAtTime(0.001, now);
      staticGain.gain.linearRampToValueAtTime(baseGain * 0.58 * roleMultiplier, now + 0.04);

      noiseSrc.connect(highpass);
      highpass.connect(bandpass);
      bandpass.connect(staticGain);
      staticGain.connect(ctx.destination);

      noiseSrc.start(now, Math.random() * 1.0);
      this.activeStaticSource = noiseSrc;
      this.activeStaticGain = staticGain;

      if (typeof window !== 'undefined') {
        this.fallbackStaticTimer = window.setTimeout(() => {
          this.stopContinuousVhfStatic(role, level);
        }, Math.max(450, maxDurationSec * 1000));
      }
    } catch {
      // ignore
    }
  }

  public stopContinuousVhfStatic(
    role: 'ATC' | 'PILOT' = 'PILOT',
    level: VhfStaticLevel = 'MEDIUM'
  ): void {
    if (this.fallbackStaticTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.fallbackStaticTimer);
      this.fallbackStaticTimer = null;
    }
    if (this.activeStaticSource) {
      try {
        this.activeStaticSource.stop();
        this.activeStaticSource.disconnect();
      } catch {
        // ignore
      }
      this.activeStaticSource = null;
      this.activeStaticGain = null;
      this.playVhfSquelchBurst('END', role, level);
    }
  }

  public previewWalkieTalkieSquelch(settings: GameSettings): void {
    const level = settings.vhfStaticLevel === 'OFF' ? 'MEDIUM' : settings.vhfStaticLevel;
    this.playVhfSquelchBurst('START', 'PILOT', level);
    this.startContinuousVhfStatic('PILOT', level, 1.1);
  }

  /**
   * 【阶段 5：标准普通话 / Kokoro TTS + 航空发音预处理 + 无线电音效播报队列】
   */
  public speakQueue(
    items: SpeechQueueItem[],
    settings: GameSettings,
    cancelPrevious = false
  ): void {
    if (this.muted || items.length === 0 || typeof window === 'undefined') {
      return;
    }

    const atcAllowed = settings.atcTtsEnabled !== false;
    const pilotAllowed = settings.pilotTtsEnabled !== false;
    const filteredItems = items.filter((item) => {
      if (item.role === 'ATC') return atcAllowed;
      if (item.role === 'PILOT') return pilotAllowed;
      return true;
    });

    if (filteredItems.length === 0) {
      return;
    }

    const vhfLevel = settings.vhfStaticLevel || 'MEDIUM';

    if (!settings.ttsEnabled) {
      if (vhfLevel !== 'OFF') {
        this.playVhfSquelchBurst('START', filteredItems[0].role, vhfLevel);
        this.startContinuousVhfStatic(filteredItems[0].role, vhfLevel, 0.65);
      }
      return;
    }

    if (cancelPrevious) {
      this.stopAllSpeech();
    }

    const currentGen = this.speechGenerationId;
    for (const item of filteredItems) {
      const profile: VoiceProfileConfig =
        item.role === 'ATC' ? settings.atcVoice : settings.pilotVoice;
      const rawText = settings.ttsLanguage === 'CN' ? item.textCn : item.textEn;

      this.speechQueueChain = this.speechQueueChain
        .then(() => {
          if (this.muted || this.speechGenerationId !== currentGen) return;
          return this.playViaKokoroTtsEngine(
            rawText,
            settings.ttsLanguage,
            profile,
            item.role,
            vhfLevel
          );
        })
        .catch(() => {});
    }
  }

  public previewRoleVoice(role: 'ATC' | 'PILOT', settings: GameSettings, dryPlayback = false): void {
    if (typeof window === 'undefined') return;
    const isImp = settings.altitudeUnit === 'IMPERIAL';
    const altCn = isImp ? '3000 英尺' : '900 米';
    const altEn = isImp ? '3000 FEET' : '900 METERS';
    const sampleText =
      settings.ttsLanguage === 'CN'
        ? role === 'ATC'
          ? `东方航空 5213，左转航向 270，下降并保持 ${altCn}，可以跑道 09L 盲降进近。`
          : `左转航向 270，下降保持 ${altCn}，可以跑道 09L 盲降进近，东方航空 5213。`
        : role === 'ATC'
          ? `B9001, TURN LEFT HEADING 270, DESCEND AND MAINTAIN ${altEn}, CLEARED ILS RUNWAY 09L APPROACH.`
          : `TURN LEFT HEADING 270, DESCEND AND MAINTAIN ${altEn}, CLEARED ILS RUNWAY 09L, B9001.`;

    this.stopAllSpeech();
    const vhfLevel = settings.vhfStaticLevel || 'MEDIUM';
    const profile = role === 'ATC' ? settings.atcVoice : settings.pilotVoice;
    void this.playViaKokoroTtsEngine(sampleText, settings.ttsLanguage, profile, role, vhfLevel, dryPlayback);
  }

  /**
   * 本地 Qwen 普通话 / Kokoro 英文，按模型、音色和语速缓存。
   * 修复重点：
   * - 中文使用所选 Qwen 音色；英文默认 Kokoro，也允许明确选择 Qwen。
   * - 合成失败保留通话文字，不切换模型或音色。
   */
  private async playViaKokoroTtsEngine(
    rawText: string,
    langMode: 'CN' | 'EN',
    profile: VoiceProfileConfig,
    role: 'ATC' | 'PILOT',
    vhfLevel: VhfStaticLevel = 'MEDIUM',
    dryPlayback = false
  ): Promise<void> {
    if (!rawText || typeof window === 'undefined') return;

    const phoneticText = formatKokoroAviationPhonetics(rawText, langMode);
    this.lastSpokenPhoneticPreview = phoneticText;

    // 严格按当前语言 (CN vs EN) 匹配对应的纯正普通话或 Kokoro 英文声源 ID
    const voiceId = resolveVoiceIdForLanguage(profile, role, langMode);
    const engineId = getVoiceOption(voiceId)?.engine || 'kokoro-82m';
    const generation = this.speechGenerationId;
    const speechRate = Number.isFinite(profile.rate) ? Math.max(.9, Math.min(1.5, profile.rate)) : recommendedSpeechRate(langMode);
    const cacheKey = `AUDIO_V2::${engineId}::${voiceId}::${langMode}::${speechRate}::${phoneticText}`;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const cachedBuffer = this.kokoroAudioCache.get(cacheKey);
    if (cachedBuffer) {
      await this.playAudioBufferThroughVhfRadio(cachedBuffer, role, dryPlayback ? 'OFF' : vhfLevel, 1.0, dryPlayback);
      return;
    }

    const controller = new AbortController();
    this.activeTtsController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 125000);
    try {
      const t0 = performance.now();

      const res = await fetch('http://127.0.0.1:18765/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: phoneticText,
          raw_text: rawText,
          voice: voiceId,
          lang: langMode === 'CN' ? 'zh-CN' : 'en-us',
          speed: speechRate,
          role,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`TTS HTTP ${res.status}`);
      }

      if (res.headers.get('X-ATC-TTS-Engine') !== engineId || res.headers.get('X-ATC-TTS-Voice') !== voiceId) {
        throw new Error('Local TTS engine/voice mismatch');
      }
      const arrayBuf = await res.arrayBuffer();
      if (generation !== this.speechGenerationId || this.muted) return;
      const decodedBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));

      if (this.kokoroAudioCache.size >= 128) {
        const oldestKey = this.kokoroAudioCache.keys().next().value;
        if (oldestKey) this.kokoroAudioCache.delete(oldestKey);
      }
      this.kokoroAudioCache.set(cacheKey, decodedBuffer);

      this.aiStatus.connected = true;
      if (engineId === 'qwen3-tts-0.6b') this.aiStatus.qwenLoaded = true;
      else this.aiStatus.kokoroLoaded = true;
      this.aiStatus.lastTtsError = '';
      this.aiStatus.lastLatencyMs = Math.round(performance.now() - t0);
      this.aiStatus.cachedUtterancesCount = this.kokoroAudioCache.size;

      if (generation !== this.speechGenerationId || this.muted) return;
      await this.playAudioBufferThroughVhfRadio(decodedBuffer, role, dryPlayback ? 'OFF' : vhfLevel, 1.0, dryPlayback);
    } catch (error) {
      if (generation !== this.speechGenerationId) return;
      this.aiStatus.lastTtsError = '本地语音合成失败，请检查启动器；通话文字已保留。';
      console.warn('[ATC local TTS]', engineId, voiceId, error);
    } finally {
      window.clearTimeout(timeoutId);
      if (this.activeTtsController === controller) this.activeTtsController = null;
    }
  }

  private playAudioBufferThroughVhfRadio(
    buffer: AudioBuffer,
    role: 'ATC' | 'PILOT',
    vhfLevel: VhfStaticLevel,
    playbackRate = 1.0,
    dryPlayback = false
  ): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.ensureContext();
      if (!ctx) {
        resolve();
        return;
      }

      try {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = Math.max(0.9, Math.min(1.25, playbackRate));

        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.setValueAtTime(260, ctx.currentTime);

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(3800, ctx.currentTime);

        const voiceGain = ctx.createGain();
        voiceGain.gain.setValueAtTime(role === 'ATC' ? 0.96 : 0.94, ctx.currentTime);

        if (dryPlayback) src.connect(voiceGain);
        else {
          src.connect(highpass);
          highpass.connect(lowpass);
          lowpass.connect(voiceGain);
        }
        voiceGain.connect(ctx.destination);

        this.activeBufferSource = src;

        if (vhfLevel !== 'OFF') {
          this.playVhfSquelchBurst('START', role, vhfLevel);
          this.startContinuousVhfStatic(role, vhfLevel, buffer.duration + 0.4);
        }

        src.onended = () => {
          if (this.activeBufferSource === src) {
            this.activeBufferSource = null;
            if (vhfLevel !== 'OFF') this.stopContinuousVhfStatic(role, vhfLevel);
          }
          src.disconnect(); highpass.disconnect(); lowpass.disconnect(); voiceGain.disconnect();
          resolve();
        };

        src.start(0);
      } catch {
        resolve();
      }
    });
  }

  private ensureContext(allowWhenMuted = false): AudioContext | null {
    if ((!allowWhenMuted && this.muted) || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public play(event: AtcSoundEvent): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    switch (event) {
      case 'SELECT': {
        this.playTone(ctx, 880, now, 0.045, 'sine', 0.06);
        break;
      }
      case 'COMMAND': {
        this.playTone(ctx, 587.33, now, 0.05, 'triangle', 0.07);
        this.playTone(ctx, 783.99, now + 0.05, 0.06, 'triangle', 0.07);
        break;
      }
      case 'READBACK': {
        this.playTone(ctx, 1046.5, now + 0.04, 0.06, 'sine', 0.06);
        this.playTone(ctx, 1318.5, now + 0.11, 0.08, 'sine', 0.06);
        break;
      }
      case 'NEW_FLIGHT': {
        this.playTone(ctx, 523.25, now, 0.08, 'sine', 0.07);
        this.playTone(ctx, 659.25, now + 0.09, 0.11, 'sine', 0.07);
        break;
      }
      case 'CONFLICT_WARNING': {
        this.playTone(ctx, 920, now, 0.11, 'sawtooth', 0.11);
        this.playTone(ctx, 680, now + 0.13, 0.11, 'sawtooth', 0.11);
        this.playTone(ctx, 920, now + 0.26, 0.11, 'sawtooth', 0.11);
        break;
      }
      case 'CONFLICT_CRITICAL': {
        for (let i = 0; i < 4; i++) {
          this.playTone(ctx, 1200, now + i * 0.11, 0.08, 'square', 0.13);
        }
        break;
      }
      case 'LANDED': {
        this.playTone(ctx, 523.25, now, 0.09, 'triangle', 0.09);
        this.playTone(ctx, 659.25, now + 0.09, 0.11, 'triangle', 0.09);
        this.playTone(ctx, 783.99, now + 0.18, 0.16, 'triangle', 0.1);
        break;
      }
      case 'VICTORY': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          this.playTone(ctx, freq, now + idx * 0.11, 0.18, 'triangle', 0.12);
        });
        break;
      }
      case 'GAMEOVER': {
        const notes = [440, 392, 349.23, 293.66];
        notes.forEach((freq, idx) => {
          this.playTone(ctx, freq, now + idx * 0.14, 0.2, 'sawtooth', 0.11);
        });
        break;
      }
    }
  }

  private playTone(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    gainVal: number
  ): void {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(gainVal, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    } catch {
      // ignore
    }
  }
}

export const soundEngine = new AtcSoundEngine();
