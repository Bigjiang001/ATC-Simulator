/* Exercises the real built pages and production client against deterministic SDK transport doubles.
   Database permissions are independently tested against the actual RTDB emulator. */
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const { chromium } = require('@playwright/test');
const { inject } = require('../scripts/analytics-build.cjs');
const root = path.resolve(__dirname, '..');
process.env.ATC_ANALYTICS_CONFIG_JSON = JSON.stringify({ enabled: true, ga4MeasurementId: 'G-TEST1234',
  firebase: { apiKey: 'test', authDomain: 'demo.firebaseapp.com', databaseURL: 'https://demo.firebaseio.com', projectId: 'demo', appId: 'test' }, functionsRegion: 'asia-southeast1' });
const sdk = {
  'firebase-app.js': `const apps=[]; export const getApps=()=>apps; export function initializeApp(config,name){const app={name};apps.push(app);return app}`,
  'firebase-auth.js': `const auth={currentUser:null};export const browserSessionPersistence={};export const getAuth=()=>auth;
    auth.authStateReady=async()=>{if(localStorage.uid)auth.currentUser={uid:localStorage.uid,isAnonymous:true}};
    export async function signInAnonymously(){localStorage.uid||=crypto.randomUUID();auth.currentUser={uid:localStorage.uid,isAnonymous:true}}
    export const setPersistence=async()=>{};export class GoogleAuthProvider{};
    export async function signInWithPopup(){auth.currentUser={uid:'admin',isAnonymous:false,getIdTokenResult:async()=>({claims:{admin:window.__adminAllowed!==false}})};window.__authChanged(auth.currentUser)}
    export async function signOut(){auth.currentUser=null;window.__authChanged(null)};
    export function onAuthStateChanged(a,cb){window.__authChanged=cb;cb(null)}`,
  'firebase-database.js': `window.__writes=[];window.__disconnects=[];export const getDatabase=()=>({});export const ref=(db,path)=>path;
    export function onValue(path,cb){if(path==='.info/connected'){window.__connection=connected=>cb({val:()=>connected});queueMicrotask(()=>window.__connection(true))}else cb({val:()=>0})}
    export function onDisconnect(path){return {remove:async()=>{window.__disconnects.push(path)}}}
    export async function set(path,value){window.__writes.push({op:'set',path,value,registered:window.__disconnects.length})}
    export async function remove(path){window.__writes.push({op:'remove',path})}`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>{if(window.__callFail)throw {code:'functions/permission-denied'};return {data:{generatedAt:Date.now(),online:2,history:[{day:1792252800000,visitors:10,gameVisitors:5,players:3,starts:4,ends:2,activeMs:3600000}]}}}`
};
const server = http.createServer((req, res) => {
  const kind = req.url.includes('/admin') ? 'admin' : req.url.includes('/game') ? 'game' : 'home';
  let html = fs.readFileSync(path.join(root, kind === 'game' ? 'online/index.html' : kind === 'admin' ? 'website/admin/index.html' : 'website/index.html'), 'utf8');
  if (kind === 'game') html = html.replace(/<meta name="atc-page"[\s\S]*?<\/head>/, '</head>').replace('function bootAtcApp() {', 'window.__testRequire = require; function bootAtcApp() {');
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(inject(html, kind));
});
(async () => {
  await new Promise(resolve => server.listen(18831, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.ATC_TEST_BROWSER || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
  try {
    const context = await browser.newContext(), errors = [];
    await context.route('https://www.gstatic.com/firebasejs/**', route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      return route.fulfill({ contentType: 'application/javascript', body: sdk[name] || '', headers: { 'access-control-allow-origin': '*' } });
    });
    await context.route('https://www.googletagmanager.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:18831/ATC-Simulator/game/');
    await page.waitForFunction(() => window.__writes?.some(w => w.path.startsWith('activity/')));
    await page.getByTestId('btn-start-playing').click();
    await page.waitForFunction(() => window.__writes.some(w => w.path.startsWith('presence/') && w.op === 'set'));
    const first = await page.evaluate(() => ({ uid: localStorage.uid, writes: window.__writes, events: window.dataLayer.map(x => Array.from(x)) }));
    assert(first.writes.filter(w => w.path.startsWith('presence/') && w.op === 'set').every(w => w.registered > 0));
    assert.equal(first.events.filter(e => e[0] === 'event' && e[1] === 'game_start').length, 1);
    assert.equal(first.events.filter(e => e[0] === 'event' && e[1] === 'page_view').length, 1);
    await page.evaluate(() => { const store = window.__testRequire('game/store').useGameStore; store.setState({ ...store.getState(), simTimeSec: 0 }); });
    assert.equal(await page.evaluate(() => window.dataLayer.filter(x => x[1] === 'game_start').length), 1, 'a state update at time zero is not a new round');
    const before = first.writes.length;
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.__writes.length), before, 'simulation ticks must not write to Firebase');
    await page.getByTestId('btn-pause').click();
    await page.waitForFunction(() => window.__writes.at(-1)?.op === 'set' && window.__writes.at(-1)?.path.startsWith('activity/'));
    assert((await page.evaluate(() => window.__writes)).some(w => w.op === 'remove' && w.path.startsWith('presence/')));
    await page.getByTestId('btn-pause').click();
    assert.equal(await page.evaluate(() => window.dataLayer.filter(x => x[1] === 'game_start').length), 1);
    await page.evaluate(() => window.__connection(false));
    const offline = await page.evaluate(() => window.__writes.length);
    await page.getByTestId('btn-pause').click();
    assert.equal(await page.evaluate(() => window.__writes.length), offline);
    await page.evaluate(() => window.__connection(true));
    await page.waitForFunction(() => window.__disconnects.length === 2);
    await page.getByTestId('btn-pause').click();
    const startsBeforeCache = await page.evaluate(() => window.dataLayer.filter(x => x[1] === 'game_start').length);
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    assert.equal(await page.evaluate(() => window.dataLayer.filter(x => x[1] === 'game_start').length), startsBeforeCache, 'BFCache restores must not create new rounds');
    const second = await context.newPage(); second.on('pageerror', e => errors.push(e.message));
    await second.goto('http://127.0.0.1:18831/ATC-Simulator/game/');
    await second.waitForFunction(() => window.__writes?.length > 0);
    assert.equal(await second.evaluate(() => localStorage.uid), first.uid);
    const firstTab = first.writes.find(w => w.path.startsWith('activity/')).path.split('/').at(-1);
    assert.notEqual(await second.evaluate(() => window.__writes.find(w => w.path.startsWith('activity/')).path.split('/').at(-1)), firstTab);
    const admin = await context.newPage(); admin.on('pageerror', e => errors.push(e.message));
    await admin.goto('http://127.0.0.1:18831/ATC-Simulator/admin/');
    await admin.getByRole('button', { name: 'Google 管理员登录' }).click();
    await admin.locator('#panel').waitFor({ state: 'visible' });
    assert.equal(await admin.locator('#visitors').innerText(), '10'); assert.equal(await admin.locator('#online').innerText(), '2');
    assert.equal(await admin.locator('#rows tr').count(), 1);
    await admin.screenshot({ path: path.join(root, 'online/review/analytics-admin.png'), fullPage: true });
    await admin.evaluate(() => window.__callFail = true);
    await admin.locator('#refresh').click(); await admin.locator('#panel').waitFor({ state: 'hidden' });
    assert((await admin.locator('#status').innerText()).includes('permission-denied'));
    assert.equal(await second.evaluate(() => localStorage.uid), first.uid, 'admin login must not overwrite visitor identity');
    assert.deepEqual(errors, []);
    console.log('PASS: enabled browser flow, GA lifecycle, no per-tick writes, disconnect registration/reconnect, pause, tab identity, admin aggregates and permission rejection');
  } finally { await browser.close(); server.close(); delete process.env.ATC_ANALYTICS_CONFIG_JSON; }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
