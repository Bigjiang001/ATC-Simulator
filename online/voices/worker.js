// Isolated eSpeak NG worker; engine license and source notices are in vendor/.
import createEngine from './vendor/espeak-ng.js';
let enginePromise;
self.onmessage = async ({ data }) => {
  const { id, text, language, variant, rate } = data;
  try {
    enginePromise ||= createEngine({ print: () => {}, printErr: () => {} })
      .then(module => new module.eSpeakNGWorker());
    const engine = await enginePromise;
    if (!['m1', 'm2', 'm3'].includes(variant) || !['CN', 'EN'].includes(language)) throw Error('Invalid voice');
    engine.set_voice(`${language === 'CN' ? 'cmn' : 'en-us'}+${variant}`, '', 1);
    engine.set_rate(Math.round((language === 'CN' ? 175 : 165) * Math.max(.9, Math.min(1.5, rate))));
    const chunks = []; let length = 0;
    engine.synthesize(String(text).slice(0, 2000), pcm => { chunks.push(pcm); length += pcm.length; return false; });
    if (!length) throw Error('Empty voice output');
    const samples = new Float32Array(length); let offset = 0;
    for (const chunk of chunks) { for (const sample of chunk) samples[offset++] = sample / 32768; }
    self.postMessage({ id, samples, sampleRate: engine.get_samplerate() }, [samples.buffer]);
  } catch (error) { enginePromise = null; self.postMessage({ id, error: String(error.message || error) }); }
};
