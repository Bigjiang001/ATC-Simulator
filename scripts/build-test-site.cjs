const { execFileSync } = require('node:child_process');
const path = require('node:path');
// Tests must never send production traffic, even when a developer has a real local config.
execFileSync(process.execPath, [path.join(__dirname, 'build-site.cjs')], {
  stdio: 'inherit', env: { ...process.env, ATC_ANALYTICS_CONFIG_JSON: '{"enabled":false}' }
});
