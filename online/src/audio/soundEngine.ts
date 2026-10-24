import { synthesizeBuiltin, cancelBuiltinSpeech } from './builtinSpeech';
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

import { availableVoiceOptions, CuratedVoiceItem, chooseBrowserVoice, browserVoices, recommendedSpeechRate, builtinVariant } from './voiceCatalog';
export { resolveVoiceIdForLanguage } from './voiceCatalog';
const VHF_GAIN_MAP: Record<VhfStaticLevel, number> = { OFF: 0, LOW: 0.045, MEDIUM: 0.095, HIGH: 0.165 };

/**
 * 兼容并增强中文陆空通话读法格式化（如 09L -> 洞九左, 5213 -> 五两幺三, 航向 090 -> 航向 洞九洞）
 */
export function formatChineseAtcRadiotelephonySpeech(rawCn: string): string {
  return formatKokoroAviationPhonetics(rawCn, 'CN');
}

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

  private lastSpokenPhoneticPreview = '';

  private recognitionSession: any = null;
  private finishBrowserSpeech: (() => void) | null = null;
  private aiStatus: AiVoiceEngineStatus = {
    connected: false, senseVoiceLoaded: false, kokoroLoaded: false, qwenLoaded: false,
    lastTtsError: '', device: 'Browser speech', cachedUtterancesCount: 0,
    lastLatencyMs: 0, endpointUrl: '',
  };
  private builtinStatus = '';
  public getBuiltinSpeechStatus(): string { return this.builtinStatus; }
  private updateBuiltinStatus(message: string): void {
    this.builtinStatus = message;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('atc-voice-status'));
  }
  public getBrowserSpeechCapabilities() {
    const scope = typeof window === 'undefined' ? {} : window as any;
    return { synthesis: Boolean(scope.speechSynthesis || (scope.Worker && (scope.AudioContext || scope.webkitAudioContext))),
      recognition: Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition),
      secure: Boolean(scope.isSecureContext), voices: browserVoices().length };
  }
  public getAiEngineStatus(): AiVoiceEngineStatus {
    return {
      ...this.aiStatus,
      cachedUtterancesCount: 0,
    };
  }

  public getLastPhoneticPreview(): string {
    return this.lastSpokenPhoneticPreview;
  }

  public getLiveMicVolumePercent(): number { return 0; }
  public async checkLocalAiEngineHealth(): Promise<AiVoiceEngineStatus> {
    const caps=this.getBrowserSpeechCapabilities();
    this.aiStatus.connected=caps.synthesis;
    this.aiStatus.device='Browser speech';
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
    cancelBuiltinSpeech();
    this.updateBuiltinStatus('');
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
    if(typeof window !== 'undefined') window.speechSynthesis?.cancel();
    this.finishBrowserSpeech?.();
    this.speechQueueChain = Promise.resolve();
  }

  public getAvailableVoices(lang: 'CN' | 'EN' = 'CN'): CuratedVoiceItem[] { return availableVoiceOptions(lang); }

  public cancelPttRecording(): void {
    const session=this.recognitionSession;
    if(!session) return;
    session.error='已取消本次语音';
    session.complete();
    try { session.recognition.abort(); } catch {}
    this.recognitionSession=null;
  }

  public async startPttRecording(lang: 'CN'|'EN'='CN', onInterimUpdate?: (text:string, volume:number)=>void): Promise<{ok:boolean;errorMsg?:string}> {
    this.cancelPttRecording();
    if(typeof window==='undefined') return {ok:false,errorMsg:'当前浏览器不支持语音识别，请使用文字输入'};
    const Recognition=(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if(!Recognition) return {ok:false,errorMsg:'当前浏览器不支持语音识别，请尝试 Chrome 或使用文字输入'};
    if(!window.isSecureContext) return {ok:false,errorMsg:'语音识别需要 HTTPS，请使用正式网页地址'};
    const recognition=new Recognition();
    let finish!:()=>void;
    const done=new Promise<void>(resolve=>{finish=resolve;});
    const session:any={recognition,done,parts:[],alternatives:[],error:'',ended:false,released:false,started:false,
      complete:()=>{if(!session.ended){session.ended=true;finish();}}};
    this.recognitionSession=session;
    recognition.lang=lang==='CN'?'zh-CN':'en-US';
    recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=5;
    recognition.onstart=()=>{session.started=true;if(session.released){try{recognition.stop();}catch{}}};
    recognition.onresult=(event:any)=>{
      if(this.recognitionSession!==session || session.ended) return;
      let interim='';
      for(let i=event.resultIndex;i<event.results.length;i++) {
        const result=event.results[i];
        if(result.isFinal){session.parts[i]=result[0].transcript;session.alternatives[i]=Array.from(result,(v:any)=>v.transcript);}
        else interim+=result[0].transcript;
      }
      onInterimUpdate?.(session.parts.filter(Boolean).join(' ')+(interim?' '+interim:''),0);
    };
    recognition.onerror=(event:any)=>{
      const errors:Record<string,string>={
        'not-allowed':'麦克风权限未开启，请在地址栏允许麦克风后重试',
        'service-not-allowed':'浏览器语音服务不可用，请尝试 Chrome 或使用文字输入',
        'audio-capture':'未找到可用麦克风，请检查系统输入设备',
        'network':'浏览器语音识别服务连接失败，请检查网络或使用文字输入',
        'no-speech':'未听清指令，请按住 Shift 说话后再松开',
        'language-not-supported':'浏览器暂不支持此识别语言，请使用文字输入',
        'aborted':'本次语音已取消，请重新按住 Shift 说话',
      };
      session.error=errors[event.error] || '语音识别失败，请重试或使用文字输入';session.complete();
    };
    recognition.onend=()=>session.complete();
    try{recognition.start();return {ok:true};}
    catch{session.error='语音识别无法启动，请重试或使用文字输入';session.complete();return {ok:false,errorMsg:session.error};}
  }

  public async stopPttRecordingAndTranscribe(_context:{activeCallsigns:string[];waypoints:string[];runways:string[];lang:'CN'|'EN'}) {
    const start=performance.now(),session=this.recognitionSession;
    const failure=(errorDetail:string)=>({ok:false,rawTranscript:'',itnTranscript:'',verifiedTranscript:'',alternatives:[] as string[],latencyMs:0,errorDetail,engineOffline:false});
    if(!session) return failure('当前没有可用的语音识别，请使用文字输入或重新按住 Shift');
    session.released=true;
    if(!session.ended && session.started){try{session.recognition.stop();}catch{}}
    let timeout:ReturnType<typeof setTimeout>|undefined;
    await Promise.race([session.done,new Promise<void>(resolve=>{timeout=setTimeout(()=>{
      session.error='语音识别等待超时，请重试或使用文字输入';
      session.complete();try{session.recognition.abort();}catch{}resolve();
    },8000);})]);
    clearTimeout(timeout);
    if(this.recognitionSession!==session) return failure('本次语音已取消');
    this.recognitionSession=null;
    if(session.error) return failure(session.error);
    const text=session.parts.filter(Boolean).join(' ').trim();
    if(!text) return failure('未听清指令，请按住 Shift 说话后再松开');
    const alternatives:string[]=[];
    for(let n=0;n<5;n++) alternatives.push(session.parts.map((part:string,i:number)=>session.alternatives[i]?.[n]||part).filter(Boolean).join(' ').trim());
    return {ok:true,rawTranscript:text,itnTranscript:text,verifiedTranscript:text,alternatives:[...new Set(alternatives)],latencyMs:Math.round(performance.now()-start),errorDetail:'',engineOffline:false};
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
   * 浏览器航空通话播报队列
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
          return this.playViaBrowserSpeech(
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
    void this.playViaBrowserSpeech(sampleText, settings.ttsLanguage, profile, role, vhfLevel, dryPlayback);
  }

  private async playBuiltinSpeech(rawText: string, lang: 'CN' | 'EN', profile: VoiceProfileConfig,
    role: 'ATC' | 'PILOT', variant: string, level: VhfStaticLevel, dry: boolean): Promise<void> {
    const generation = this.speechGenerationId;
    const ctx = this.ensureContext();
    if (!ctx) { this.aiStatus.lastTtsError = '无法启动内置男声，请点击试听重试'; this.updateBuiltinStatus(''); return; }
    this.lastSpokenPhoneticPreview = formatKokoroAviationPhonetics(rawText, lang);
    this.aiStatus.lastTtsError = '';
    this.updateBuiltinStatus('正在加载或合成内置男声…');
    try {
      const audio = await synthesizeBuiltin(this.lastSpokenPhoneticPreview, lang, variant, Number.isFinite(profile.rate) ? profile.rate : recommendedSpeechRate(lang));
      if (generation !== this.speechGenerationId || this.muted) return;
      this.updateBuiltinStatus('');
      const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
      buffer.getChannelData(0).set(audio.samples);
      await new Promise<void>(resolve => {
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination);
        this.activeBufferSource = source;
        let done = false;
        const finish = () => { if (done) return; done = true; source.disconnect();
          if (this.activeBufferSource === source) this.activeBufferSource = null;
          if (this.finishBrowserSpeech === finish) this.finishBrowserSpeech = null;
          this.stopContinuousVhfStatic(role, dry ? 'OFF' : level); resolve(); };
        source.onended = finish; this.finishBrowserSpeech = finish;
        try {
          source.start(); this.aiStatus.lastTtsError = '';
          if (!dry && level !== 'OFF') { this.playVhfSquelchBurst('START', role, level); this.startContinuousVhfStatic(role, level, buffer.duration + 1); }
        } catch { finish(); throw new Error('Audio playback failed'); }
      });
    } catch (error) {
      if (generation === this.speechGenerationId) { this.aiStatus.lastTtsError = '内置男声加载或播放失败，请检查网络后点击试听重试；通话文字已保留'; this.updateBuiltinStatus(''); }
    }
  }

  /** Use the bundled male engine when Safari provides no male voice. */
  private async playViaBrowserSpeech(rawText:string,lang:'CN'|'EN',profile:VoiceProfileConfig,role:'ATC'|'PILOT',level:VhfStaticLevel='MEDIUM',dry=false):Promise<void> {
    if(!rawText || typeof window==='undefined') return;
    const variant = builtinVariant(profile, role, lang);
    if (variant) return this.playBuiltinSpeech(rawText, lang, profile, role, variant, level, dry);
    const synth=window.speechSynthesis,generation=this.speechGenerationId;
    if(!synth || !window.SpeechSynthesisUtterance){this.aiStatus.lastTtsError='浏览器不支持语音播报，通话文字已保留';return;}
    if(!browserVoices().length) await new Promise<void>(resolve=>{
      let timer:ReturnType<typeof setTimeout>;
      const finish=()=>{clearTimeout(timer);synth.removeEventListener('voiceschanged',changed);resolve();};
      const changed=()=>{if(browserVoices().length)finish();};
      synth.addEventListener('voiceschanged',changed);timer=setTimeout(finish,1500);
    });
    if(generation!==this.speechGenerationId || this.muted)return;
    // Re-evaluate: Safari may expose installed voices after the first utterance.
    const voice=chooseBrowserVoice(profile,role,lang);
    if(!voice){this.aiStatus.lastTtsError='未找到当前语言的声音，请检查系统语音设置；通话文字已保留';return;}
    this.lastSpokenPhoneticPreview=formatKokoroAviationPhonetics(rawText,lang);
    await new Promise<void>(resolve=>{
      const utterance=new SpeechSynthesisUtterance(this.lastSpokenPhoneticPreview);
      utterance.voice=voice!;utterance.lang=voice!.lang;utterance.pitch=1;
      utterance.rate=Number.isFinite(profile.rate)?Math.max(.9,Math.min(1.5,profile.rate)):recommendedSpeechRate(lang);
      let done=false,timer:ReturnType<typeof setTimeout>;
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);this.stopContinuousVhfStatic(role,dry?'OFF':level);
        if(this.finishBrowserSpeech===finish)this.finishBrowserSpeech=null;resolve();};
      this.finishBrowserSpeech=finish;
      utterance.onstart=()=>{if(generation!==this.speechGenerationId){finish();return;}
        this.aiStatus.lastTtsError='';if(!dry&&level!=='OFF'){this.playVhfSquelchBurst('START',role,level);this.startContinuousVhfStatic(role,level,30);}};
      utterance.onend=finish;
      utterance.onerror=(event)=>{if(generation===this.speechGenerationId && event.error!=='canceled' && event.error!=='interrupted')this.aiStatus.lastTtsError='浏览器语音播报失败，通话文字已保留';finish();};
      timer=setTimeout(()=>{if(generation===this.speechGenerationId){this.aiStatus.lastTtsError='语音播报等待超时，通话文字已保留';synth.cancel();}finish();},45000);
      try{synth.speak(utterance);}catch{this.aiStatus.lastTtsError='浏览器语音播报失败，通话文字已保留';finish();}
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
