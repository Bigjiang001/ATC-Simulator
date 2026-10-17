import { test, expect } from '@playwright/test';

// Browser audio transport is mocked here. Actual SenseVoice inference is verified separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
  });
  await page.route('http://127.0.0.1:18765/**', async (route) => {
    if (route.request().url().includes('/api/asr')) {
      await route.fulfill({ json: { raw_text: '冬航五两要三下降六百米可以忙降',
        itn_text: '东航5213下降600米可以盲降', verified_text: '东航5213下降600米可以盲降', sensevoice_ready: true } });
    } else if (route.request().url().includes('/api/health')) {
      await route.fulfill({ json: { status: 'ok', sensevoice_ready: true, kokoro_ready: true, qwen_ready: true, device: 'TEST' } });
    } else await route.abort();
  });
  await page.goto('');
  await expect(page.getByTestId('mission-start-FIRST_LANDING')).toBeVisible();
});

test('First landing: visible suggestion, actual touchdown, saved stars, next mission and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await expect(page.getByTestId('mission-start-FIRST_DEPARTURE')).toBeDisabled();
  await page.getByTestId('mission-start-FIRST_LANDING').click();
  await expect(page.getByTestId('radar-canvas')).toBeVisible();
  await page.getByTestId('voice-suggested-command').click();
  const result = await page.evaluate(() => {
    const store = (window as any).__ATC_STORE__;
    for (let i = 0; i < 1200 && store.getState().status === 'RUNNING'; i++) store.getState().tickSimulation(.25);
    return { status: store.getState().status, landed: store.getState().landedCount };
  });
  expect(result).toEqual({ status: 'VICTORY', landed: 1 });
  await expect(page.getByTestId('mission-debrief')).toContainText('★★★');
  await page.getByTestId('btn-review-settlement').click();
  await expect(page.getByTestId('settlement-modal')).toHaveCount(0);
  await expect(page.getByTestId('settlement-review-bar')).toBeVisible();
  await expect(page.getByTestId('radar-canvas')).toBeVisible();
  await page.getByTestId('btn-return-settlement').click();
  await page.getByTestId('mission-next').click();
  await expect(page.getByTestId('mission-status')).toContainText('第二关');
  await page.reload();
  await expect(page.getByTestId('mission-start-FIRST_DEPARTURE')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Shift microphone capture submits Mandarin ASR and executes corrected compound instructions', async ({ page }) => {
  await page.getByTestId('mission-start-FIRST_LANDING').click();
  await page.keyboard.down('Shift');
  await expect.poll(() => page.evaluate(() => (window as any).__ATC_STORE__.getState().voicePtt.isListening)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__ATC_STORE__.getState().voicePtt.interimTranscript), { timeout: 15000 }).toContain('正在收音');
  await page.waitForTimeout(400); // collect enough fake microphone frames
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => (window as any).__ATC_STORE__.getState().voicePtt.statusType)).toBe('SUCCESS');
  const state = await page.evaluate(() => {
    const s = (window as any).__ATC_STORE__.getState();
    return { raw: s.voicePtt.lastSpokenRaw, callsign: s.aircraft[0].callsign,
      cleared: s.aircraft[0].clearedApproach, pilot: s.radioLogs.filter((r: any) => r.sender === 'PILOT').at(-1).messageCn };
  });
  expect(state.raw).toContain('冬航'); expect(state.callsign).toBe('CES5213'); expect(state.cleared).toBe(true);
  expect(state.pilot).toMatch(/东方航空 5213。$/);
});

test('Procedure training exposes separate landing clearance and the button grants permission', async ({ page }) => {
  await page.evaluate(() => {
    const store = (window as any).__ATC_STORE__;
    store.setState({ missionProgress: { FIRST_DEPARTURE: { stars: 1, bestScore: 0, bestTimeSec: 300 } } });
    store.getState().startMission('PUDONG_FLOW');
    store.getState().sendCommand({ type: 'VECTOR_TO_FINAL' });
  });
  await expect(page.getByTestId('btn-cleared-land')).toBeEnabled();
  await page.getByTestId('btn-cleared-land').click();
  await expect(page.getByTestId('btn-cleared-land')).toBeDisabled();
  expect(await page.evaluate(() => {
    const s = (window as any).__ATC_STORE__.getState(); return s.aircraft.find((a: any) => a.id === s.selectedAircraftId).clearedToLand;
  })).toBe(true);
});

test('English UI preserves bilingual radio and exposes assistance settings', async ({ page }) => {
  const log = await page.getByTestId('radio-comm-log').innerText();
  await page.getByTestId('ui-language-en-lobby').click();
  expect(await page.getByTestId('radio-comm-log').innerText()).toBe(log);
  await page.getByTestId('mission-start-FIRST_LANDING').click();
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('toggle-landing-clearance')).toContainText('Beginner flow');
  await page.getByTestId('toggle-landing-clearance').click();
  await expect(page.getByTestId('toggle-landing-clearance')).toContainText('Procedure training');
  await page.getByTestId('toggle-voice-assist').click();
  await page.getByTestId('btn-close-settings').click();
  await expect(page.getByTestId('voice-assist-panel')).toHaveCount(0);
});


test('All Qwen voices and independent rates remain selected across language changes and reload', async ({ page }) => {
  await page.getByTestId('mission-start-FIRST_LANDING').click();
  await page.getByTestId('btn-settings').click();
  await expect(page.locator('[data-testid^="select-atc-preset-"]')).toHaveCount(0);
  await expect(page.getByTestId('select-atc-voice-uri').locator('option')).toHaveCount(9);
  await page.getByTestId('select-atc-voice-uri').selectOption('Eric');
  await expect(page.getByTestId('atc-voice-description')).toContainText('四川成都话');
  await page.getByTestId('atc-voice-rate').fill('1.35');
  await page.getByTestId('pilot-voice-rate').fill('1.25');
  await expect(page.getByTestId('atc-voice-rate-value')).toHaveText('1.35×');
  await expect(page.getByTestId('pilot-voice-rate-value')).toHaveText('1.25×');
  await page.getByTestId('select-tts-lang-en').click();
  await expect(page.getByTestId('select-atc-voice-uri').locator('option')).toHaveCount(15);
  await page.getByTestId('select-atc-voice-uri').selectOption('Ryan');
  await page.getByTestId('atc-voice-rate').fill('1.1');
  await page.getByTestId('select-tts-lang-cn').click();
  await expect(page.getByTestId('select-atc-voice-uri')).toHaveValue('Eric');
  await expect(page.getByTestId('atc-voice-rate-value')).toHaveText('1.35×');
  await page.getByTestId('ui-language-en-settings').click();
  await expect(page.getByTestId('atc-voice-description')).toContainText('Sichuan');
  await page.reload();
  await page.getByTestId('mission-start-FIRST_LANDING').click();
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('select-atc-voice-uri')).toHaveValue('Eric');
  await expect(page.getByTestId('atc-voice-rate-value')).toHaveText('1.35×');
  await page.getByTestId('reset-atc-voice-rate').click();
  await expect(page.getByTestId('atc-voice-rate-value')).toHaveText('1.20×');
});

test('Clean preview bypasses the radio filters while the selected voice and rate are sent to TTS', async ({ page }) => {
  const samples = 4800, wav = (globalThis as any).Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(3000 * Math.sin(i * .06)), 44 + i * 2);
  await page.route('http://127.0.0.1:18765/api/tts', async route => {
    const data = route.request().postDataJSON();
    await route.fulfill({ body: wav, contentType: 'audio/wav', headers: {
      'X-ATC-TTS-Engine': 'qwen3-tts-0.6b', 'X-ATC-TTS-Voice': data.voice,
      'Access-Control-Expose-Headers': 'X-ATC-TTS-Engine, X-ATC-TTS-Voice' } });
  });
  await page.getByTestId('mission-start-FIRST_LANDING').click();
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('select-pilot-voice-uri').selectOption('Dylan');
  await page.getByTestId('pilot-voice-rate').fill('1.3');
  await page.evaluate(() => {
    (window as any).__audioConnections = [];
    const original = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: any[]) {
      (window as any).__audioConnections.push([this.constructor.name, args[0]?.constructor.name]);
      return (original as any).apply(this, args);
    } as any;
  });
  const request = page.waitForRequest(r => r.url().endsWith('/api/tts'));
  await page.getByTestId('btn-preview-pilot-dry').click();
  const data = (await request).postDataJSON();
  expect(data.voice).toBe('Dylan'); expect(data.speed).toBe(1.3);
  await expect.poll(() => page.evaluate(() => (window as any).__audioConnections.some((x: string[]) => x[0] === 'AudioBufferSourceNode' && x[1] === 'GainNode'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__audioConnections.some((x: string[]) => x[0] === 'AudioBufferSourceNode' && x[1] === 'BiquadFilterNode'))).toBe(false);
  await page.evaluate(() => { (window as any).__audioConnections = []; });
  await page.getByTestId('btn-preview-pilot-voice').click();
  await expect.poll(() => page.evaluate(() => (window as any).__audioConnections.some((x: string[]) => x[0] === 'AudioBufferSourceNode' && x[1] === 'BiquadFilterNode'))).toBe(true);
});
