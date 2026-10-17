import { EN_UI } from './en';

export type UiLanguage = 'CN' | 'EN';
const STORAGE_KEY = 'atc2.uiLanguage';
const HAN = /[\u3400-\u9fff]+/g;
const fragments = new RegExp(Object.keys(EN_UI).sort((a, b) => b.length - a.length).join('|'), 'g');
const cache = new Map<string, string>();
const EXACT_EN_UI: Record<string, string> = {
  "AVOID / 绕飞": "AVOID",
  "★ HANDOFF 移交!": "★ HANDOFF!",
  "管制指令台 ATC CONTROL CONSOLE": "ATC CONTROL CONSOLE",
  "电子进程单 FLIGHT STRIPS (": "FLIGHT STRIPS (",
  "航向 HEADING": "HEADING",
  "GO AROUND 复飞": "GO AROUND",
  "HDG 航向": "HDG",
  "ALT 高度": "ALT",
  "IAS / GS 速度": "IAS / GS",
  "STATUS 状态": "STATUS",
  "执照编号 License No.": "License No.",
  "考核基地 Airport Sector": "Airport Sector",
  "实操考核得分 Exam Score": "Exam Score",
  "高度计量制式 Standard": "Altitude standard",
  "刚才取得的最终分数 Final Score Achieved": "Final Score",
  "本局安全着陆航班 Arrivals Landed": "Arrivals Landed",
  "本局成功离场移交 Departures Handed Off": "Departures Handed Off",
  "班次执勤时长 Shift Duration": "Shift Duration",
  "简单 EASY": "EASY",
  "普通 NORMAL": "NORMAL",
  "困难 HARD": "HARD",
  "🇨🇳 公制 (米 / m)": "🇨🇳 Metric (m)",
  "🌐 英制 (英尺 / ft)": "🌐 Imperial (ft)",
  "CALM (静风00KT)": "CALM (00KT)"
};

export function loadUiLanguage(): UiLanguage {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'EN'
      ? 'EN' : 'CN';
  } catch {
    return 'CN';
  }
}

export function saveUiLanguage(language: UiLanguage): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private browsing/storage restrictions must not prevent switching language.
  }
}

/** Translate display text only; never feed translated text back into the simulation. */
export function uiText(text: string, language: UiLanguage = 'CN'): string {
  if (language === 'CN' || !/[\u3400-\u9fff]/.test(text)) return text;
  const exact = EXACT_EN_UI[text.trim()];
  if (exact !== undefined) return text.replace(text.trim(), exact);
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const translated = text.replace(HAN, (phrase) => {
    const english = EN_UI[phrase];
    return english !== undefined ? ` ${english} `
      : phrase.replace(fragments, (fragment) => ` ${EN_UI[fragment]} `);
  }).replace(/[，、]/g, ', ').replace(/。/g, '. ')
    .replace(/：/g, ': ').replace(/；/g, '; ').replace(/！/g, '!')
    .replace(/？/g, '?').replace(/[（【]/g, '(').replace(/[）】]/g, ')')
    .replace(/[“”]/g, '"').replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?)])/g, '$1').replace(/([(]) +/g, '$1');
  // Dynamic radar/flight values must not grow an unbounded translation cache.
  if (cache.size >= 2048) cache.clear();
  cache.set(text, translated);
  return translated;
}
