const assert = require('node:assert/strict');
const fs = require('node:fs');
const babel = require('@babel/core');
require.extensions['.ts'] = (module, filename) => {
  const compiled = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename,
    presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }], require.resolve('@babel/preset-typescript')] });
  module._compile(compiled.code, filename);
};
const { QWEN_VOICES, normalizeVoiceProfile, resolveVoiceIdForLanguage, saveVoicePreferences, loadVoicePreferences } = require('../src/audio/voiceCatalog.ts');
assert.equal(QWEN_VOICES.length, 9);
const original = { voiceURI: 'Vivian', rate: 1.2, pitch: 1, presetLabel: 'Vivian' };
for (const voice of QWEN_VOICES) {
  for (const language of ['CN', 'EN']) assert.equal(resolveVoiceIdForLanguage({ ...original, voiceURI: voice.voiceURI }, 'PILOT', language), voice.voiceURI);
}
let selected = normalizeVoiceProfile(original, { voiceURI: 'Eric', rate: 1.35 }, 'PILOT', 'CN', 'CN');
assert.equal(selected.voiceURI, 'Eric'); assert.match(selected.presetLabel, /四川/);
let english = normalizeVoiceProfile(selected, undefined, 'PILOT', 'CN', 'EN');
assert.equal(english.voiceURI, 'am_michael'); assert.equal(english.rate, 1.12);
english = normalizeVoiceProfile(english, { voiceURI: 'Ryan', rate: 1.15 }, 'PILOT', 'EN', 'EN');
selected = normalizeVoiceProfile(english, undefined, 'PILOT', 'EN', 'CN');
assert.equal(selected.voiceURI, 'Eric'); assert.equal(selected.rate, 1.35);
const again = normalizeVoiceProfile(selected, undefined, 'PILOT', 'CN', 'EN');
assert.equal(again.voiceURI, 'Ryan'); assert.equal(again.rate, 1.15);
assert.equal(original.voiceURI, 'Vivian'); assert.equal(original.rate, 1.2);
const storage = new Map();
global.window = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
saveVoicePreferences(original, selected);
const restored = loadVoicePreferences(original, original);
assert.equal(restored.pilot.voiceURI, 'Eric'); assert.equal(restored.pilot.rate, 1.35);
assert.equal(restored.pilot.languageProfiles.EN.voiceURI, 'Ryan');
assert.equal(normalizeVoiceProfile(original, { rate: 10 }, 'PILOT', 'CN', 'CN').rate, 1.5);
window.localStorage.getItem = () => { throw Error('blocked'); };
assert.doesNotThrow(() => loadVoicePreferences(original, original));
delete global.window;
console.log('PASS: nine Qwen voices, exact selection, dialect names, independent CN/EN rates, reload persistence and blocked storage');
