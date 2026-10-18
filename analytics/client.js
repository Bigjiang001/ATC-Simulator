(async function () {
  'use strict';
  const config = window.ATC_ANALYTICS_CONFIG;
  if (!config?.enabled || !/^https?:$/.test(location.protocol)) return;
  const kind = document.querySelector('meta[name="atc-page"]')?.content || 'home';
  if (kind === 'admin') return;
  const { Tracker, dayKey, DAY } = window.ATCAnalyticsCore;
  const clock = () => Date.now() + offset;
  let offset = 0, stopped = false, flushing = false, connected = false, presenceReady = false, presencePublished = false, appCheckReady = false;
  const tab = crypto.randomUUID(); // New for every document, including duplicated tabs.
  const ga = (event, params = {}) => {
    if (!/^G-[A-Z0-9]+$/.test(config.ga4MeasurementId || '')) return;
    window.gtag('event', event, params);
  };
  if (/^G-[A-Z0-9]+$/.test(config.ga4MeasurementId || '')) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', config.ga4MeasurementId, { send_page_view: false, allow_google_signals: false });
    const script = document.createElement('script'); script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.ga4MeasurementId);
    document.head.appendChild(script);
    // Exclude query/hash, which may contain user-provided text.
    ga('page_view', { page_location: location.origin + location.pathname, page_title: document.title, page_type: kind });
    ga(kind === 'game' ? 'game_page_view' : 'home_page_view');
  }
  const tracker = new Tracker(kind, clock(), ga);
  tracker.visible = document.visibilityState === 'visible';
  const state = event => tracker.game(event.detail, clock());
  window.addEventListener('atc:state', state);
  if (window.__ATC_GAME_STATE__) tracker.game(window.__ATC_GAME_STATE__, clock());
  let flush = () => {};
  const environment = patch => { tracker.environment(patch, clock()); void flush(); };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'])
    window.addEventListener(type, event => { if (event.isTrusted) tracker.input(clock()); }, { passive: true });
  document.addEventListener('visibilitychange', () => environment({ visible: document.visibilityState === 'visible' }));
  window.addEventListener('offline', () => environment({ connected: false }));
  window.addEventListener('pagehide', event => {
    tracker.tick(clock());
    if (!event.persisted) tracker.finish('pagehide', clock());
    stopped = true;
    environment({ visible: false }); // Best effort only; disconnect + lease is authoritative.
  });
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    stopped = false; environment({ visible: document.visibilityState === 'visible' });
    if (window.__ATC_GAME_STATE__) tracker.game(window.__ATC_GAME_STATE__, clock());
  });
  setInterval(() => {
    // Catch gamepads without changing the game's input loop.
    if (navigator.getGamepads?.().some(p => p && (p.buttons.some(b => b.pressed) || p.axes.some(a => Math.abs(a) > .2)))) tracker.input(clock());
    const wasActive = tracker.previousActive; tracker.tick(clock());
    if (wasActive !== tracker.previousActive) void flush();
  }, 1000);
  async function connect() {
  try {
    const base = 'https://www.gstatic.com/firebasejs/12.4.0/';
    const [appSDK, authSDK, dbSDK] = await Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js')
    ]);
    const app = appSDK.getApps().find(a => a.name === 'atc-visitors') || appSDK.initializeApp(config.firebase, 'atc-visitors');
    if (config.appCheckSiteKey && !appCheckReady) {
      const ac = await import(base + 'firebase-app-check.js');
      ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
      appCheckReady = true;
    }
    const auth = authSDK.getAuth(app);
    const login = async () => {
      await auth.authStateReady();
      if (!auth.currentUser) await authSDK.signInAnonymously(auth);
      return auth.currentUser;
    };
    // Firebase persistence shares identity; the lock prevents simultaneous first-visit signup races.
    const user = navigator.locks ? await navigator.locks.request('atc-anonymous-signin', login) : await login();
    if (!user?.isAnonymous) throw new Error('Visitor identity must be anonymous');
    const db = dbSDK.getDatabase(app), presence = dbSDK.ref(db, 'presence/' + tab);
    let hasConnected = false;
    dbSDK.onValue(dbSDK.ref(db, '.info/serverTimeOffset'), s => {
      const next = Number(s.val()) || 0;
      if (Math.abs(next - offset) > 1000) {
        const delta = next - offset; tracker.lastWall += delta; tracker.lastInput += delta;
        if (!hasConnected) {
          const values = Object.values(tracker.records); tracker.records = {};
          const r = tracker.record(Date.now() + next);
          for (const v of values) { r.player ||= v.player; r.starts += v.starts; r.ends += v.ends; r.views += v.views || 0; }
        }
      }
      offset = next;
    });
    const sent = {};
    flush = async () => {
      if (!connected || !presenceReady || flushing) return;
      flushing = true;
      try {
        tracker.tick(clock());
        const active = !stopped && tracker.active(clock());
        // Use an estimated server time (not serverTimestamp), so queued writes cannot resurrect old activity.
        if (active) {
          await dbSDK.set(presence, { uid: user.uid, lastSeen: clock(), active: true });
          presencePublished = true;
        } else if (presencePublished) { await dbSDK.remove(presence); presencePublished = false; }
        for (const [day, values] of Object.entries(tracker.records)) {
          if (Number(day) < Number(dayKey(clock())) - DAY) { delete tracker.records[day]; delete sent[day]; continue; }
          const serialized = JSON.stringify(values);
          if (sent[day] === serialized) continue;
          // Never queue a new write when a known disconnect occurs.
          if (!connected) break;
          await dbSDK.set(dbSDK.ref(db, `activity/${day}/${user.uid}/${tab}`), { ...values, updatedAt: clock() });
          sent[day] = serialized;
        }
      } catch (error) { console.warn('[ATC statistics] Write failed; will retry', error.code || error.message); }
      finally { flushing = false; }
    };
    let connectionEpoch = 0;
    dbSDK.onValue(dbSDK.ref(db, '.info/connected'), async snapshot => {
      const epoch = ++connectionEpoch;
      connected = snapshot.val() === true; presenceReady = false; presencePublished = false;
      tracker.environment({ connected: false }, clock());
      if (!connected) return;
      try {
        // Register on the server BEFORE publishing presence, and re-register on every reconnect.
        await dbSDK.onDisconnect(presence).remove();
        if (epoch !== connectionEpoch) return;
        hasConnected = true; presenceReady = true; tracker.environment({ connected: true }, clock());
        await flush();
      } catch (error) { console.warn('[ATC statistics] Presence unavailable', error.code || error.message); }
    });
    // 30 seconds balances freshness, write volume and free quota consumption.
    setInterval(() => void flush(), 30000);
    window.addEventListener('atc:state', () => void flush());
  } catch (error) {
    console.warn('[ATC statistics] Service unavailable; retrying in 30 seconds', error.code || error.message);
    setTimeout(() => { if (!stopped) void connect(); }, 30000);
  }
  }
  void connect();
})();
