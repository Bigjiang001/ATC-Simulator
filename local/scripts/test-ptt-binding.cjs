const { chromium } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true,channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
  const page = await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',sensevoice_ready:true,kokoro_ready:true,qwen_ready:true,device:'TEST'}}));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../atc_command_simulator.html')).href);

  await page.getByTestId('btn-start-playing').click();
  await page.getByTestId('btn-settings').click();
  const field=page.getByTestId('ptt-key-binding'); await field.click(); await page.keyboard.press('z');
  assert.equal(await field.inputValue(),'Z');
  assert.equal(await page.evaluate(()=>localStorage.getItem('atc-ptt-key')),'KeyZ');
  await page.evaluate(()=>window.__ATC_STORE__.getState().setShowSettingsModal(false));
  await page.locator('body').click({position:{x:2,y:2}});
  await page.keyboard.down('z');
  await page.waitForFunction(()=>window.__ATC_STORE__.getState().voicePtt.isListening);
  await page.keyboard.up('z');
  await page.waitForFunction(()=>!window.__ATC_STORE__.getState().voicePtt.isListening);
  await page.reload();
  assert.equal(await page.evaluate(()=>window.__ATC_STORE__.getState().settings.pttKey),'KeyZ');
  assert.deepEqual(errors,[]); console.log('PASS: UI key binding, saved preference, Z press/release and reload');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});


