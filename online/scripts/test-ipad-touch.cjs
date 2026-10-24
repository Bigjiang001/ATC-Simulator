const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('function bootAtcApp() {', 'window.__testRequire = require; function bootAtcApp() {'));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.ATC_TEST_BROWSER || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()) });
  try {
    for (const viewport of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }]) {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByTestId('btn-start-playing').click();
      await page.evaluate(() => window.__testRequire('game/store').useGameStore.setState({ isPaused: true }));
      const canvas = page.getByTestId('radar-canvas');
      await canvas.waitFor();
      assert.equal(await canvas.evaluate(el => getComputedStyle(el).touchAction), 'none');
      const box = await canvas.boundingBox();
      const x = box.x + box.width * .45, y = box.y + box.height * .65;
      const cdp = await context.newCDPSession(page);
      const dispatch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type,
        touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2 })) });
      const state = () => page.evaluate(() => {
        const s = window.__testRequire('game/store').useGameStore.getState();
        return { ...s.viewport, logs: JSON.stringify(s.radioLogs), scale: window.visualViewport.scale };
      });
      const initial = await state();
      const anchor = () => page.evaluate(({ x, y }) => {
        const c = document.querySelector('[data-testid="radar-canvas"]');
        const r = c.getBoundingClientRect();
        return window.__testRequire('radar/renderer').screenToWorld((x-r.x)*c.width/r.width,
          (y-r.y)*c.height/r.height,c.width,c.height,window.__testRequire('game/store').useGameStore.getState().viewport);
      }, { x, y });
      const before = await anchor();
      await dispatch('touchStart', [[x-40,y],[x+40,y]]);
      await dispatch('touchMove', [[x-80,y],[x+80,y]]);
      const enlarged = await state(), after = await anchor();
      assert(Math.abs(enlarged.zoom - initial.zoom * 2) < .01);
      assert(Math.hypot(after.x-before.x,after.y-before.y) < .01, 'pinch midpoint stays anchored');
      assert.equal(enlarged.scale, initial.scale, 'page scale stays fixed');
      await dispatch('touchEnd', [[x-80,y]]);
      await dispatch('touchMove', [[x-20,y-60]]);
      await dispatch('touchEnd', []);
      assert.equal((await state()).logs, initial.logs, 'lifting one finger cannot issue a vector command');
      await dispatch('touchStart', [[x-80,y],[x+80,y]]);
      await dispatch('touchMove', [[x-40,y],[x+40,y]]);
      await dispatch('touchEnd', []);
      assert(Math.abs((await state()).zoom-initial.zoom)<.01);
      // A pinch can start while a finger is dragging an aircraft, and must discard the vector.
      const target = await page.evaluate(() => {
        const s = window.__testRequire('game/store').useGameStore.getState();
        const c = document.querySelector('[data-testid="radar-canvas"]'), r = c.getBoundingClientRect();
        const a = s.aircraft.find(a => a.phase !== 'HOLDING_GROUND');
        const p = window.__testRequire('radar/renderer').worldToScreen(a.position,c.width,c.height,s.viewport);
        return { x:r.x+p.x*r.width/c.width,y:r.y+p.y*r.height/c.height };
      });
      await dispatch('touchStart', [[target.x,target.y]]);
      await dispatch('touchMove', [[target.x+12,target.y+12]]);
      await dispatch('touchStart', [[target.x+12,target.y+12],[target.x+70,target.y+12]]);
      await dispatch('touchMove', [[target.x+5,target.y+12],[target.x+90,target.y+12]]);
      await dispatch('touchEnd', []);
      assert.equal((await state()).logs, initial.logs);
      // Cancellation clears a single-finger drag without sending commands.
      await dispatch('touchStart', [[x,y]]);
      await dispatch('touchMove', [[x+30,y+20]]);
      await dispatch('touchCancel', []);
      const panned = await state();
      assert(Math.abs(panned.panX-initial.panX)>.01);
      assert.equal(panned.logs, initial.logs);
      await page.getByTestId('btn-zoom-reset').click();
      const reset = await state();
      assert.equal(reset.zoom, initial.zoom); assert.equal(reset.panX, 0); assert.equal(reset.panY, 0);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${viewport.width}x${viewport.height}: real touch pinch in/out, midpoint anchor, fixed page scale, vector cancellation, pan/cancel, reset`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
