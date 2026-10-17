import { TtsLanguage, VoiceProfileConfig } from '../aircraft/types';

export interface CuratedVoiceItem {
  voiceURI: string;
  name: string;
  description: string;
  nativeLanguage: string;
  lang: string;
  engine: 'qwen3-tts-0.6b' | 'kokoro-82m';
  isFemale: boolean;
}

// Fixed speakers shipped with Qwen3-TTS-12Hz-0.6B-CustomVoice; no extra model download.
export const QWEN_VOICES: CuratedVoiceItem[] = [
  { voiceURI: 'Vivian', name: 'Vivian · 普通话 · 女声', nativeLanguage: '普通话', description: '明亮、年轻，语气利落。', isFemale: true },
  { voiceURI: 'Serena', name: 'Serena · 普通话 · 女声', nativeLanguage: '普通话', description: '温暖、柔和，年轻女声。', isFemale: true },
  { voiceURI: 'Uncle_Fu', name: 'Uncle_Fu（福叔）· 普通话 · 男声', nativeLanguage: '普通话', description: '低沉、浑厚，成熟稳重。', isFemale: false },
  { voiceURI: 'Dylan', name: 'Dylan · 北京话 · 男声', nativeLanguage: '北京话', description: '年轻、清晰自然，带北京话特点。', isFemale: false },
  { voiceURI: 'Eric', name: 'Eric · 四川成都话 · 男声', nativeLanguage: '四川成都话', description: '活泼、略沙哑，带成都话特点。', isFemale: false },
  { voiceURI: 'Ryan', name: 'Ryan · 原生英语 · 男声', nativeLanguage: '英语', description: '有活力，节奏感较强。', isFemale: false },
  { voiceURI: 'Aiden', name: 'Aiden · 原生美式英语 · 男声', nativeLanguage: '美式英语', description: '明朗、自然，中音清晰。', isFemale: false },
  { voiceURI: 'Ono_Anna', name: 'Ono_Anna（小野安娜）· 原生日语 · 女声', nativeLanguage: '日语', description: '轻快、俏皮，年轻女声。', isFemale: true },
  { voiceURI: 'Sohee', name: 'Sohee · 原生韩语 · 女声', nativeLanguage: '韩语', description: '温暖、情感丰富的女声。', isFemale: true },
].map(voice => ({ ...voice, lang: 'multilingual', engine: 'qwen3-tts-0.6b' as const }));

export const KOKORO_VOICES: CuratedVoiceItem[] = [
  { voiceURI: 'am_adam', name: 'Adam · 美式英语 · 男声', description: '低沉、有力的男声。', nativeLanguage: '美式英语', isFemale: false },
  { voiceURI: 'af_heart', name: 'Heart · 美式英语 · 女声', description: '柔和、自然的女声。', nativeLanguage: '美式英语', isFemale: true },
  { voiceURI: 'am_michael', name: 'Michael · 美式英语 · 男声', description: '成熟、稳重的男声。', nativeLanguage: '美式英语', isFemale: false },
  { voiceURI: 'af_bella', name: 'Bella · 美式英语 · 女声', description: '明亮、利落的女声。', nativeLanguage: '美式英语', isFemale: true },
  { voiceURI: 'bm_george', name: 'George · 英式英语 · 男声', description: '清晰、沉稳的英式男声。', nativeLanguage: '英式英语', isFemale: false },
  { voiceURI: 'bf_emma', name: 'Emma · 英式英语 · 女声', description: '清楚、克制的英式女声。', nativeLanguage: '英式英语', isFemale: true },
].map(voice => ({ ...voice, lang: voice.voiceURI.startsWith('b') ? 'en-GB' : 'en-US', engine: 'kokoro-82m' as const }));

export const BUILTIN_LOCAL_VOICES = [...QWEN_VOICES, ...KOKORO_VOICES];
export function getVoiceOption(id: string): CuratedVoiceItem | undefined {
  return BUILTIN_LOCAL_VOICES.find(voice => voice.voiceURI === id);
}
export function recommendedSpeechRate(lang: TtsLanguage): number { return lang === 'CN' ? 1.2 : 1.12; }

export function resolveVoiceIdForLanguage(profile: VoiceProfileConfig, role: 'ATC' | 'PILOT', lang: TtsLanguage): string {
  const uri = (profile.voiceURI || '').trim();
  const option = getVoiceOption(uri);
  if (option?.engine === 'qwen3-tts-0.6b') return uri; // All nine support cross-language synthesis.
  if (lang === 'EN' && option?.engine === 'kokoro-82m') return uri;
  const female = option ? option.isFemale : /Xiaoxiao|Xiaoyi|^af_|^bf_/.test(uri) || profile.preferredGender === 'FEMALE';
  if (lang === 'CN') {
    if (/Xiaoxiao|zf_xiaoxiao/.test(uri)) return 'Serena';
    if (/Xiaoyi/.test(uri)) return 'Vivian';
    return female ? (role === 'ATC' ? 'Serena' : 'Vivian') : 'Uncle_Fu';
  }
  return female ? (role === 'ATC' ? 'af_heart' : 'af_bella') : (role === 'ATC' ? 'am_adam' : 'am_michael');
}

export function normalizeVoiceProfile(current: VoiceProfileConfig, patch: Partial<VoiceProfileConfig> | undefined,
  role: 'ATC' | 'PILOT', oldLang: TtsLanguage, nextLang: TtsLanguage): VoiceProfileConfig {
  const memory = { ...current.languageProfiles, [oldLang]: { voiceURI: current.voiceURI, rate: current.rate } };
  const target = memory[nextLang];
  const changed = oldLang !== nextLang;
  const gender = getVoiceOption(current.voiceURI)?.isFemale ?? current.preferredGender === 'FEMALE';
  const defaultId = nextLang === 'CN' ? (gender ? (role === 'ATC' ? 'Serena' : 'Vivian') : 'Uncle_Fu')
    : (gender ? (role === 'ATC' ? 'af_heart' : 'af_bella') : (role === 'ATC' ? 'am_adam' : 'am_michael'));
  const requested = patch?.voiceURI ?? (changed ? target?.voiceURI ?? defaultId : current.voiceURI);
  const voiceURI = resolveVoiceIdForLanguage({ ...current, ...patch, voiceURI: requested }, role, nextLang);
  const requestedRate = patch?.rate ?? (changed ? target?.rate ?? recommendedSpeechRate(nextLang) : current.rate);
  const rate = Number.isFinite(requestedRate) ? Math.max(.9, Math.min(1.5, requestedRate)) : recommendedSpeechRate(nextLang);
  const option = getVoiceOption(voiceURI)!;
  return { ...current, ...patch, voiceURI, rate, presetLabel: option.name,
    preferredGender: option.isFemale ? 'FEMALE' : 'MALE',
    languageProfiles: { ...memory, [nextLang]: { voiceURI, rate } } };
}

const VOICE_PREFERENCES_KEY = 'atc2.voice-preferences.v2';
export function saveVoicePreferences(atc: VoiceProfileConfig, pilot: VoiceProfileConfig): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(VOICE_PREFERENCES_KEY, JSON.stringify({ atc, pilot })); } catch { /* private/blocked storage */ }
}
export function loadVoicePreferences(atc: VoiceProfileConfig, pilot: VoiceProfileConfig): { atc: VoiceProfileConfig; pilot: VoiceProfileConfig } {
  const restore = (original: VoiceProfileConfig, saved: any, role: 'ATC' | 'PILOT') => {
    const languageProfiles: VoiceProfileConfig['languageProfiles'] = {};
    for (const language of ['CN', 'EN'] as TtsLanguage[]) {
      const value = saved?.languageProfiles?.[language];
      const option = getVoiceOption(value?.voiceURI);
      if (option && (language === 'EN' || option.engine === 'qwen3-tts-0.6b') && Number.isFinite(value.rate)) {
        languageProfiles[language] = { voiceURI: option.voiceURI, rate: Math.max(.9, Math.min(1.5, value.rate)) };
      }
    }
    const selected = languageProfiles.CN;
    return normalizeVoiceProfile({ ...original, languageProfiles }, selected, role, 'CN', 'CN');
  };
  try {
    const saved = typeof window !== 'undefined' ? JSON.parse(window.localStorage.getItem(VOICE_PREFERENCES_KEY) || '{}') : {};
    return { atc: restore(atc, saved.atc, 'ATC'), pilot: restore(pilot, saved.pilot, 'PILOT') };
  } catch { return { atc: restore(atc, null, 'ATC'), pilot: restore(pilot, null, 'PILOT') }; }
}
