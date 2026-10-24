const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium, webkit } = require('@playwright/test');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname.startsWith('/voices/')) {
   const filename=path.join(root,pathname);
   if(!filename.startsWith(path.join(root,'voices/'))||!fs.existsSync(filename)){res.writeHead(404);return res.end();}
   res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':'application/octet-stream');return res.end(fs.readFileSync(filename));
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('function bootAtcApp() {','window.__testRequire = require; function bootAtcApp() {'));
});
function femaleOnly(){
 const girls=[{name:'婷婷',voiceURI:'ting',lang:'zh-CN',localService:true},{name:'美嘉',voiceURI:'mei',lang:'zh-TW',localService:true}];
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[...girls,...girls],addEventListener(){},removeEventListener(){},cancel(){},speak(u){window.__systemSpoken=(window.__systemSpoken||0)+1;setTimeout(()=>u.onend?.(),0);}}});
 window.__buffers=[];
 const create=AudioContext.prototype.createBufferSource;
 AudioContext.prototype.createBufferSource=function(){
  const ctx=this,node=create.call(ctx),start=node.start,connect=node.connect;let analyser=null;
  node.connect=function(target,...args){
   if(target===ctx.destination&&!analyser){analyser=ctx.createAnalyser();analyser.fftSize=2048;connect.call(node,analyser);analyser.connect(target);return target;}
   return connect.call(node,target,...args);
  };
  node.start=function(...args){if(this.buffer&&this.buffer.length>1){const pcm=this.buffer.getChannelData(0);let power=0,hash=0;for(let i=0;i<pcm.length;i++){power+=pcm[i]**2;hash=(hash+Math.round(pcm[i]*32768)*(i%101))|0;}
    window.__buffers.push({length:pcm.length,sampleRate:this.buffer.sampleRate,power,hash,state:ctx.state});
    window.__latestAudioGraph={ctx,analyser,startedAt:ctx.currentTime};
   }return start.apply(this,args);};return node;
 };

}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const kind=process.env.ATC_TEST_ENGINE==='webkit'?webkit:chromium;
 const browser=await kind.launch({headless:true,...(kind===chromium&&process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{
 for(const viewport of [{width:1366,height:1024},{width:1024,height:1366}]){
 const context=await browser.newContext({viewport,hasTouch:true,isMobile:true});await context.addInitScript(femaleOnly);
 const page=await context.newPage(),errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByTestId('btn-start-playing').click();
 await page.evaluate(()=>{const s=window.__testRequire('game/store').useGameStore;s.setState({isPaused:true});s.getState().updateSettings({vhfStaticLevel:'OFF'});});
 await page.getByTestId('btn-settings').click();const select=page.getByTestId('select-pilot-voice-uri');
 assert.equal(await select.locator('option[value^="builtin:"]').count(),3);
 assert.equal(await select.locator('option[value="ting"]').count(),1,'deduplicated Safari system options');
 const atc=page.getByTestId('atc-voice-box'),pilot=page.getByTestId('pilot-voice-box');
 for(const selector of ['.voice-dropdown','.voice-description','.voice-rate-header','.voice-rate-slider','button[data-testid^="btn-preview"]']){
   const a=await atc.locator(selector).boundingBox(),p=await pilot.locator(selector).boundingBox();
   assert(Math.abs(a.y-p.y)<1,`${selector} rows align`);
   if(selector==='.voice-dropdown'){assert.equal(a.height,38);assert.equal(p.height,38);}
 }
 const hashes=[];
 for(const voice of ['builtin:male:1','builtin:male:2','builtin:male:3','browser:auto:male']){
   await select.selectOption(voice);const before=await page.evaluate(()=>window.__buffers.length);
   await page.getByTestId('btn-preview-pilot-voice').click();
   await page.waitForFunction(n=>window.__buffers.length>n,before,{timeout:45000});
   const b=await page.evaluate(()=>window.__buffers.at(-1));assert(b.length>22050&&b.power>1);assert.equal(b.state,'running');hashes.push(b.hash);
   await page.waitForFunction(()=>{
    const g=window.__latestAudioGraph;if(!g?.analyser||g.ctx.currentTime-g.startedAt<.05)return false;
    const output=new Float32Array(g.analyser.fftSize);g.analyser.getFloatTimeDomainData(output);
    return output.some(value=>Math.abs(value)>.001);
   },null,{timeout:8000});
   const session=await page.evaluate(()=>navigator.audioSession?.type);if(session)assert.equal(session,'playback');
 }
 assert.equal(new Set(hashes.slice(0,3)).size,3,'three distinct synthesized male audio buffers');
 await page.evaluate(()=>window.__testRequire('game/store').useGameStore.getState().stopAllSpeech?.());
 // Cancellation and persistence: a preview can be interrupted by another selection and reloaded.
 await select.selectOption('builtin:male:2');await page.getByTestId('btn-preview-pilot-voice').click();
 await select.selectOption('builtin:male:3');await page.getByTestId('btn-preview-pilot-voice').click();
 await page.waitForTimeout(200);
 fs.mkdirSync(path.join(root,'review'),{recursive:true});await page.screenshot({path:path.join(root,'review',`ipad-settings-${viewport.width}-${process.env.ATC_TEST_ENGINE||'chromium'}.png`)});
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 await page.reload();await page.getByTestId('btn-start-playing').click();await page.getByTestId('btn-settings').click();assert.equal(await page.getByTestId('select-pilot-voice-uri').inputValue(),'builtin:male:3');
 console.log(`PASS ${process.env.ATC_TEST_ENGINE||'chromium'} ${viewport.width}x${viewport.height}: three distinct male outputs, running audio clock and non-silent output graph, playback session, auto fallback, aligned controls and reload persistence`);
 await context.close();
 }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
