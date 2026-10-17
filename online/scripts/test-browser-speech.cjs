const assert=require('node:assert/strict'),fs=require('node:fs'),babel=require('@babel/core');
require.extensions['.ts']=(module,filename)=>module._compile(babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,presets:[[require.resolve('@babel/preset-env'),{targets:{node:'current'}}],require.resolve('@babel/preset-typescript')]}).code,filename);
const catalog=require('../src/audio/voiceCatalog.ts');const {soundEngine}=require('../src/audio/soundEngine.ts');
const voices=[{name:'Tingting',voiceURI:'ting',lang:'zh-CN',localService:true},{name:'Microsoft Yunxi',voiceURI:'yun',lang:'zh-CN',localService:false},{name:'Samantha',voiceURI:'sam',lang:'en-US',localService:true},{name:'Daniel',voiceURI:'dan',lang:'en-GB',localService:true},{name:'Male Cantonese',voiceURI:'canto',lang:'zh-HK',localService:true}];
let currentVoices=voices,spoken=[],recognizers=[],holdSpeech=false;
const synth={getVoices:()=>currentVoices,addEventListener(){},removeEventListener(){},cancel(){},speak(u){spoken.push(u);u.onstart?.();if(!holdSpeech)setTimeout(()=>u.onend?.(),0);}};
class Recognition {
 constructor(){recognizers.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.onend?.();}
 result(text,alts=[]){const result=[...new Set([text,...alts])].map(transcript=>({transcript}));result.isFinal=true;this.onresult?.({resultIndex:0,results:[result]});}
}
global.window={speechSynthesis:synth,SpeechSynthesisUtterance:class {constructor(text){this.text=text;}},webkitSpeechRecognition:Recognition,isSecureContext:true,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}}};
global.SpeechSynthesisUtterance=window.SpeechSynthesisUtterance;
const nativeFetch=global.fetch;global.fetch=()=>{throw Error('Network fetch forbidden in browser edition');};
const atc={voiceURI:catalog.AUTO_FEMALE,rate:1.15,pitch:1,presetLabel:'auto'},pilot={...atc,voiceURI:catalog.AUTO_MALE};
const settings={ttsEnabled:true,atcTtsEnabled:true,pilotTtsEnabled:true,ttsLanguage:'CN',vhfStaticLevel:'OFF',atcVoice:atc,pilotVoice:pilot,altitudeUnit:'METRIC'};
const ctx={activeCallsigns:[],waypoints:[],runways:[],lang:'CN'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS: '+name);}
(async()=>{
 await check('Browser capability checks do not call a local/paid service',async()=>{await soundEngine.checkLocalAiEngineHealth();assert.equal(soundEngine.getBrowserSpeechCapabilities().recognition,true);});
 await check('Female controller / male pilot, language match, no invented gender metadata',async()=>{
 assert.equal(catalog.chooseBrowserVoice(atc,'ATC','CN').voiceURI,'ting');assert.equal(catalog.chooseBrowserVoice(pilot,'PILOT','CN').voiceURI,'yun');
 assert.equal(catalog.chooseBrowserVoice(atc,'ATC','EN').voiceURI,'sam');assert.equal(catalog.chooseBrowserVoice(pilot,'PILOT','EN').voiceURI,'dan');assert.equal(catalog.voiceGender('Google 普通话'),'UNKNOWN');
 assert(!catalog.availableVoiceOptions('CN').some(v=>v.voiceURI==='canto'));
 currentVoices=[voices[0]];assert.equal(catalog.chooseBrowserVoice(pilot,'PILOT','CN').voiceURI,'ting');currentVoices=voices;
 });
 await check('Role previews use selected browser voices and aviation phonetics',async()=>{
 soundEngine.previewRoleVoice('ATC',settings);await wait(10);soundEngine.previewRoleVoice('PILOT',settings);await wait(10);
 assert.equal(spoken.at(-2).voice.voiceURI,'ting');assert.equal(spoken.at(-1).voice.voiceURI,'yun');assert(spoken.at(-1).text.indexOf('左转')<spoken.at(-1).text.indexOf('东方航空'));assert.equal(spoken.at(-1).rate,1.15);
 });
 await check('Speech cancellation settles an active utterance and skips stale queued items',async()=>{
 holdSpeech=true;spoken=[];soundEngine.speakQueue([{role:'ATC',textCn:'左转090',textEn:'TURN LEFT'},{role:'PILOT',textCn:'右转180',textEn:'TURN RIGHT'}],settings);await wait(10);assert.equal(spoken.length,1);
 soundEngine.stopAllSpeech();holdSpeech=false;await wait(10);assert.equal(spoken.length,1);soundEngine.previewRoleVoice('PILOT',settings);await wait(10);assert.equal(spoken.length,2);
 });
 await check('Push-to-talk keeps alternatives and uses the selected recognition language',async()=>{
 await soundEngine.startPttRecording('CN');let r=recognizers.at(-1);assert.equal(r.lang,'zh-CN');r.result('东航5213下600',['东方五两幺三下六百']);const result=await soundEngine.stopPttRecordingAndTranscribe(ctx);assert(result.ok);assert.equal(result.rawTranscript,'东航5213下600');assert(result.alternatives.includes('东方五两幺三下六百'));
 await soundEngine.startPttRecording('EN');assert.equal(recognizers.at(-1).lang,'en-US');soundEngine.cancelPttRecording();
 });
 await check('Delayed microphone authorization, early release and recognition end cannot hang',async()=>{
 const normalStart=Recognition.prototype.start;Recognition.prototype.start=function(){};await soundEngine.startPttRecording('CN');const r=recognizers.at(-1);const pending=soundEngine.stopPttRecordingAndTranscribe(ctx);r.onstart();const result=await pending;assert.equal(result.ok,false);Recognition.prototype.start=normalStart;
 });
 await check('Permission/network errors and unsupported browsers return actionable text',async()=>{
 for(const code of ['not-allowed','network','audio-capture','no-speech']){await soundEngine.startPttRecording('CN');recognizers.at(-1).onerror({error:code});const result=await soundEngine.stopPttRecordingAndTranscribe(ctx);assert(!result.ok);assert(result.errorDetail);}
 delete window.webkitSpeechRecognition;assert.equal((await soundEngine.startPttRecording()).ok,false);window.SpeechRecognition=Recognition;assert.equal((await soundEngine.startPttRecording()).ok,true);soundEngine.cancelPttRecording();
 window.isSecureContext=false;assert.equal((await soundEngine.startPttRecording()).ok,false);window.isSecureContext=true;
 });
 await check('Late results from an aborted session cannot enter the next session',async()=>{
 await soundEngine.startPttRecording();const old=recognizers.at(-1);await soundEngine.startPttRecording();old.result('错误航班');recognizers.at(-1).result('左转090');assert.equal((await soundEngine.stopPttRecordingAndTranscribe(ctx)).rawTranscript,'左转090');
 });
 await check('Muted audio and per-role controls preserve silence',async()=>{
 spoken=[];soundEngine.setMuted(true);soundEngine.speakQueue([{role:'ATC',textCn:'测试',textEn:'test'}],settings);await wait(10);assert.equal(spoken.length,0);soundEngine.setMuted(false);
 soundEngine.speakQueue([{role:'ATC',textCn:'测试',textEn:'test'}],{...settings,atcTtsEnabled:false});await wait(10);assert.equal(spoken.length,0);
 });
 console.log(`${passed} browser speech groups passed; no model/API fetches`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{soundEngine.stopAllSpeech();global.fetch=nativeFetch;});
