const assert = require('node:assert/strict');
const fs = require('node:fs');
const babel = require('@babel/core');
require.extensions['.ts'] = (module, filename) => {
  const result = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename,
    presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }],
      require.resolve('@babel/preset-typescript')] });
  module._compile(result.code, filename);
};
const { soundEngine, resolveVoiceIdForLanguage } = require('../src/audio/soundEngine.ts');
const profile = { voiceURI: 'Serena', preferredGender: 'FEMALE', rate: 1.12, pitch: 1 };
let played = 0, browserSpeech = 0, requests = 0;
global.window = { setTimeout, clearTimeout,
  speechSynthesis: { speak() { browserSpeech++; } } };
soundEngine.ensureContext = () => ({ decodeAudioData: async () => ({ duration: 1 }) });
soundEngine.playAudioBufferThroughVhfRadio = async () => { played++; };
soundEngine.stopContinuousVhfStatic = () => {};
const synth = () => soundEngine.playViaKokoroTtsEngine('保持600米', 'CN', profile, 'PILOT', 'OFF');
function response(engine = 'qwen3-tts-0.6b', voice = 'Serena') {
  return { ok: true, headers: new Map([['X-ATC-TTS-Engine', engine], ['X-ATC-TTS-Voice', voice]]),
    arrayBuffer: async () => new ArrayBuffer(44) };
}
(async () => {
  // Network failure and a stale/incorrect backend must never speak using another engine.
  global.fetch = async () => { throw Error('offline'); };
  await synth(); assert.equal(played, 0); assert.ok(soundEngine.getAiEngineStatus().lastTtsError);
  global.fetch = async () => response('edge-tts', 'Tingting');
  await synth(); assert.equal(played, 0); assert.equal(soundEngine.kokoroAudioCache.size, 0);
  global.fetch = async () => { requests++; return response(); };
  await synth(); await synth(); assert.equal(requests, 1); assert.equal(played, 2);
  profile.rate = 1.2; await synth(); assert.equal(requests, 2); // rate is part of cache identity
  soundEngine.kokoroAudioCache.clear();
  let finish;
  global.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = synth(); soundEngine.stopAllSpeech(); finish(response()); await pending;
  assert.equal(played, 3); // canceled synthesis can never play later
  assert.equal(browserSpeech, 0);
  for (const dialect of ['Dylan', 'Eric']) {
    assert.equal(resolveVoiceIdForLanguage({ ...profile, voiceURI: dialect }, 'PILOT', 'CN'), dialect);
  }
  for (const voiceURI of ['Serena', 'Vivian', 'Uncle_Fu']) {
    assert.equal(resolveVoiceIdForLanguage({ ...profile, voiceURI }, 'PILOT', 'CN'), voiceURI);
  }
  console.log('PASS: local-only TTS, provenance, rate cache, cancellation and Mandarin voice selection');
})().catch(error => { console.error(error); process.exitCode = 1; });
