// Main-thread bridge to the separately licensed synthesis worker.
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (audio: BuiltinAudio) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export interface BuiltinAudio { samples: Float32Array; sampleRate: number; }
export function cancelBuiltinSpeech(): void {
  // Terminate only if work is pending; otherwise keep the loaded voice pack warm.
  if (!pending.size) return;
  worker?.terminate(); worker = null;
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('cancelled')); }
  pending.clear();
}
export function synthesizeBuiltin(text: string, language: 'CN' | 'EN', variant: string, rate: number): Promise<BuiltinAudio> {
  if (!worker) {
    worker = new Worker(new URL('./voices/worker.js', document.baseURI), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id); if (!task) return;
      pending.delete(data.id); clearTimeout(task.timer);
      if (data.error) task.reject(new Error(data.error));
      else task.resolve({ samples: data.samples, sampleRate: data.sampleRate });
    };
    worker.onerror = () => {
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Voice engine failed to load')); }
      pending.clear(); worker?.terminate(); worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => cancelBuiltinSpeech(), 45000);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, text, language, variant, rate });
  });
}
