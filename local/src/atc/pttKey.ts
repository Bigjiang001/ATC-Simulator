const STORAGE_KEY = 'atc-ptt-key';
export function loadPttKey(): string {
  try { return window.localStorage.getItem(STORAGE_KEY) || 'Shift'; } catch { return 'Shift'; }
}
export function savePttKey(code: string): void {
  try { window.localStorage.setItem(STORAGE_KEY, code); } catch { /* Storage can be disabled. */ }
}
export function matchesPttKey(e: KeyboardEvent, code: string): boolean {
  return code === 'Shift' ? e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.key === 'Shift' : e.code === code;
}
export function pttKeyLabel(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, '小键盘 ').replace('Space', '空格');
}
