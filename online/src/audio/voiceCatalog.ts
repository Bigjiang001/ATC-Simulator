import { TtsLanguage, VoiceProfileConfig } from '../aircraft/types';
export interface CuratedVoiceItem {
  voiceURI: string; name: string; description: string; nativeLanguage: string; lang: string;
  engine: 'browser'; isFemale: boolean; gender?: 'FEMALE' | 'MALE' | 'UNKNOWN';
}
export const AUTO_FEMALE = 'browser:auto:female';
export const AUTO_MALE = 'browser:auto:male';
export function browserVoices(): SpeechSynthesisVoice[] {
  return typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
export function voiceGender(name: string): 'FEMALE' | 'MALE' | 'UNKNOWN' {
  if (/female|woman|女|ting[ -]?ting|婷婷|\bmei[ -]?jia\b|\bsin[ -]?ji\b|\byu[ -]?shu\b|xiaoxiao|xiaoyi|xiaohan|xiaomo|xiaoxuan|xiaoqiu|xiaorui|huihui|yaoyao|hanhan|meijia|samantha|victoria|karen|moira|tessa|zira|hazel|susan|jenny|aria|ava|sonia/i.test(name)) return 'FEMALE';
  if (/(?:^|[^a-z])male(?:$|[^a-z])|\bman\b|男|li[ -]?mu|李慕|yun[ -]?xi|yun[ -]?jian|yun[ -]?yang|云扬|云希|云健|\b(reed|rocko|rishi|aaron|evan|nathan|oliver|thomas|tom|lee|eddy|grandpa)\b|yunxi|yunjian|yunyang|yunfeng|yunhao|kangkang|zhiwei|zhiyu|david|mark|alex|daniel|fred|george|guy|ryan|andrew|brian/i.test(name)) return 'MALE';
  return 'UNKNOWN';
}
export function voiceLanguageMatches(voice: Pick<SpeechSynthesisVoice, 'lang'>, lang: TtsLanguage): boolean {
  const code = voice.lang.toLowerCase().replace(/_/g, '-');
  return lang === 'EN' ? code.startsWith('en') : /^(zh($|-cn|-sg|-tw)|cmn)/.test(code);
}
export function availableVoiceOptions(lang: TtsLanguage): CuratedVoiceItem[] {
  const auto = (female: boolean): CuratedVoiceItem => ({voiceURI:female?AUTO_FEMALE:AUTO_MALE,
    name:female?'自动匹配女声':'自动匹配男声',description:browserVoices().some(v=>voiceLanguageMatches(v,lang)&&voiceGender(`${v.name} ${v.voiceURI}`)===(female?'FEMALE':'MALE'))?'根据当前设备音色匹配':'当前未检测到对应性别，使用可用声音',nativeLanguage:'',
    lang:lang==='CN'?'zh-CN':'en-US',engine:'browser',isFemale:female,gender:female?'FEMALE':'MALE'});
  return [auto(true),auto(false),...browserVoices().filter(v=>voiceLanguageMatches(v,lang)).map(v=>{
    const gender=voiceGender(`${v.name} ${v.voiceURI}`);return {voiceURI:v.voiceURI,name:v.name,lang:v.lang,engine:'browser' as const,
      nativeLanguage:v.lang,isFemale:gender==='FEMALE',gender,
      description:`${v.lang} · ${gender==='UNKNOWN'?'性别未标注':gender==='FEMALE'?'推测女声':'推测男声'} · ${v.localService?'设备声音':'浏览器联网声音'}`};
  })];
}
export function getVoiceOption(id: string): CuratedVoiceItem | undefined {
  return [...availableVoiceOptions('CN'),...availableVoiceOptions('EN')].find(v=>v.voiceURI===id);
}
export function chooseBrowserVoice(profile: VoiceProfileConfig, role: 'ATC'|'PILOT', lang:TtsLanguage): SpeechSynthesisVoice|undefined {
  const all=browserVoices();
  const explicit=all.find(v=>v.voiceURI===profile.voiceURI && voiceLanguageMatches(v,lang));
  if(explicit) return explicit;
  const gender=profile.voiceURI===AUTO_FEMALE?'FEMALE':profile.voiceURI===AUTO_MALE?'MALE':role==='ATC'?'FEMALE':'MALE';
  const matching=all.filter(v=>voiceLanguageMatches(v,lang));
  const score=(v:SpeechSynthesisVoice)=> (voiceGender(`${v.name} ${v.voiceURI}`)===gender?100:voiceGender(`${v.name} ${v.voiceURI}`)==='UNKNOWN'?10:-100)
    +(v.localService?5:0)+(v.default?1:0)+(/zh[-_]CN|en[-_]US/i.test(v.lang)?3:0);
  return matching.sort((a,b)=>score(b)-score(a))[0];
}
export function recommendedSpeechRate(lang:TtsLanguage):number { return lang==='CN'?1.15:1.05; }
export function resolveVoiceIdForLanguage(profile:VoiceProfileConfig,role:'ATC'|'PILOT',_lang:TtsLanguage):string {
  return profile.voiceURI?.startsWith('browser:') || browserVoices().some(v=>v.voiceURI===profile.voiceURI)
    ?profile.voiceURI:role==='ATC'?AUTO_FEMALE:AUTO_MALE;
}
export function normalizeVoiceProfile(current:VoiceProfileConfig,patch:Partial<VoiceProfileConfig>|undefined,
 role:'ATC'|'PILOT',oldLang:TtsLanguage,nextLang:TtsLanguage):VoiceProfileConfig {
  const memory={...current.languageProfiles,[oldLang]:{voiceURI:current.voiceURI,rate:current.rate}};
  const saved=memory[nextLang],changed=oldLang!==nextLang;
  const voiceURI=patch?.voiceURI??(changed?saved?.voiceURI??(role==='ATC'?AUTO_FEMALE:AUTO_MALE):resolveVoiceIdForLanguage(current,role,nextLang));
  const value=patch?.rate??(changed?saved?.rate??recommendedSpeechRate(nextLang):current.rate);
  const rate=Number.isFinite(value)?Math.max(.9,Math.min(1.5,value)):recommendedSpeechRate(nextLang);
  return {...current,...patch,voiceURI,rate,pitch:1,preferredGender:role==='ATC'?'FEMALE':'MALE',
    presetLabel:voiceURI.startsWith('browser:auto:')?(voiceURI===AUTO_FEMALE?'自动匹配女声':'自动匹配男声'):getVoiceOption(voiceURI)?.name||voiceURI,
    languageProfiles:{...memory,[nextLang]:{voiceURI,rate}}};
}
const KEY='atc2.online.voice-preferences.v1';
export function saveVoicePreferences(atc:VoiceProfileConfig,pilot:VoiceProfileConfig):void {
  try{window.localStorage.setItem(KEY,JSON.stringify({atc,pilot}));}catch{}
}
export function loadVoicePreferences(atc:VoiceProfileConfig,pilot:VoiceProfileConfig):{atc:VoiceProfileConfig;pilot:VoiceProfileConfig}{
  let saved:any={};try{saved=JSON.parse(window.localStorage.getItem(KEY)||'{}')||{};}catch{}
  const restore=(original:VoiceProfileConfig,value:any,role:'ATC'|'PILOT')=>{
    const valid=(p:any)=>p&&typeof p.voiceURI==='string'&&Number.isFinite(p.rate);
    const languageProfiles:VoiceProfileConfig['languageProfiles']={};
    for(const lang of ['CN','EN'] as const) if(valid(value?.languageProfiles?.[lang]))languageProfiles[lang]=value.languageProfiles[lang];
    const profile={...original,languageProfiles};
    return normalizeVoiceProfile(profile,languageProfiles.CN,role,'CN','CN');
  };
  return {atc:restore(atc,saved.atc,'ATC'),pilot:restore(pilot,saved.pilot,'PILOT')};
}
