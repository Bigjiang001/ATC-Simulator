const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('@playwright/test');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'review');fs.mkdirSync(evidence,{recursive:true});
const errors=[],requests=[],results=[];
const server=http.createServer((req,res)=>{
 if(req.url.includes('favicon')){res.writeHead(204);return res.end();}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('function bootAtcApp() {','window.__testRequire = require; function bootAtcApp() {'));
});
function mockSpeech(){
 const voices=[{name:'Tingting',voiceURI:'ting',lang:'zh-CN',localService:true},{name:'Microsoft Yunxi',voiceURI:'yun',lang:'zh-CN',localService:false},{name:'Samantha',voiceURI:'sam',lang:'en-US',localService:true},{name:'Daniel',voiceURI:'dan',lang:'en-GB',localService:true}];
 window.__spoken=[];window.__voices=voices;window.__recognizers=[];
 const listeners=[];
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>window.__voices,addEventListener:(n,f)=>listeners.push(f),removeEventListener(){},cancel(){},speak(u){window.__spoken.push({text:u.text,voice:u.voice?.voiceURI,rate:u.rate});u.onstart?.();setTimeout(()=>u.onend?.(),5);}}});
 window.__voicesChanged=()=>listeners.forEach(f=>f());
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 window.SpeechRecognition=window.webkitSpeechRecognition=class{
 constructor(){window.__recognizers.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.onend?.();}
 result(text){const result=[{transcript:text}];result.isFinal=true;this.onresult?.({resultIndex:0,results:[result]});}
 };
}
(async()=>{
 await new Promise(r=>server.listen(18830,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.ATC_TEST_BROWSER || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
 try{
 const native=await browser.newPage();await native.goto('http://127.0.0.1:18830/ATC-Simulator/');
 results.push({nativeCapabilities:await native.evaluate(()=>({tts:!!window.speechSynthesis,asr:!!(window.SpeechRecognition||window.webkitSpeechRecognition),secure:window.isSecureContext,voices:window.speechSynthesis?.getVoices().length}))});await native.close();
 const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addInitScript(mockSpeech);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.goto('http://127.0.0.1:18830/ATC-Simulator/');
 assert.equal(await page.getByTestId('mission-picker').count(),0);
 await page.getByTestId('online-browser-notice').waitFor();
 for(const ap of ['ZSHB','ZSPD','RJTT','EGLL'])for(const diff of ['EASY','NORMAL','HARD']){
  await page.getByTestId('lobby-diff-'+diff.toLowerCase()).click();await page.getByTestId('select-airport-'+ap).click();await page.getByTestId('btn-start-playing').click();
  const s=await page.evaluate(()=>{const s=window.__testRequire('game/store').useGameStore.getState();return {ap:s.airport.icao,diff:s.difficulty,mission:s.missionRun};});assert.equal(s.ap,ap);assert.equal(s.diff,diff);assert.equal(s.mission,null);await page.getByTestId('btn-open-lobby').click();
 }
 results.push('12 airport/difficulty combinations and no missions');
 await page.getByTestId('lobby-diff-easy').click();await page.getByTestId('select-airport-ZSHB').click();await page.getByTestId('btn-start-playing').click();
 await page.evaluate(()=>{const store=window.__testRequire('game/store').useGameStore;const s=store.getState();s.selectAircraft(s.aircraft.find(a=>a.callsign==='CES5213').id);store.setState({isPaused:true});});
 await page.keyboard.down('Shift');await page.evaluate(()=>window.__recognizers.at(-1).result('东航5213下600'));await page.keyboard.up('Shift');
 await page.waitForFunction(()=>window.__testRequire('game/store').useGameStore.getState().aircraft.find(a=>a.callsign==='CES5213').targetAltitude===2000);
 assert((await page.evaluate(()=>window.__spoken)).some(s=>s.voice==='yun'));
 const voiceState=await page.evaluate(()=>{const s=window.__testRequire('game/store').useGameStore.getState();return {listening:s.voicePtt.isListening,raw:s.voicePtt.lastSpokenRaw,logs:s.radioLogs.slice(-4)}});assert.equal(voiceState.listening,false);
 results.push('Shift recognition -> Chinese parser -> aircraft altitude command -> male pilot readback');
 await page.screenshot({path:path.join(evidence,'online-game.png')});
 await page.getByTestId('btn-settings').click();
 await page.getByTestId('browser-speech-status').waitFor();assert.equal(await page.getByTestId('local-ai-engine-status').count(),0);
 await page.getByTestId('btn-preview-atc-voice').click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.__spoken.at(-1).voice),'ting');
 await page.getByTestId('select-pilot-voice-uri').selectOption('ting');await page.getByTestId('btn-preview-pilot-voice').click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.__spoken.at(-1).voice),'ting');
 await page.getByTestId('select-tts-lang-en').click();await page.getByTestId('btn-preview-atc-voice').click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.__spoken.at(-1).voice),'sam');await page.getByTestId('btn-preview-pilot-voice').click();await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.__spoken.at(-1).voice),'dan');
 await page.getByTestId('ui-language-en-settings').click();assert((await page.getByTestId('browser-speech-status').innerText()).includes('Speech recognition API'));
 await page.getByTestId('ui-language-cn-settings').click();await page.getByTestId('select-tts-lang-cn').click();assert.equal(await page.getByTestId('select-pilot-voice-uri').inputValue(),'ting');
 await page.screenshot({path:path.join(evidence,'online-voices.png')});
 await page.reload();await page.getByTestId('btn-start-playing').click();await page.getByTestId('btn-settings').click();assert.equal(await page.getByTestId('select-pilot-voice-uri').inputValue(),'ting');
 results.push('CN/EN voice roles, manual selection, settings translation and reload persistence');
 await page.evaluate(()=>{window.__voices=window.__voices.filter(v=>v.voiceURI==='ting');window.__voicesChanged();});
 await page.getByTestId('missing-male-voice').waitFor();
 await page.evaluate(()=>{window.__voices.push({name:'Li-mu',voiceURI:'apple-li',lang:'zh-CN',localService:true});});
 await page.getByTestId('btn-refresh-voices').click();
 await page.waitForFunction(()=>!document.querySelector('[data-testid="missing-male-voice"]'));
 await page.getByTestId('select-pilot-voice-uri').selectOption('browser:auto:male');
 await page.getByTestId('btn-preview-pilot-voice').click();await page.waitForTimeout(30);
 assert.equal(await page.evaluate(()=>window.__spoken.at(-1).voice),'apple-li');
 results.push('Safari missing-male guidance, manual voice refresh and Apple male preview');

 await page.getByTestId('btn-close-settings').click();await page.getByTestId('btn-open-lobby').click();await page.getByTestId('lobby-mode-tutorial').click();await page.getByTestId('btn-start-playing').click();assert.equal(await page.evaluate(()=>window.__testRequire('game/store').useGameStore.getState().tutorial.active),true);
 results.push('Tutorial entry preserved');
 const unsupported=await browser.newContext();await unsupported.addInitScript(()=>{window.webkitSpeechRecognition=undefined;window.SpeechRecognition=undefined;});const no=await unsupported.newPage();await no.goto('http://127.0.0.1:18830/ATC-Simulator/');assert((await no.getByTestId('online-browser-notice').innerText()).includes('不支持语音识别'));await no.getByTestId('btn-start-playing').click();await no.keyboard.down('Shift');await no.keyboard.up('Shift');await no.waitForTimeout(20);assert.equal(await no.evaluate(()=>window.__testRequire('game/store').useGameStore.getState().voicePtt.isListening),false);await unsupported.close();
 results.push('Unsupported recognition browser retains game and text controls');
 assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith('http://127.0.0.1:18830/')));results.push('No page errors, no local model requests, no external model/API requests');
 fs.writeFileSync(path.join(evidence,'ui-test-report.json'),JSON.stringify({results,requests,errors},null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
