const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function loadConfig() {
  const file = process.env.ATC_ANALYTICS_CONFIG || (fs.existsSync(path.join(root, 'analytics/config.local.json')) ? path.join(root, 'analytics/config.local.json') : path.join(root, 'analytics/config.public.json'));
  if (process.env.ATC_ANALYTICS_CONFIG && !process.env.ATC_ANALYTICS_CONFIG_JSON && !fs.existsSync(file)) throw new Error('Analytics config file does not exist: ' + file);
  const config = process.env.ATC_ANALYTICS_CONFIG_JSON ? JSON.parse(process.env.ATC_ANALYTICS_CONFIG_JSON)
    : JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : path.join(root, 'analytics/config.example.json'), 'utf8'));
  // Explicit allowlist: never serialize unknown keys or credentials into the static site.
  const allowed = ['enabled', 'ga4MeasurementId', 'firebase', 'functionsRegion', 'appCheckSiteKey', 'dashboardMode'];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new Error('Unknown analytics config: ' + key);
  const firebaseKeys = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId', 'messagingSenderId', 'measurementId'];
  for (const key of Object.keys(config.firebase || {})) if (!firebaseKeys.includes(key)) throw new Error('Unsupported Firebase public config key: ' + key);
  if (typeof config.enabled !== 'boolean') throw new Error('analytics.enabled must be boolean');
  if (config.enabled) {
    if (config.ga4MeasurementId && !/^G-[A-Z0-9]+$/.test(config.ga4MeasurementId)) throw new Error('Invalid GA4 measurement ID');
    for (const key of ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'])
      if (typeof config.firebase?.[key] !== 'string' || !config.firebase[key]) throw new Error('Missing Firebase config: ' + key);
    if (!/^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(config.firebase.databaseURL)) throw new Error('Invalid Firebase databaseURL');
    if (!/^[a-z]+-[a-z]+[0-9]$/.test(config.functionsRegion || '')) throw new Error('Missing or invalid functionsRegion');
  }
  return config;
}
function analyticsTags(kind) {
  const safe = value => value.replace(/<\//g, '<\\/');
  const config = JSON.stringify(loadConfig()).replace(/</g, '\\u003c');
  return `<meta name="atc-page" content="${kind}">\n<script>window.ATC_ANALYTICS_CONFIG=${config};</script>\n` +
    `<script>${safe(fs.readFileSync(path.join(root, 'analytics/core.js'), 'utf8'))}</script>\n` +
    `<script type="module">${safe(fs.readFileSync(path.join(root, kind === 'admin' ? 'analytics/admin.js' : 'analytics/client.js'), 'utf8'))}</script>`;
}
function inject(html, kind) {
  if (html.includes('name="atc-page"')) throw new Error('Analytics injected twice');
  return html.replace('</head>', analyticsTags(kind) + '\n</head>');
}
module.exports = { loadConfig, analyticsTags, inject };
