const assert=require('node:assert/strict'),fs=require('node:fs'),babel=require('@babel/core');
require.extensions['.ts']=(module,filename)=>module._compile(babel.transformSync(fs.readFileSync(filename,'utf8'),{filename,presets:[[require.resolve('@babel/preset-env'),{targets:{node:'current'}}],require.resolve('@babel/preset-typescript')]}).code,filename);
const session={type:'auto'};Object.defineProperty(global,'navigator',{configurable:true,value:{audioSession:session}});
const contexts=[],started=[];let blocked=false,delay=80;
class Context {
 constructor(){assert.equal(session.type,'playback','select a media playback session before creating Web Audio');this.state='interrupted';this.sampleRate=48000;this.destination={};this.listeners=new Set();contexts.push(this);}
 resume(){this.resumes=(this.resumes||0)+1;if(blocked)return new Promise(()=>{});if(this.state==='running')return Promise.resolve();return this.ready ||= new Promise(r=>setTimeout(()=>{this.state='running';this.listeners.forEach(f=>f());r();},delay));}
 addEventListener(_,f){this.listeners.add(f);}removeEventListener(_,f){this.listeners.delete(f);}
 createBuffer(_,length,sr){return {length,duration:length/sr,getChannelData:()=>new Float32Array(length)};}
 createBufferSource(){const ctx=this;return {buffer:null,connect(){},disconnect(){},stop(){this.onended?.();},start(){if(this.buffer.length>1){assert.equal(ctx.state,'running','audible playback must await Safari resume');started.push(this.buffer.length);setTimeout(()=>this.onended?.(),0);}}};}
}
class Worker {
 postMessage({id}){setTimeout(()=>this.onmessage?.({data:{id,samples:new Float32Array(44100).fill(.1),sampleRate:22050}}),5);}terminate(){}
}
global.Worker=Worker;global.document={baseURI:'https://example.com/ATC-Simulator/game/'};
global.window={AudioContext:Context,dispatchEvent(){},speechSynthesis:{cancel(){},getVoices:()=>[]}};
const {soundEngine}=require('../src/audio/soundEngine.ts');
const profile={voiceURI:'builtin:male:1',rate:1.15,pitch:1};
const settings={ttsLanguage:'CN',vhfStaticLevel:'OFF',altitudeUnit:'METRIC',atcVoice:profile,pilotVoice:profile};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 soundEngine.previewRoleVoice('PILOT',settings);await sleep(25);assert.equal(started.length,0);await sleep(100);assert.equal(started.length,1);
 console.log('PASS: Safari playback session is configured before context creation; interrupted output waits for asynchronous resume');
 const ctx=contexts.at(-1);ctx.state='interrupted';ctx.ready=null;session.type='play-and-record';
 soundEngine.previewRoleVoice('PILOT',settings);await sleep(120);assert.equal(session.type,'playback');assert.equal(started.length,2);
 console.log('PASS: microphone/app interruption restores playback session and resumes the existing output');
 ctx.state='interrupted';ctx.ready=null;delay=150;soundEngine.previewRoleVoice('PILOT',settings);await sleep(25);soundEngine.stopAllSpeech();await sleep(200);assert.equal(started.length,2);
 console.log('PASS: stopping during delayed resume cannot start a stale preview');
 ctx.state='interrupted';ctx.ready=null;blocked=true;soundEngine.previewRoleVoice('PILOT',settings);await sleep(4200);assert.equal(started.length,2);assert.match(soundEngine.getAiEngineStatus().lastTtsError,/声音播放尚未恢复/);
 console.log('PASS: blocked output reports a retry message instead of pretending to play or hanging the speech queue');
 blocked=false;ctx.state='closed';soundEngine.previewRoleVoice('PILOT',settings);await sleep(220);assert.equal(contexts.length,2);assert.equal(started.length,3);
 console.log('PASS: a closed Safari audio context is recreated and can speak again');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>soundEngine.stopAllSpeech());
