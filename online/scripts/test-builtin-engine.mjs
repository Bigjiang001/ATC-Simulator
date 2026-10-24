import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import createEngine from '../voices/vendor/espeak-ng.js';
const module = await createEngine({ print: () => {}, printErr: () => {} });
const engine = new module.eSpeakNGWorker();
for (const [lang, text] of [['cmn', '左转航向两拐洞，下降保持六百米，东方航空五两幺三。'], ['en-us', 'Turn left heading two seven zero, descend and maintain two thousand feet, China Eastern five two one three.']]) {
  const hashes = [];
  for (const voice of ['m1', 'm2', 'm3']) {
    engine.set_voice(`${lang}+${voice}`, '', 1); engine.set_rate(195);
    const chunks = []; engine.synthesize(text, pcm => { chunks.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)); return false; });
    const audio = Buffer.concat(chunks); assert(audio.length > 44100, `${lang}/${voice}: actual audio generated`);
    const samples = new Int16Array(audio.buffer, audio.byteOffset, audio.byteLength / 2);
    assert(samples.some(x => Math.abs(x) > 1000), `${lang}/${voice}: non-silent speech`);
    hashes.push(createHash('sha256').update(audio).digest('hex'));
  }
  assert.equal(new Set(hashes).size, 3, `${lang}: three distinct male variants`);
  assert.equal(engine.get_samplerate(), 22050);
  console.log(`PASS: bundled ${lang} dictionary and three male voices produce distinct non-silent 22050Hz speech`);
}
