const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const React = require('react');

require.extensions['.ts'] = (module, filename) => {
  const compiled = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }],
      require.resolve('@babel/preset-typescript')],
  });
  module._compile(compiled.code, filename);
};
const { uiText, loadUiLanguage, saveUiLanguage } = require('../src/i18n/language.ts');
const { localizeUi } = require('../src/i18n/react.ts');
const { useGameStore } = require('../src/game/store.ts');
let passed = 0;
function check(name, run) { run(); console.log(`PASS: ${name}`); passed++; }

check('Switching UI language preserves the running simulation, speech settings and bilingual log', () => {
  const before = useGameStore.getState();
  before.setUiLanguage('EN');
  const after = useGameStore.getState();
  assert.equal(after.uiLanguage, 'EN');
  for (const key of ['settings', 'aircraft', 'radioLogs', 'selectedAircraftId', 'simTimeSec', 'status']) {
    assert.strictEqual(after[key], before[key], key);
  }
  after.restartGame(undefined, false);
  assert.equal(useGameStore.getState().uiLanguage, 'EN');
});
check('Language preference survives reload and unavailable browser storage', () => {
  const entries = new Map();
  global.window = { localStorage: { getItem: (k) => entries.get(k), setItem: (k, v) => entries.set(k, v) } };
  saveUiLanguage('EN'); assert.equal(loadUiLanguage(), 'EN');
  saveUiLanguage('CN'); assert.equal(loadUiLanguage(), 'CN');
  global.window.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(loadUiLanguage(), 'CN'); assert.doesNotThrow(() => saveUiLanguage('EN'));
  delete global.window;
});
check('Localization preserves refs, raw command values, handlers and the original element', () => {
  const ref = React.createRef(); let clicked = false;
  const onClick = () => { clicked = true; };
  const original = React.createElement('input', { ref, value: '东航5213下600盲降', onClick,
    title: '语音指挥', placeholder: '请说话', 'data-testid': 'unchanged-id' });
  const result = localizeUi(original, 'EN');
  assert.strictEqual(result.ref, ref); assert.strictEqual(result.props.onClick, onClick);
  assert.equal(result.props.value, original.props.value);
  assert.equal(result.props['data-testid'], 'unchanged-id');
  assert.equal(original.props.title, '语音指挥');
  assert.equal(result.props.title.trim(), 'Voice control');
  result.props.onClick(); assert.equal(clicked, true);
  const radio = React.createElement('div', { 'data-ui-preserve': true }, '东方航空，中英文双语通话');
  assert.strictEqual(localizeUi(radio, 'EN'), radio);
});
check('All authored UI and dynamic display phrases have English translations', () => {
  const root = path.resolve(__dirname, '../src');
  const missing = [];
  function scan(folder) {
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name);
      if (fs.statSync(file).isDirectory()) {
        if (!['i18n', 'tests'].includes(name)) scan(file);
      } else if (/\.(ts|tsx)$/.test(file) && name !== 'RadioCommLog.tsx') {
        const ast = parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
        traverse(ast, { enter(p) {
          if (!['StringLiteral', 'JSXText', 'TemplateElement'].includes(p.node.type)) return;
          const value = p.node.type === 'TemplateElement' ? p.node.value.cooked : p.node.value;
          for (const phrase of value.match(/[\u3400-\u9fff]+/g) || []) {
            if (/[\u3400-\u9fff]/.test(uiText(phrase, 'EN'))) missing.push(`${name}: ${phrase}`);
          }
        } });
      }
    }
  }
  scan(root);
  assert.deepEqual([...new Set(missing)], []);
  assert.equal(uiText('保留中文原文', 'CN'), '保留中文原文');
  assert.equal(uiText('HDG 090 / RWY 09L / 900m', 'EN'), 'HDG 090 / RWY 09L / 900m');
});
console.log(`${passed}/${passed} UI-language regression checks passed`);
