import {
  Aircraft,
  AirportConfig,
  AltitudeUnit,
  RunwayDirectionConfig,
  RunwayId,
  RunwayCountMode,
} from '../aircraft/types';
import { ATCCommand, parseTextCommand, getRadioCallsign } from './commands';
import {
  checkIlsConditions,
  formatAltitudeSpeechCn,
  formatAltitudeSpeechEn,
  formatHeading,
  normalizeHeading,
} from '../aircraft/physics';
import { getActiveRunwaysForDirection } from '../airport/harborAirport';

export interface FuzzyVoiceParseResult {
  candidateAircraftIds?: string[];
  correctionNote?: string;
  matchMode?: AircraftSpeechMatch['matchMode'];
  matchedAircraftId: string | null;
  matchedCallsign: string | null;
  commands: ATCCommand[];
  summaryCn: string;
  rawTranscript: string;
  normalizedPreviewCn: string;
  /** 经航空通话规范化引擎生成的专业标准中文空管指令 */
  standardAtcPhraseCn?: string;
  /** 经航空通话规范化引擎生成的专业标准英文 ICAO 空管指令 */
  standardAtcPhraseEn?: string;
  /** 经 Kokoro 航空发音预处理器转换后的音标文本（如 Bravo niner zero zero one / two seven zero） */
  kokoroPhoneticText?: string;
}

/**
 * ICAO Annex 10 国际民航北约字母解释法 (NATO Phonetic Alphabet) 与数字标准读音表
 * 用于在送入 Kokoro TTS 前将呼号（如 B9001）、航向（如 270）、跑道（如 09L）转为地道航空英语发音
 */
const ICAO_NATO_LETTER_MAP: Record<string, string> = {
  A: 'Alpha',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
};

const ICAO_DIGIT_PHONETIC_EN: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'niner',
};

const CAAC_DIGIT_PHONETIC_CN: Record<string, string> = {
  '0': '洞',
  '1': '幺',
  '2': '两',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
  '7': '拐',
  '8': '八',
  '9': '九',
};

/**
 * 【技术细节 2 · Kokoro TTS 航空发音预处理器】
 * 在送入 Kokoro TTS 合成整句语音前，先处理航空数字与字母读法：
 * - 将 B9001 转为 "Bravo niner zero zero one"
 * - 将 270 转为 "two seven zero"（中文转为 "两拐洞"）
 * - 将 09L 转为 "zero niner left"（中文转为 "洞九左"）
 * - 将频率 125.8 转为 "wun two fife decimal eight"（中文转为 "幺两五点八"）
 * 彻底杜绝 Kokoro TTS 出现日常英语/中文里的“二百七十”、“九千零一”等非专业读法！
 */
export function formatKokoroAviationPhonetics(
  rawText: string,
  lang: 'CN' | 'EN' = 'EN'
): string {
  if (!rawText) return '';

  // 移除界面装饰图标与前缀标签
  let text = rawText
    .replace(/🎙️\s*\[[^\]]*\]\s*/g, '')
    .replace(/\[[^\]]*\]\s*/g, '')
    .replace(/[🚨⚠✓★🎯🎙️⛔⚡🔥]/g, '')
    .trim();

  if (lang === 'CN') {
    const toCnDigits = (numStr: string) =>
      numStr
        .split('')
        .map((d) => CAAC_DIGIT_PHONETIC_CN[d] ?? d)
        .join('');

    const cnAirlineMap: Record<string, string> = {
      CES: '东方航空',
      CCA: '中国国航',
      CSN: '南方航空',
      CHH: '海南航空',
      CPA: '国泰航空',
      CXA: '厦门航空',
      CSC: '四川航空',
      CKK: '中货航',
      ANA: '全日空',
      JAL: '日本航空',
      SKY: '天马航空',
      ADO: '北海道航空',
      BAW: '英国航空',
      VIR: '维珍航空',
      EZY: '易捷航空',
      DLH: '汉莎航空',
      AFR: '法国航空',
      SIA: '新加坡航空',
    };

    // 移除括号内的英文备注（如 (LINE UP AND WAIT)、(HANDOFF)、(IDENT)），避免中文播音夹杂生硬英文
    text = text.replace(/\([A-Z0-9\s/-]+\)/g, '');

    // 1. 航司三字码呼号转为纯正中文航司名 + 民航数字读音 (如 CES5213 -> 东方航空 五两幺三)
    text = text.replace(/\b([A-Z]{3})\s*([0-9]{2,4})\b/g, (full, icao, num) => {
      const up = String(icao).toUpperCase();
      if (cnAirlineMap[up]) {
        return `${cnAirlineMap[up]} ${toCnDigits(num)}`;
      }
      return full;
    });

    // 2. 通用航空器注册号/呼号 (如 B9001 / B-9001 -> B 9001)
    text = text.replace(/\b([A-Z])-?([0-9]{3,4})\b/g, (_, letter, digits) => {
      const nato = ICAO_NATO_LETTER_MAP[letter.toUpperCase()] || letter;
      return `${nato} ${toCnDigits(digits)}`;
    });

    // 3. 跑道编号 (09L -> 洞九左, 27R -> 两拐右)
    text = text.replace(/\b(09|27|34|16|35|17|22|04)([LR])?\b/g, (_, num, side) => {
      const sideCn = side === 'L' ? '左' : side === 'R' ? '右' : '';
      return `${toCnDigits(num)}${sideCn}`;
    });

    // 4. 航向三位数字 (航向 270 -> 航向 两拐洞)
    text = text.replace(/(航向\s*)([0-9]{3})/g, (_, prefix, hdg) => {
      return `${prefix}${toCnDigits(hdg)}`;
    });

    // 5. 甚高频频率 (125.8 -> 幺两五点八)
    text = text.replace(/\b(1[12][0-9])\.([0-9]{1,2})\b/g, (_, p1, p2) => {
      return `${toCnDigits(p1)}点${toCnDigits(p2)}`;
    });

    // 6. 航司中文名与应答机编码数字逐位播报
    text = text.replace(
      /(航空|国航|南航|东航|海航|厦航|川航|货航|全日空|天马|北海道|维珍|易捷|汉莎|应答机|编码)\s*([0-9]{3,4})/g,
      (_, prefix, num) => `${prefix} ${toCnDigits(num)}`
    );

    // 7. 清理残留英文空管缩写为纯正中文民航术语
    text = text
      .replace(/\bILS\s*盲降/gi, '盲降')
      .replace(/\bILS\b/gi, '盲降')
      .replace(/\bRWY\b/gi, '跑道')
      .replace(/\bIDENT\b/gi, '识别');

    return text.replace(/\s+/g, ' ').trim();
  }

  // ==================== 英文 ICAO 标准 Kokoro 发音转换 ====================
  const toEnDigits = (numStr: string) =>
    numStr
      .split('')
      .map((d) => ICAO_DIGIT_PHONETIC_EN[d] ?? d)
      .join(' ');

  // 1. 缩写展开
  text = text
    .replace(/\bRWY\b/gi, 'runway')
    .replace(/\bHDG\b/gi, 'heading')
    .replace(/\bALT\b/gi, 'altitude')
    .replace(/\bSPD\b/gi, 'speed')
    .replace(/\bSQK\b/gi, 'squawk')
    .replace(/\bKT\b/gi, 'knots')
    .replace(/\bFT\b/gi, 'feet')
    .replace(/\bILS\b/gi, 'I L S');

  // 2. 单字母注册号/呼号 (例如 B9001 -> Bravo niner zero zero one, N738 -> November seven tree ait)
  text = text.replace(/\b([A-Z])-?([0-9]{3,4})\b/g, (_, letter, digits) => {
    const nato = ICAO_NATO_LETTER_MAP[letter.toUpperCase()] || letter;
    return `${nato} ${toEnDigits(digits)}`;
  });

  // 3. 三字码呼号 (例如 CES5213 -> Charlie Echo Sierra fife two wun tree)
  const icaoAirlineCallsignMap: Record<string, string> = {
    CES: 'China Eastern',
    CCA: 'Air China',
    CSN: 'China Southern',
    CHH: 'Hainan',
    CPA: 'Cathay',
    CXA: 'Xiamen Air',
    CSC: 'Sichuan',
    CKK: 'Cargo King',
    ANA: 'All Nippon',
    JAL: 'Japan Air',
    SKY: 'Skymark',
    ADO: 'Air Do',
    BAW: 'Speedbird',
    VIR: 'Virgin',
    EZY: 'Easy',
    DLH: 'Lufthansa',
    AFR: 'Airfrans',
    SIA: 'Singapore',
  };
  text = text.replace(/\b([A-Z]{3})\s*([0-9]{2,4})\b/g, (full, prefix, digits) => {
    const up = prefix.toUpperCase();
    if (up === 'ILS' || up === 'RWY' || up === 'HDG' || up === 'ALT' || up === 'SPD') {
      return full;
    }
    const callPrefix =
      icaoAirlineCallsignMap[up] ||
      up
        .split('')
        .map((ch: string) => ICAO_NATO_LETTER_MAP[ch] || ch)
        .join(' ');
    return `${callPrefix} ${toEnDigits(digits)}`;
  });

  // 4. 跑道编号 (例如 09L -> zero niner left, 27R -> two seven right, 34R -> tree fower right, 22 -> two two)
  text = text.replace(
    /\b(runway\s+)?(09|27|34|16|35|17|22|04)([LR])?\b/gi,
    (_, rwyWord, digits, side) => {
      const prefix = rwyWord ? 'runway ' : '';
      const sideWord =
        side?.toUpperCase() === 'L'
          ? ' left'
          : side?.toUpperCase() === 'R'
          ? ' right'
          : '';
      return `${prefix}${toEnDigits(digits)}${sideWord}`;
    }
  );

  // 5. 甚高频电台频率 (例如 125.8 -> wun two fife decimal eight, 119.75 -> wun wun niner decimal seven fife)
  text = text.replace(/\b(1[12][0-9])\.([0-9]{1,2})\b/g, (_, p1, p2) => {
    return `${toEnDigits(p1)} decimal ${toEnDigits(p2)}`;
  });

  // 6. 高度整千/整百标准读法 (例如 2000 feet -> two thousand feet, 600 meters -> six hundred meters, 2400 meters -> two thousand fower hundred meters)
  text = text.replace(
    /\b([1-9])([0-9])00\s+(feet|meters)\b/gi,
    (_, th, hu, unitWord) => {
      const thWord = ICAO_DIGIT_PHONETIC_EN[th] || th;
      if (hu === '0') {
        return `${thWord} thousand ${unitWord.toLowerCase()}`;
      }
      const huWord = ICAO_DIGIT_PHONETIC_EN[hu] || hu;
      return `${thWord} thousand ${huWord} hundred ${unitWord.toLowerCase()}`;
    }
  );
  text = text.replace(/\b([1-9])00\s+(feet|meters)\b/gi, (_, hu, unitWord) => {
    const huWord = ICAO_DIGIT_PHONETIC_EN[hu] || hu;
    return `${huWord} hundred ${unitWord.toLowerCase()}`;
  });

  // 7. 航向、速度、航班号尾号与应答机编码：凡剩余 2~4 位数字（如 270, 090, 180, 5213, 7700）一律逐位读出！
  text = text.replace(/\b([0-9]{2,4})\b/g, (_, digits) => toEnDigits(digits));

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 第一步：SenseVoice Small 空域上下文校验与同音词纠偏器
 * 【技术细节 1】：SenseVoice 并不是航空专用模型。利用当前活动航班呼号、导航台(Waypoints)和跑道信息校验识别结果，
 * 并对比数字文本规范化 (ITN) 结果。
 */
export function correctAviationHomophones(
  rawInput: string,
  airport?: AirportConfig,
  aircraftList?: Aircraft[]
): string {
  let s = (rawInput || '').trim().toUpperCase();
  if (!s) return '';

  // 1. 英文常见语音识别近音词纠偏 (SenseVoice Small 英文识别模式下常见近音偏差)
  const englishPhoneticFixes: Array<[RegExp, string]> = [
    [/\bCHINA\s+EAST(?:ERN)?\b|\bEASTERN\b|\bSPRING\s+AIR\b/g, 'CHINA EASTERN'],
    [/\bAIR\s+CHINA\b/g, 'AIR CHINA'],
    [/\bCHINA\s+SOUTH(?:ERN)?\b|\bSOUTHERN\b/g, 'CHINA SOUTHERN'],
    [/\bSPEED\s*BIRD\b|\bBRITISH\b/g, 'SPEEDBIRD'],
    [/\bALL\s+NIPPON\b|\bNIPPON\b/g, 'ALL NIPPON'],
    [/\bJAPAN\s+AIR(?:LINES)?\b/g, 'JAPAN AIR'],
    [/\bBRAVO\b/g, 'B'],
    [/\bCHARLIE\b/g, 'C'],
    [/\bNINER\b/g, '9'],
    [/\bFOWER\b/g, '4'],
    [/\bFIFE\b/g, '5'],
    [/\bTREE\b/g, '3'],
    [/\bWUN\b/g, '1'],
    [/\bAIT\b/g, '8'],
    [/\bHEAD\s+IN\b|\bHAD\s+IN\b|\bADDING\b/g, 'HEADING'],
    [/\bDE\s*SEND\b|\bTHE\s+SEND\b|\bDESCENT\b|\bSEND\s+AND\s+MAINTAIN\b/g, 'DESCEND'],
    [/\bCLIME\b|\bCLIENT\b/g, 'CLIMB'],
    [/\bCLEAR\s+TO\s+LAND\b/g, 'CLEARED TO LAND'],
    [/\bCLEAR\s+I\s*L\s*S\b|\bCLEARED\s+I\s*L\s*S\b|\bI\s+L\s+S\b/g, 'CLEARED ILS'],
    [/\bTAKE\s+OFF\b/g, 'TAKEOFF'],
    [/\bHAND\s+OFF\b/g, 'HANDOFF'],
    [/\bBAY\s*VIEW\b|\bBAY\s*V\s*W\b/g, 'BAYVW'],
    [/\bHARBOR\b|\bHARBOUR\b/g, 'HARBR'],
    [/\bKAI\s*HO\b|\bCAIRO\b/g, 'KAIHO'],
    [/\bCHEE\s*BA\b/g, 'CHIBA'],
    [/\bDO\s*MET\b|\bDOME\s*AT\b/g, 'DUMET'],
    [/\bPU\s*DONG\b/g, 'PUDNG'],
    [/\bTHAMES\b|\bTAME\b/g, 'THAME'],
    [/\bLAMB\b|\bLAMBOURNE\b/g, 'LAM'],
    [/\bBEGIN\b|\bBIGGIN\b/g, 'BIG'],
  ];
  for (const [regex, replacement] of englishPhoneticFixes) {
    s = s.replace(regex, replacement);
  }

  // 2. 中文民航高频术语同音词纠偏
  const termReplacements: Array<[RegExp, string]> = [
    [/忙讲|盲讲|盲浆|芒将|忙将/g, '盲降'],
    [/左拐|往左转|左转弯/g, '左转'],
    [/右拐|往右转|右转弯/g, '右转'],
    [/下降到|下降至|降到|降至|下到|下高到|下高度到/g, '下降至'],
    [/上升到|上升至|爬升到|爬升至|上到/g, '爬升至'],
    [/起肥|齐非|启飞|气飞/g, '起飞'],
    [/医教|移较|移接|移调/g, '移交'],
    [/减诉|减数|减速到|减速至/g, '减速'],
    [/忙降|茫降|芒降|盲将|盲匠|忙将|麻将|氓降|盲江/g, '盲降'],
    [/五编|五遍|武边|午边|无边|舞边|伍边|5边|五鞭/g, '五边'],
    [/进进|近近|静静|进境|前进跑道|进近跑道/g, '进近'],
    [/航相|行向|方向|航线|好想|好像/g, '航向'],
    [/起非|齐飞|气肥|乞飞/g, '起飞'],
    [/付飞|富飞|负飞|父飞|赴飞/g, '复飞'],
    [/一交|移焦|已交|宜交|医交/g, '移交'],
    [/区条|曲调|去调/g, '区调'],
    [/应答鸡|硬答机|应当机/g, '应答机'],
    [/左传|佐转/g, '左转'],
    [/右传|又转|幼转/g, '右转'],
    [/直非|值飞/g, '直飞'],
    [/东航|冬航|东方航空|中方航空|懂航/g, '东方'],
    [/国航|过航|果航|中国国航|中航/g, '国航'],
    [/南航|兰航|蓝航|南方航空|难航/g, '南方'],
    [/海航|还航|嗨航|海南航空/g, '海南'],
    [/厦航|下航|夏航|厦门航空/g, '厦门'],
    [/川航|穿航|四川航空/g, '四川'],
    [/国太|国泰航空/g, '国泰'],
    [/中货航|货航/g, '中货航'],
    [/全立空|全日空航空/g, '全日空'],
    [/日航|日本航空/g, '日本航空'],
    [/英航|英国航空|速鸟/g, '英国航空'],
    [/维珍航空/g, '维珍'],
    [/汉莎航空/g, '汉莎'],
    [/法航|法国航空/g, '法国航空'],
    [/新航|新加坡航空/g, '新加坡'],
  ];

  for (const [regex, replacement] of termReplacements) {
    s = s.replace(regex, replacement);
  }

  s = s.replace(/(东方|国航|南方|海南|厦门|四川|国泰|中货航|全日空|日本航空)\s*(?:是|航班号是?|航班)\s*(?=[0-9零洞幺一二两三四五六七拐八九])/g, '$1');

  // 3. 跑道“洞九左/右”、“两拐左/右”、“三四左/右”、“幺六左/右”等常见同音纠偏
  s = s
    .replace(/(?:洞|动|冻|栋|东|都|ZERO|0)\s*(?:九|酒|久|NINE|NINER|9)\s*(?:左|L|LEFT)/g, '09L')
    .replace(/(?:洞|动|冻|栋|东|都|ZERO|0)\s*(?:九|酒|久|NINE|NINER|9)\s*(?:右|又|佑|R|RIGHT)/g, '09R')
    .replace(/(?:两|二|良|梁|TWO|2)\s*(?:拐|怪|乖|七|SEVEN|7)\s*(?:左|L|LEFT)/g, '27L')
    .replace(/(?:两|二|良|梁|TWO|2)\s*(?:拐|怪|乖|七|SEVEN|7)\s*(?:右|又|佑|R|RIGHT)/g, '27R')
    .replace(/(?:三|山|THREE|TREE|3)\s*(?:四|似|FOUR|FOWER|4)\s*(?:左|L|LEFT)/g, '34L')
    .replace(/(?:三|山|THREE|TREE|3)\s*(?:四|似|FOUR|FOWER|4)\s*(?:右|又|佑|R|RIGHT)/g, '34R')
    .replace(/(?:三|山|THREE|TREE|3)\s*(?:五|武|午|FIVE|FIFE|5)\s*(?:右|又|佑|R|RIGHT)/g, '35R')
    .replace(/(?:幺|要|腰|一|ONE|WUN|1)\s*(?:六|流|陆|SIX|6)\s*(?:左|L|LEFT)/g, '16L')
    .replace(/(?:幺|要|腰|一|ONE|WUN|1)\s*(?:六|流|陆|SIX|6)\s*(?:右|又|佑|R|RIGHT)/g, '16R')
    .replace(/(?:幺|要|腰|一|ONE|WUN|1)\s*(?:拐|怪|乖|七|SEVEN|7)\s*(?:左|L|LEFT)/g, '17L');

  // 4. 利用当前机场导航台 (Waypoints) 进行模糊编辑距离吸附校验
  if (airport && airport.waypoints) {
    for (const wp of airport.waypoints) {
      const wpId = wp.id.toUpperCase();
      if (!s.includes(wpId) && wpId.length >= 4) {
        const prefix3 = wpId.slice(0, 3);
        const fuzzyWpRegex = new RegExp(`\\b${prefix3}[A-Z]{1,3}\\b`, 'g');
        if (fuzzyWpRegex.test(s)) {
          s = s.replace(fuzzyWpRegex, wpId);
        }
      }
    }
  }

  // 5. 利用当前活动航班列表校验识别结果
  if (aircraftList && aircraftList.length > 0) {
    for (const ac of aircraftList) {
      const numPart = ac.callsign.replace(/^[A-Z]{3}/, '');
      if (numPart.length >= 3 && s.includes(numPart) && !s.includes(ac.callsign)) {
        // 已包含精确航班号数字，保留供后续呼号剥离器提取
      }
    }
  }

  return s;
}

/**
 * 第二步：将中文口语数字与民航陆空通话标准读音（洞0/幺1/两2/三3/四4/五5/六6/拐7/八8/九9 及同音字）
 * 以及英文 ICAO 数字读音（ZERO/WUN/TOO/TREE/FOWER/FIFE/SIX/SEVEN/AIT/NINER）统一转换为阿拉伯数字
 */
export function normalizeChineseSpokenNumbers(
  input: string,
  airport?: AirportConfig,
  aircraftList?: Aircraft[]
): string {
  let s = correctAviationHomophones(input, airport, aircraftList);
  if (!s) return '';

  // 1. 英文 ICAO 陆空通话读数转换
  const englishDigitWords: Array<[RegExp, string]> = [
    [/\bONE\s+THOUSAND\s+TWO\s+HUNDRED\b/g, '1200'],
    [/\bONE\s+THOUSAND\s+FIVE\s+HUNDRED\b/g, '1500'],
    [/\bONE\s+THOUSAND\s+EIGHT\s+HUNDRED\b/g, '1800'],
    [/\bTWO\s+THOUSAND\s+ONE\s+HUNDRED\b/g, '2100'],
    [/\bTWO\s+THOUSAND\s+FOUR\s+HUNDRED\b/g, '2400'],
    [/\bTWO\s+THOUSAND\s+SEVEN\s+HUNDRED\b/g, '2700'],
    [/\bTWO\s+THOUSAND\b/g, '2000'],
    [/\bTHREE\s+THOUSAND\b/g, '3000'],
    [/\bFOUR\s+THOUSAND\b/g, '4000'],
    [/\bFIVE\s+THOUSAND\b/g, '5000'],
    [/\bSIX\s+THOUSAND\b/g, '6000'],
    [/\bSEVEN\s+THOUSAND\b/g, '7000'],
    [/\bEIGHT\s+THOUSAND\b/g, '8000'],
    [/\bNINE\s+THOUSAND\b/g, '9000'],
    [/\bSIX\s+HUNDRED\b/g, '600'],
    [/\bNINE\s+HUNDRED\b/g, '900'],
    [/\b(?:ZERO|OH)\b/g, '0'],
    [/\b(?:ONE|WUN)\b/g, '1'],
    [/\b(?:TWO|TOO)\b/g, '2'],
    [/\b(?:THREE|TREE)\b/g, '3'],
    [/\b(?:FOUR|FOWER)\b/g, '4'],
    [/\b(?:FIVE|FIFE)\b/g, '5'],
    [/\bSIX\b/g, '6'],
    [/\bSEVEN\b/g, '7'],
    [/\b(?:EIGHT|AIT)\b/g, '8'],
    [/\b(?:NINE|NINER)\b/g, '9'],
  ];
  for (const [regex, replacement] of englishDigitWords) {
    s = s.replace(regex, replacement);
  }
  // 合并英文单数字序列之间的空格（如 "0 9 0" -> "090"，"5 2 1 3" -> "5213"）
  s = s.replace(/\b(\d)\s+(\d)\s+(\d)\s+(\d)\b/g, '$1$2$3$4');
  s = s.replace(/\b(\d)\s+(\d)\s+(\d)\b/g, '$1$2$3');
  s = s.replace(/\b(\d)\s+(\d)\b/g, '$1$2');

  // 2. 中文民航标准高度、航向、速度整词优先替换（含“幺两百”、“两拐百”、“洞九百”、“要八洞”等）
  const phraseMap: Array<[RegExp, string]> = [
    [/两千七百|二千七百|两千七|二千七|两千拐|二千拐|两拐百|二七百|贰仟柒/g, '2700'],
    [/两千四百|二千四百|两千四|二千四|两四百|二四百|贰仟肆/g, '2400'],
    [/两千一百|二千一百|两千一|二千一|两千幺|两幺百|两要百|二一百|贰仟壹/g, '2100'],
    [/两千|二千|贰仟|两洞洞洞/g, '2000'],
    [/一千八百|一千八|幺八百|要八百|腰八百|一八百|18百/g, '1800'],
    [/一千五百|一千五|幺五百|要五百|腰五百|一五百|15百/g, '1500'],
    [/一千二百|一千两百|一千二|一千两|幺二百|幺两百|要两百|要二百|腰两百|一二百|一两百|12百/g, '1200'],
    [/三千/g, '3000'],
    [/四千/g, '4000'],
    [/五千/g, '5000'],
    [/六千/g, '6000'],
    [/七千|拐千/g, '7000'],
    [/八千/g, '8000'],
    [/九千/g, '9000'],
    [/洞九百|动九百|冻九百|零九百|九百|酒百|玖佰|9百/g, '900'],
    [/洞六百|动六百|冻六百|零六百|六百|流百|陆佰|6百/g, '600'],
    [/三百六十|三百六|三六零|三六洞|三六动|36洞/g, '360'],
    [/三百三十|三百三|三三零|三三洞|三三动/g, '330'],
    [/三百|叁佰|三洞洞|三动动/g, '300'],
    [/两百七十|二百七十|两百七|二百七|两百拐|两拐洞|两怪洞|两拐动|二七零|27洞/g, '270'],
    [/两百五十|二百五十|两百五|二百五|两五洞|两五动|二五零|二五洞/g, '250'],
    [/两百四十|二百四十|两百四|二百四|两四洞|两四动|二四零|二四洞/g, '240'],
    [/两百二十|二百二十|两百二|二百二|两两洞|两两动|二二零|二二洞/g, '220'],
    [/两百一十|二百一十|两百一|二百一|两幺洞|两要洞|二一零/g, '210'],
    [/二百|两百|二零零|二洞洞|两洞洞|两动动/g, '200'],
    [/一百九十|一百九|幺九洞|要九洞|一九零/g, '190'],
    [/一百八十|一百八|一八零|幺八洞|幺八动|要八洞|要八动|腰八洞|18洞|18动/g, '180'],
    [/一百七十|一百七|幺拐洞|要拐洞|一七零/g, '170'],
    [/一百六十|一百六|一六零|幺六洞|幺六动|要六洞|要六动|16洞|16动/g, '160'],
    [/一百五十|一百五|一五零|幺五洞|幺五动|要五洞/g, '150'],
    [/一百四十|一百四|一四零|幺四洞/g, '140'],
    [/一百二十|一百二|一二零|幺两洞|要两洞/g, '120'],
    [/九十度|九十|洞九洞|动九洞|冻九洞|东九洞|东九动|09洞|09动/g, '090'],
    [/六十度|洞六洞|动六洞|06洞/g, '060'],
    [/三十度|洞三洞|动三洞|03洞/g, '030'],
  ];

  for (const [regex, replacement] of phraseMap) {
    const numeric = '[0-9零〇洞动冻栋一幺要腰二两三四五六七拐八九十百千万]';
    s = s.replace(new RegExp(`(?<!${numeric})(?:${regex.source})(?!${numeric})`, 'g'), replacement);
  }

  // Convert unambiguous cardinal numbers (including ASR 百/白 confusions) without touching airline names.
  s = s.replace(/([零〇一二两三四五六七八九幺洞0-9])(?:白|佰)/g, '$1百');
  s = s.replace(/[0-9零〇一幺洞二两三四五六七八九十百千万]+/g, (word) => {
    if (!/[十百千万]/.test(word)) return word;
    const values: Record<string, number> = { 零: 0, 〇: 0, 洞: 0, 幺: 1, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    let total = 0, digit = 0, lastUnit = 1;
    for (const ch of word) {
      if (ch in values || /[0-9]/.test(ch)) digit = values[ch] ?? Number(ch);
      else { lastUnit = units[ch]; total += (digit || 1) * lastUnit; digit = 0; }
    }
    // Colloquial 一千六 / 两千三 means 1600 / 2300; an explicit 零 cancels that shorthand.
    if (digit && lastUnit >= 100 && !/[零〇洞0]/.test(word.slice(-2))) digit *= lastUnit / 10;
    return String(total + digit);
  });

  // 3. 民航陆空通话单字读音（含同音字：洞/动/冻=0, 幺/要/腰/妖=1, 两/良/梁=2, 拐/怪/乖=7, 酒=9, 流=6）
  const strictDigitMap: Record<string, string> = {
    零: '0',
    洞: '0',
    动: '0',
    冻: '0',
    栋: '0',
    〇: '0',
    一: '1',
    幺: '1',
    要: '1',
    腰: '1',
    妖: '1',
    邀: '1',
    壹: '1',
    二: '2',
    两: '2',
    良: '2',
    梁: '2',
    量: '2',
    贰: '2',
    三: '3',
    散: '3',
    伞: '3',
    是: '4',
    事: '4',
    吧: '8',
    叁: '3',
    山: '3',
    四: '4',
    肆: '4',
    五: '5',
    伍: '5',
    武: '5',
    午: '5',
    六: '6',
    陆: '6',
    流: '6',
    刘: '6',
    七: '7',
    拐: '7',
    怪: '7',
    乖: '7',
    柒: '7',
    八: '8',
    捌: '8',
    巴: '8',
    九: '9',
    玖: '9',
    酒: '9',
    久: '9',
  };

  s = s.replace(
    /[0-9零洞动冻栋〇一幺要腰妖邀壹二两良梁量贰三叁山散伞是事四肆五伍武午六陆流刘七拐怪乖柒八捌巴吧九玖酒久]{2,6}/g,
    (match, offset, whole) => {
      const modal = match.endsWith('要') && /^(盲降|进近|起飞|转|下降|爬升|移交)/.test(whole.slice(offset + match.length));
      const digits = modal ? match.slice(0, -1) : match;
      return digits.split('').map((ch: string) => strictDigitMap[ch] ?? ch).join('') + (modal ? '要' : '');
    }
  );

  s = s.replace(
    /(高度|上|下|升|降|保持|航向|跑道)\s*([零洞一幺二两三四五六七拐八九])/g,
    (_, prefix, d) => `${prefix}${strictDigitMap[d] ?? d}`
  );

  return s;
}

const AIRLINE_ALIASES: Record<string, string[]> = {
  CES: ['东方', '东航', 'CHINA EASTERN', 'EASTERN'],
  CCA: ['国航', '中国国航', 'AIR CHINA'],
  CSN: ['南方', '南航', 'CHINA SOUTHERN', 'SOUTHERN'],
  CHH: ['海南', '海航', 'HAINAN'],
  CPA: ['国泰', 'CATHAY'],
  CXA: ['厦门', '厦航', 'XIAMEN'],
  CSC: ['四川', '川航', 'SICHUAN'],
  CKK: ['中货航', '货航', 'CARGO KING', 'CARGO'],
  ANA: ['全日空', 'ALL NIPPON', 'NIPPON', 'ANA'],
  JAL: ['日本航空', '日航', 'JAPAN AIR', 'JAL'],
  SKY: ['天马', 'SKYMARK'],
  ADO: ['北海道', 'AIR DO'],
  BAW: ['英国航空', '英航', 'SPEEDBIRD'],
  VIR: ['维珍', 'VIRGIN'],
  EZY: ['易捷', 'EASY'],
  DLH: ['汉莎', 'LUFTHANSA'],
  AFR: ['法国航空', '法航', 'AIRFRANS'],
  SIA: ['新加坡', '新航', 'SINGAPORE'],
};

function scoreCallsignDigitsSimilarity(spokenDigits: string, actualDigits: string): number {
  if (!spokenDigits || !actualDigits) return 0;
  if (spokenDigits === actualDigits) return 100;
  if (actualDigits.endsWith(spokenDigits) && spokenDigits.length >= 2) return 85;
  if (actualDigits.startsWith(spokenDigits) && spokenDigits.length >= 2) return 80;

  if (spokenDigits.length === actualDigits.length) {
    let matches = 0;
    for (let i = 0; i < spokenDigits.length; i++) {
      if (spokenDigits[i] === actualDigits[i]) matches++;
    }
    if (spokenDigits.length >= 3 && matches >= spokenDigits.length - 1) {
      return 75;
    }
  }

  return 0;
}

export interface AircraftSpeechMatch {
  aircraft: Aircraft | null;
  textWithoutCallsign: string;
  candidateAircraftIds: string[];
  matchMode?: 'EXACT' | 'CORRECTED' | 'SELECTED' | 'CONTEXT';
  correctionNote?: string;
}
function suitableForIntent(ac: Aircraft, text: string): boolean {
  if (/起飞|放行|TAKE\s*OFF|CTO/.test(text) && !/等待起飞/.test(text)) {
    return ac.phase === 'HOLDING_GROUND' || ac.phase === 'LINE_UP_WAIT';
  }
  if (/移交|区调|HANDOFF|CONTACT\s*CENTER/.test(text)) return ac.category === 'DEPARTURE' && ac.canHandoff;
  if (/穿越|CROSS\s*RUNWAY/.test(text)) return ac.phase === 'HOLD_CROSSING';
  if (/盲降|五边|进近|降落|落地|复飞|ILS|APPROACH|GO\s*AROUND/.test(text)) return ac.category === 'ARRIVAL';
  return true;
}

export function matchAircraftAndStripCallsign(
  normalizedText: string,
  aircraftList: Aircraft[],
  selectedAircraftId: string | null,
  assistEnabled: boolean = true
): AircraftSpeechMatch {
  const active = aircraftList.filter((ac) => !['LANDED', 'HANDED_OFF', 'EXITED_AIRSPACE'].includes(ac.phase));
  const noMatch = (candidates: Aircraft[] = []): AircraftSpeechMatch => ({ aircraft: null,
    textWithoutCallsign: normalizedText, candidateAircraftIds: candidates.map((ac) => ac.id) });
  const resolve = (ac: Aircraft, token: string, mode: AircraftSpeechMatch['matchMode']): AircraftSpeechMatch => ({
    aircraft: ac, textWithoutCallsign: token ? normalizedText.replace(token, ' ') : normalizedText,
    candidateAircraftIds: [], matchMode: mode,
    correctionNote: mode === 'CORRECTED' ? `呼号纠错：${token} → ${ac.callsign}`
      : mode === 'CONTEXT' ? `根据运行态势匹配：${ac.callsign}`
      : mode === 'SELECTED' ? `使用已选航班：${ac.callsign}` : undefined,
  });
  const explicit = (normalizedText.match(/\b[A-Z]{3}\s*\d{2,4}(?!\d)/g) || []).filter((token) => !/^(HDG|ALT|SPD|RWY|SQK)/.test(token));
  if (explicit.length) {
    const matches = active.filter((ac) => explicit.some((token) => token.replace(/\s/g, '') === ac.callsign));
    if (matches.length === 1 && explicit.length === 1) return resolve(matches[0], explicit[0], 'EXACT');
    // An explicit unknown/wrong flight must never fall back to the first or selected aircraft.
    return noMatch(matches);
  }
  let airline: string | null = null, token = '', digits = '';
  for (const [prefix, aliases] of Object.entries(AIRLINE_ALIASES)) {
    for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
      const match = normalizedText.match(new RegExp(`${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\d{2,4})?(?!\\d)`));
      if (match) {
        if (!match[1] && /^\s*\d/.test(normalizedText.slice((match.index || 0) + match[0].length))) return noMatch();
        airline = prefix; token = match[0]; digits = match[1] || ''; break;
      }
    }
    if (airline) break;
  }
  if (!airline) {
    if (/(?:航空|[\u3400-\u9fff]{1,3}航)\s*\d{2,4}/.test(normalizedText)) return noMatch();
    const numeric = normalizedText.match(/^\s*(?:航班|呼叫)?\s*(\d{2,4})(?!\d)/);
    if (numeric && !/^\s*(?:米|英尺|METERS\b|FEET\b|FT\b|M\b|节|KNOTS\b|KT\b)/.test(normalizedText.slice(numeric[0].length))) {
      digits = numeric[1]; token = numeric[0];
    }
  }
  const pool = airline ? active.filter((ac) => ac.callsign.startsWith(airline!)) : active;
  if (token) {
    const remainder = normalizedText.replace(token, ' ');
    if (Object.values(AIRLINE_ALIASES).flat().some((alias) =>
      new RegExp(`${alias}\\s*\\d{2,4}`).test(remainder))) return noMatch();
  }
  if (digits) {
    const scored = pool.map((ac) => ({ ac, score: scoreCallsignDigitsSimilarity(digits, ac.callsign.slice(3)) }))
      .filter(({ ac, score }) => score === 100 || (assistEnabled && score >= 75 &&
        (Boolean(airline) || ac.id === selectedAircraftId || (digits.length >= 3 && suitableForIntent(ac, normalizedText)))));
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return noMatch();
    const tied = scored.filter((item) => item.score === scored[0].score);
    if (tied.length > 1) return noMatch(tied.map((item) => item.ac));
    const best = scored[0];
    return resolve(best.ac, token, best.score === 100 ? 'EXACT' : 'CORRECTED');
  }
  const eligible = pool.filter((ac) => suitableForIntent(ac, normalizedText));
  const selected = eligible.find((ac) => ac.id === selectedAircraftId);
  if (selected) return resolve(selected, token, 'SELECTED');
  if (assistEnabled && eligible.length === 1) return resolve(eligible[0], token, airline ? 'EXACT' : 'CONTEXT');
  return noMatch(eligible);
}

export function matchAircraftFromSpeech(
  normalizedText: string,
  aircraftList: Aircraft[],
  selectedAircraftId: string | null
): Aircraft | null {
  return matchAircraftAndStripCallsign(normalizedText, aircraftList, selectedAircraftId).aircraft;
}

function extractRunwayFromSpeech(text: string, airport: AirportConfig): RunwayId | null {
  const validRunways = Object.keys(airport.runways) as RunwayId[];

  const rwyNormalized = text
    .replace(/([0-9]{1,2})\s*(?:号)?(?:跑道)?\s*(?:LEFT|左)/g, '$1L')
    .replace(/([0-9]{1,2})\s*(?:号)?(?:跑道)?\s*(?:RIGHT|右|又)/g, '$1R')
    .replace(/(?:跑道|RUNWAY|RWY)\s*([0-9]{1,2})\s*(?:LEFT|左)/g, '$1L')
    .replace(/(?:跑道|RUNWAY|RWY)\s*([0-9]{1,2})\s*(?:RIGHT|右|又)/g, '$1R');

  for (const rwyId of validRunways) {
    if (new RegExp(`(?:^|[^0-9A-Z])${rwyId}(?![0-9A-Z])`).test(rwyNormalized)) {
      return rwyId;
    }
    if (rwyId.startsWith('0')) {
      const shortId = rwyId.slice(1);
      const regex = new RegExp(`(?:^|[^0-9A-Z])${shortId}(?![0-9A-Z])`);
      if (regex.test(rwyNormalized)) {
        return rwyId;
      }
    }
  }

  if (text.includes('北跑道') && airport.runways['09L']) return '09L';
  if (text.includes('南跑道') && airport.runways['09R']) return '09R';
  return null;
}

/**
 * 【第三阶段：航空通话规范化引擎 · Standard Phraseology Synthesizer】
 * 将口语提取出的指令合成为面向本游戏的航空通话格式；不是完整 ICAO 规范符合性认证。
 * 使得玩家哪怕只说“5213下600盲降”，在底部陆空通话日志中也会完整呈现出专业管制员的标准指令用语。
 */
export function buildStandardAtcPhraseology(
  ac: Aircraft,
  commands: ATCCommand[],
  altitudeUnit: AltitudeUnit = 'METRIC'
): { phraseCn: string; phraseEn: string; kokoroPhoneticEn: string } {
  const radioCallEn = getRadioCallsign(ac);
  const radioCallCn = `${ac.airlineCn} ${ac.callsign.slice(3)}`;
  const cnParts: string[] = [];
  const enParts: string[] = [];

  for (const cmd of commands) {
    if (cmd.type === 'HDG' && typeof cmd.heading === 'number') {
      const hdgStr = formatHeading(cmd.heading === 0 ? 360 : cmd.heading);
      const turnCn =
        cmd.turnDirection === 'LEFT' ? '左转' : cmd.turnDirection === 'RIGHT' ? '右转' : '飞';
      const turnEn =
        cmd.turnDirection === 'LEFT'
          ? 'TURN LEFT'
          : cmd.turnDirection === 'RIGHT'
          ? 'TURN RIGHT'
          : 'FLY';
      cnParts.push(`${turnCn}航向 ${hdgStr}`);
      enParts.push(`${turnEn} HEADING ${hdgStr}`);
    } else if (cmd.type === 'ALT' && typeof cmd.altitude === 'number') {
      const isClimb = cmd.altitude >= ac.altitude;
      cnParts.push(
        `${isClimb ? '上升并保持' : '下降并保持'} ${formatAltitudeSpeechCn(cmd.altitude, altitudeUnit)}`
      );
      enParts.push(
        `${isClimb ? 'CLIMB AND MAINTAIN' : 'DESCEND AND MAINTAIN'} ${formatAltitudeSpeechEn(
          cmd.altitude,
          altitudeUnit
        )}`
      );
    } else if (cmd.type === 'SPD' && typeof cmd.speed === 'number') {
      const isSlow = cmd.speed <= ac.speed;
      cnParts.push(`${isSlow ? '减速至' : '加速至'} ${cmd.speed} 节`);
      enParts.push(`${isSlow ? 'REDUCE SPEED TO' : 'INCREASE SPEED TO'} ${cmd.speed} KNOTS`);
    } else if (cmd.type === 'CLEARED_ILS') {
      const rwy = cmd.runwayId || ac.assignedRunway;
      cnParts.push(`可以执行跑道 ${rwy} ILS 盲降进近`);
      enParts.push(`CLEARED ILS RUNWAY ${rwy} APPROACH`);
    } else if (cmd.type === 'CLEARED_LAND') {
      const rwy = cmd.runwayId || ac.assignedRunway;
      cnParts.push(`跑道 ${rwy}，可以着陆`);
      enParts.push(`RUNWAY ${rwy}, CLEARED TO LAND`);
    } else if (cmd.type === 'VECTOR_TO_FINAL') {
      const rwy = cmd.runwayId || ac.assignedRunway;
      cnParts.push(`雷达引导切入跑道 ${rwy} 五边盲降进近`);
      enParts.push(`RADAR VECTORS FOR ILS RUNWAY ${rwy} APPROACH`);
    } else if (cmd.type === 'CLEARED_TAKEOFF') {
      const rwy = cmd.runwayId || ac.assignedRunway;
      cnParts.push(`跑道 ${rwy}，可以起飞`);
      enParts.push(`RUNWAY ${rwy}, CLEARED FOR TAKEOFF`);
    } else if (cmd.type === 'LINE_UP_WAIT') {
      const rwy = cmd.runwayId || ac.assignedRunway;
      cnParts.push(`跑道 ${rwy}，进跑道对正等待`);
      enParts.push(`RUNWAY ${rwy}, LINE UP AND WAIT`);
    } else if (cmd.type === 'HANDOFF') {
      cnParts.push('雷达服务终止，请联系区域管制 125.8，再见');
      enParts.push('RADAR SERVICE TERMINATED, CONTACT CENTER ON 125.8, GOOD DAY');
    } else if (cmd.type === 'GO_AROUND') {
      cnParts.push('立即复飞，保持跑道航向爬升');
      enParts.push('GO AROUND, FLY RUNWAY HEADING AND CLIMB');
    } else if (cmd.type === 'DCT' && cmd.waypointId) {
      cnParts.push(`直飞航路点 ${cmd.waypointId}`);
      enParts.push(`PROCEED DIRECT ${cmd.waypointId}`);
    } else if (cmd.type === 'HOLD') {
      cnParts.push(`在 ${cmd.waypointId || '当前位置'} 建立标准右转等待航线`);
      enParts.push(`HOLD AT ${cmd.waypointId || 'PRESENT POSITION'} AS PUBLISHED`);
    } else if ((cmd.type === 'STAR' || cmd.type === 'SID') && cmd.procedureId) {
      cnParts.push(`准许按 ${cmd.procedureId} 标准程序飞行`);
      enParts.push(`CLEARED ${cmd.procedureId} ${cmd.type}`);
    } else if (cmd.type === 'ASSIGN_RUNWAY' && cmd.runwayId) {
      cnParts.push(`预计使用跑道 ${cmd.runwayId}`);
      enParts.push(`EXPECT RUNWAY ${cmd.runwayId}`);
    } else if (cmd.type === 'CROSS_RUNWAY') {
      cnParts.push(`可以穿越跑道 ${ac.crossingRunwayId || ''}`);
      enParts.push(`CROSS RUNWAY ${ac.crossingRunwayId || ''}`);
    } else if (cmd.type === 'BREAK_OUT') {
      cnParts.push('五边告警，立即紧急转向脱离');
      enParts.push('TRAFFIC ALERT, BREAK OUT IMMEDIATELY');
    } else if (cmd.type === 'SQUAWK_IDENT') {
      cnParts.push(`应答机 ${ac.squawkCode} 请按识别键 IDENT`);
      enParts.push(`SQUAWK ${ac.squawkCode} AND IDENT`);
    }
  }

  const phraseCn =
    cnParts.length > 0 ? `${radioCallCn}，${cnParts.join('，')}。` : `${radioCallCn}，请重复。`;
  const phraseEn =
    enParts.length > 0 ? `${radioCallEn}, ${enParts.join(', ')}.` : `${radioCallEn}, SAY AGAIN.`;

  return {
    phraseCn,
    phraseEn,
    kokoroPhoneticEn: formatKokoroAviationPhonetics(phraseEn, 'EN'),
  };
}

/**
 * 民航陆空通话语义解析器 & 航空通话规范化引擎 V9.0 (SenseVoice Small + Kokoro TTS 专用架构)
 * 流程：
 * 玩家按 Shift 说话 -> SenseVoice Small 音频转文本 -> 航空通话规范化引擎（模糊识别关键指令与航班号 + 生成专业标准通话文本）
 * -> 游戏执行指令并生成标准飞行员复诵 -> Kokoro TTS + 无线电音效播报
 */
export function parseFuzzyVoiceTranscript(
  rawTranscript: string,
  aircraftList: Aircraft[],
  selectedAircraftId: string | null,
  airport: AirportConfig,
  activeRunwayDir: RunwayDirectionConfig = '09',
  runwayCountMode: RunwayCountMode = 'DUAL',
  altitudeUnit: AltitudeUnit = 'METRIC',
  assistEnabled: boolean = true
): FuzzyVoiceParseResult {
  const cleanedRaw = (rawTranscript || '').trim();
  if (!cleanedRaw) {
    return {
      matchedAircraftId: null,
      matchedCallsign: null,
      commands: [],
      summaryCn: '未检测到语音内容',
      rawTranscript: '',
      normalizedPreviewCn: '',
    };
  }

  const normalizedFull = normalizeChineseSpokenNumbers(cleanedRaw, airport, aircraftList);
  const match = matchAircraftAndStripCallsign(normalizedFull, aircraftList, selectedAircraftId, assistEnabled);
  const { aircraft: targetAc, textWithoutCallsign: initialClauseText } = match;

  if (!targetAc) {
    return {
      matchedAircraftId: null,
      matchedCallsign: null,
      commands: [],
      summaryCn: match.candidateAircraftIds.length > 0 ? '有多个可能的航班，请先点击目标航班，再说指令' : '没有匹配到呼号，请先选择航班，或说完整航班号',
      candidateAircraftIds: match.candidateAircraftIds,
      rawTranscript: cleanedRaw,
      normalizedPreviewCn: normalizedFull,
    };
  }

  const invalidNumber = /(?:航向|左转|右转|HEADING|HDG)\s*(\d{1,4})/.exec(initialClauseText);
  if (/不(?:要|准|能|可以|用|需要)|别|禁止|取消|NOT\s+CLEARED|DO\s+NOT|CANCEL|ABORT\s+TAKEOFF/.test(initialClauseText) ||
      (invalidNumber && Number(invalidNumber[1]) > 360)) {
    return { matchedAircraftId: targetAc.id, matchedCallsign: targetAc.callsign, commands: [],
      summaryCn: '指令含否定或无效数值，未执行。请说一个明确的正向指令',
      rawTranscript: cleanedRaw, normalizedPreviewCn: normalizedFull };
  }

  // 先尝试标准简令精确解析
  const directCli = parseTextCommand(cleanedRaw);
  if (directCli) {
    const std = buildStandardAtcPhraseology(targetAc, [directCli], altitudeUnit);
    return {
      correctionNote: match.correctionNote, matchMode: match.matchMode,
      matchedAircraftId: targetAc.id,
      matchedCallsign: targetAc.callsign,
      commands: [directCli],
      summaryCn: `${targetAc.callsign} 执行 ${directCli.type}`,
      rawTranscript: cleanedRaw,
      normalizedPreviewCn: normalizedFull,
      standardAtcPhraseCn: std.phraseCn,
      standardAtcPhraseEn: std.phraseEn,
      kokoroPhoneticText: std.kokoroPhoneticEn,
    };
  }

  let clauseText = initialClauseText;
  const commands: ATCCommand[] = [];
  const summaryParts: string[] = [];

  // 1. 提取跑道号并消费跑道文本
  const mentionedRwy = extractRunwayFromSpeech(clauseText, airport);
  const activeFlow = getActiveRunwaysForDirection(activeRunwayDir, runwayCountMode, airport);
  const explicitRunway = /(?:跑道|RUNWAY|RWY)\s*\d{1,2}|\d{2}\s*(?:[LR]\b|左|右)/.test(clauseText);
  if (explicitRunway && !mentionedRwy) return { matchedAircraftId: targetAc.id, matchedCallsign: targetAc.callsign,
    commands: [], summaryCn: '跑道不明确或不属于本机场，请说完整跑道编号和左右',
    rawTranscript: cleanedRaw, normalizedPreviewCn: normalizedFull };

  if (
    mentionedRwy &&
    (clauseText.includes('分配') ||
      clauseText.includes('改') ||
      clauseText.includes('换') ||
      clauseText.includes('使用') ||
      clauseText.includes('EXPECT') ||
      clauseText.includes('CHANGE'))
  ) {
    commands.push({ type: 'ASSIGN_RUNWAY', runwayId: mentionedRwy });
    summaryParts.push(`分配跑道 ${mentionedRwy}`);
  } else if (!mentionedRwy && (clauseText.includes('换跑道') || clauseText.includes('另一条跑道'))) {
    const otherRwy =
      activeFlow.allActive.find((r) => r !== targetAc.assignedRunway) || targetAc.assignedRunway;
    commands.push({ type: 'ASSIGN_RUNWAY', runwayId: otherRwy });
    summaryParts.push(`切换跑道 ${otherRwy}`);
  }

  // 2. 识别起飞 与 进跑道等待
  if (/起飞|放行|可以飞|准许起飞|TAKE\s*OFF|CLEARED\s*FOR\s*TAKEOFF|CTO/.test(clauseText) && !/等待起飞|起飞等待|HOLD\s*SHORT/.test(clauseText)) {
    commands.push({
      type: 'CLEARED_TAKEOFF',
      runwayId: mentionedRwy || targetAc.assignedRunway,
    });
    summaryParts.push(`准许起飞 ${mentionedRwy || targetAc.assignedRunway}`);
  } else if (/进跑道|对正等待|跑道等待|跑道内等待|LINE\s*UP|LUAW/.test(clauseText)) {
    commands.push({
      type: 'LINE_UP_WAIT',
      runwayId: mentionedRwy || targetAc.assignedRunway,
    });
    summaryParts.push(`进跑道等待 ${mentionedRwy || targetAc.assignedRunway}`);
  }

  // 3. 识别复飞 (GO AROUND)、紧急脱离 (BREAK OUT)、穿越跑道 (CROSS RUNWAY)、移交 (HANDOFF)
  if (/复飞|拉起|终止进近|GO\s*AROUND|ABORT\s*LANDING/.test(clauseText)) {
    commands.push({ type: 'GO_AROUND' });
    summaryParts.push('立即复飞');
  } else if (/紧急脱离|脱离五边|避让脱离|BREAK\s*OUT/.test(clauseText)) {
    commands.push({ type: 'BREAK_OUT' });
    summaryParts.push('紧急脱离');
  }

  if (/穿越|穿过跑道|CROSS\s*RUNWAY/.test(clauseText)) {
    commands.push({ type: 'CROSS_RUNWAY' });
    summaryParts.push('准许穿越跑道');
  }

  if (/移交|区调|联系中心|再见|转频|HAND\s*OFF|CONTACT\s*CENTER|GOOD\s*DAY/.test(clauseText)) {
    commands.push({ type: 'HANDOFF' });
    summaryParts.push('移交区域管制');
  }

  // 4. 识别【航向 HDG】子句并消费该子句
  const hdgClauseMatch =
    clauseText.match(
      /(?:(左转|右转|向左|向右|左|右|TURN\s*LEFT|TURN\s*RIGHT|LEFT|RIGHT))?\s*(?:航向|方向|转向|飞向|调向|HEADING|HDG)\s*([0-9]{1,3})\s*(?:度)?/
    ) ||
    clauseText.match(
      /(左转|右转|向左转|向右转|TURN\s*LEFT|TURN\s*RIGHT)\s*(?:航向|飞向|HEADING|HDG)?\s*([0-9]{2,3})\s*(?:度)?/
    ) ||
    clauseText.match(/(?:^|\s|，|,)(0[1-9][0-9])(?:\s|度|，|,|$)/);

  if (hdgClauseMatch) {
    const isZeroPrefixedBare = hdgClauseMatch.length === 2;
    const dirRaw = isZeroPrefixedBare ? '' : hdgClauseMatch[1] || '';
    const hdgVal = Number(isZeroPrefixedBare ? hdgClauseMatch[1] : hdgClauseMatch[2]);
    if (hdgVal >= 0 && hdgVal <= 360) {
      const turnDirection =
        dirRaw.includes('左') || dirRaw.includes('LEFT')
          ? 'LEFT'
          : dirRaw.includes('右') || dirRaw.includes('RIGHT')
          ? 'RIGHT'
          : 'AUTO';
      commands.push({ type: 'HDG', heading: hdgVal, turnDirection });
      const dirCn = turnDirection === 'LEFT' ? '左转' : turnDirection === 'RIGHT' ? '右转' : '';
      summaryParts.push(`${dirCn}航向 ${String(hdgVal).padStart(3, '0')}°`);
      clauseText = clauseText.replace(hdgClauseMatch[0], ' ');
    }
  } else if (/(?:左转|向左转|TURN\s*LEFT)/.test(clauseText) && !clauseText.includes('五边')) {
    const newHdg = normalizeHeading(Math.round(targetAc.targetHeading - 30));
    commands.push({ type: 'HDG', heading: newHdg, turnDirection: 'LEFT' });
    summaryParts.push(`左转航向 ${String(newHdg).padStart(3, '0')}°`);
    clauseText = clauseText.replace(/(?:左转|向左转|TURN\s*LEFT)/, ' ');
  } else if (/(?:右转|向右转|TURN\s*RIGHT)/.test(clauseText) && !clauseText.includes('五边')) {
    const newHdg = normalizeHeading(Math.round(targetAc.targetHeading + 30));
    commands.push({ type: 'HDG', heading: newHdg, turnDirection: 'RIGHT' });
    summaryParts.push(`右转航向 ${String(newHdg).padStart(3, '0')}°`);
    clauseText = clauseText.replace(/(?:右转|向右转|TURN\s*RIGHT)/, ' ');
  }

  // 5. 识别【速度 SPD】子句并消费该子句
  const spdClauseMatch =
    clauseText.match(
      /(?:速度|表速|空速|减速|加速|调速|保持速度|SPEED|SPD|REDUCE|INCREASE)\s*(?:SPEED\s*)?(?:到|至|保持|TO|AT)?\s*([0-9]+)\s*(?:节|KT|KNOTS)?/
    ) || clauseText.match(/([0-9]+)\s*(?:节|KT|KNOTS)/);

  if (spdClauseMatch) {
    const spdVal = Number(spdClauseMatch[1]);
    if (spdVal < 100 || spdVal > 350) return { matchedAircraftId: targetAc.id, matchedCallsign: targetAc.callsign,
      commands: [], summaryCn: '速度数值不明确，请重说，例如“减速一百八十节”', rawTranscript: cleanedRaw, normalizedPreviewCn: normalizedFull };
    commands.push({ type: 'SPD', speed: spdVal });
    summaryParts.push(`速度 ${spdVal}kt`);
    clauseText = clauseText.replace(spdClauseMatch[0], ' ');
  } else if (/(?:减速|慢一点|SLOW\s*DOWN|REDUCE\s*SPEED)/.test(clauseText)) {
    const nextSpd = Math.max(150, Math.round((targetAc.targetSpeed - 20) / 10) * 10);
    commands.push({ type: 'SPD', speed: nextSpd });
    summaryParts.push(`减速至 ${nextSpd}kt`);
  } else if (/(?:加速|快一点|SPEED\s*UP|INCREASE\s*SPEED)/.test(clauseText)) {
    const nextSpd = Math.min(250, Math.round((targetAc.targetSpeed + 20) / 10) * 10);
    commands.push({ type: 'SPD', speed: nextSpd });
    summaryParts.push(`加速至 ${nextSpd}kt`);
  }

  // 6. 识别【高度层 ALT】子句
  const metricAltMap: Record<number, number> = {
    6: 2000,
    9: 3000,
    12: 4000,
    15: 5000,
    18: 6000,
    21: 7000,
    24: 8000,
    27: 9000,
    600: 2000,
    900: 3000,
    1200: 4000,
    1500: 5000,
    1800: 6000,
    2100: 7000,
    2400: 8000,
    2700: 9000,
    2000: 2000,
    3000: 3000,
    4000: 4000,
    5000: 5000,
    6000: 6000,
    7000: 7000,
    8000: 8000,
    9000: 9000,
  };

  const altExplicitMatch = clauseText.match(
    /(?:高度|上高度|下高度|上升|下降|爬升|上|下|升|降|保持|CLIMB|DESCEND|MAINTAIN|ALTITUDE|ALT)\s*(?:AND\s+MAINTAIN|TO|高度|到|至|保持|并保持)?\s*([0-9]{1,5})(?![0-9])\s*(米|英尺|METERS?\b|FEET\b|FT\b|M\b)?/
  );
  const altStandaloneMatch = clauseText.match(/(?:^|\s|，|,)([0-9]{3,5})\s*(米|英尺|METERS?\b|FEET\b|FT\b|M\b)/);
  if (altExplicitMatch || altStandaloneMatch) {
    const found = (altExplicitMatch || altStandaloneMatch)!;
    const rawNum = Number(found[1]), units = found[2] || '';
    const explicitMetric = /^(米|M|METERS?)$/.test(units), explicitFeet = /^(英尺|FT|FEET)$/.test(units);
    const chineseMetric = !explicitFeet && !/CLIMB|DESCEND|MAINTAIN|ALTITUDE|ALT/.test(found[0]) && altitudeUnit === 'METRIC';
    const shorthand = rawNum <= 30 && metricAltMap[rawNum] && !explicitFeet;
    const targetFt = shorthand ? metricAltMap[rawNum]
      : explicitMetric || chineseMetric ? Math.round(rawNum / 0.3 / 100) * 100 : rawNum;
    if (targetFt < 1500 || targetFt > 12000) return { matchedAircraftId: targetAc.id, matchedCallsign: targetAc.callsign,
      commands: [], summaryCn: '高度数值不明确，请重说，例如“下降六百米”', rawTranscript: cleanedRaw, normalizedPreviewCn: normalizedFull };
    commands.push({ type: 'ALT', altitude: targetFt });
    summaryParts.push(`高度 ${Math.round(targetFt * 0.3)}m`);
  } else if (/(?:下降|下高|降高|往下降|DESCEND)/.test(clauseText) && !/盲降|降落/.test(clauseText)) {
    const nextFt = Math.max(2000, Math.round((targetAc.targetAltitude - 1000) / 1000) * 1000);
    commands.push({ type: 'ALT', altitude: nextFt });
    summaryParts.push(`下降高度至 ${Math.round((nextFt / 1000) * 300)}m`);
  } else if (/(?:上升|爬升|升至|往上爬|CLIMB)/.test(clauseText)) {
    const nextFt = Math.min(9000, Math.round((targetAc.targetAltitude + 1000) / 1000) * 1000);
    commands.push({ type: 'ALT', altitude: nextFt });
    summaryParts.push(`爬升高度至 ${Math.round((nextFt / 1000) * 300)}m`);
  }

  // 7. 识别标准进离场程序 (STAR / SID) 与 直飞航路点 (DCT)
  for (const proc of airport.procedures) {
    const cleanId = proc.id.replace('-', '');
    if (clauseText.includes(proc.id) || clauseText.includes(cleanId)) {
      commands.push({ type: proc.type, procedureId: proc.id });
      summaryParts.push(`${proc.type} ${proc.id}`);
      break;
    }
  }

  if (!commands.some((c) => c.type === 'STAR' || c.type === 'SID')) {
    if (/北进场|北侧进场|NORTH\s*ARRIVAL/.test(clauseText)) {
      const northStar = airport.procedures.find(
        (p) => p.type === 'STAR' && p.runwayConfig === activeRunwayDir
      );
      if (northStar) {
        commands.push({ type: 'STAR', procedureId: northStar.id });
        summaryParts.push(`STAR ${northStar.id}`);
      }
    } else if (/南进场|南侧进场|SOUTH\s*ARRIVAL/.test(clauseText)) {
      const stars = airport.procedures.filter(
        (p) => p.type === 'STAR' && p.runwayConfig === activeRunwayDir
      );
      const southStar = stars[1] || stars[0];
      if (southStar) {
        commands.push({ type: 'STAR', procedureId: southStar.id });
        summaryParts.push(`STAR ${southStar.id}`);
      }
    } else if (/标准进场|进场程序|按程序进场|CLEARED\s*STAR/.test(clauseText)) {
      const defaultStar = airport.procedures.find(
        (p) => p.type === 'STAR' && p.runwayConfig === activeRunwayDir
      );
      if (defaultStar) {
        commands.push({ type: 'STAR', procedureId: defaultStar.id });
        summaryParts.push(`STAR ${defaultStar.id}`);
      }
    } else if (/标准离场|离场程序|按程序离场|CLEARED\s*SID/.test(clauseText)) {
      const sids = airport.procedures.filter((p) => p.type === 'SID');
      const matchedSid =
        sids.find((s) => s.legs.some((l) => l.waypointId === targetAc.assignedExitId)) || sids[0];
      if (matchedSid) {
        commands.push({ type: 'SID', procedureId: matchedSid.id });
        summaryParts.push(`SID ${matchedSid.id}`);
      }
    }
  }

  for (const wp of airport.waypoints) {
    if (clauseText.includes(wp.id)) {
      if (/等待|盘旋|HOLD/.test(clauseText)) {
        commands.push({ type: 'HOLD', waypointId: wp.id });
        summaryParts.push(`在 ${wp.id} 等待`);
      } else if (!commands.some((c) => c.type === 'STAR' || c.type === 'SID')) {
        commands.push({ type: 'DCT', waypointId: wp.id });
        summaryParts.push(`直飞 ${wp.id}`);
      }
      break;
    }
  }

  if (/等待|盘旋|HOLD/.test(clauseText) && !commands.some((c) => c.type === 'HOLD' || c.type === 'LINE_UP_WAIT') && targetAc.phase !== 'HOLDING_GROUND' && targetAc.phase !== 'LINE_UP_WAIT') {
    const holdWp =
      airport.waypoints.find((w) => w.role === 'HOLD_STACK')?.id ||
      airport.waypoints.find((w) => w.role === 'FAF')?.id ||
      airport.waypoints[0]?.id;
    commands.push({ type: 'HOLD', waypointId: holdWp });
    summaryParts.push(`进入等待 (${holdWp})`);
  }

  // 8. Approach clearance and landing clearance are distinct instructions.
  if (
    /盲降|五边|进近|切入|对准跑道|ILS|APPROACH|VECTOR|FINAL/.test(clauseText) &&
    !commands.some((c) => c.type === 'GO_AROUND')
  ) {
    const rwyForApp = mentionedRwy || targetAc.assignedRunway;
    const altCmd = commands.find((c) => c.type === 'ALT');
    const simulatedAc =
      altCmd && altCmd.altitude
        ? {
            ...targetAc,
            targetAltitude: altCmd.altitude,
          }
        : targetAc;
    const ilsCheck = checkIlsConditions(simulatedAc, airport, rwyForApp);
    if (/引导|切五边|一键|VECTOR/.test(clauseText) || !ilsCheck.canAcceptClearance) {
      commands.push({ type: 'VECTOR_TO_FINAL', runwayId: rwyForApp });
      summaryParts.push(`引导切入 ${rwyForApp} 五边盲降`);
    } else {
      commands.push({ type: 'CLEARED_ILS', runwayId: rwyForApp });
      summaryParts.push(`准许 ${rwyForApp} 盲降进近`);
    }
  }
  if (/落地|降落|着陆|CLEARED\s+TO\s+LAND|\bLAND\b/.test(clauseText) &&
      !commands.some((c) => c.type === 'GO_AROUND')) {
    commands.push({ type: 'CLEARED_LAND', runwayId: mentionedRwy || targetAc.assignedRunway });
    summaryParts.push(`准许 ${mentionedRwy || targetAc.assignedRunway} 着陆`);
  }

  // 9. 识别应答机识别 (IDENT)
  if (/识别|应答机|IDENT|SQUAWK/.test(clauseText)) {
    commands.push({ type: 'SQUAWK_IDENT' });
    summaryParts.push('应答机识别 IDENT');
  }

  const std =
    commands.length > 0
      ? buildStandardAtcPhraseology(targetAc, commands, altitudeUnit)
      : undefined;

  return {
    correctionNote: match.correctionNote, matchMode: match.matchMode,
    matchedAircraftId: targetAc.id,
    matchedCallsign: targetAc.callsign,
    commands,
    summaryCn:
      summaryParts.length > 0
        ? `${targetAc.callsign}：${summaryParts.join(' + ')}`
        : `未识别出有效指令 (“${cleanedRaw}” → 规范化:“${normalizedFull}”)`,
    rawTranscript: cleanedRaw,
    normalizedPreviewCn: normalizedFull,
    standardAtcPhraseCn: std?.phraseCn,
    standardAtcPhraseEn: std?.phraseEn,
    kokoroPhoneticText: std?.kokoroPhoneticEn,
  };
}

/** Preserve raw/ITN/browser alternatives; use a fallback only when usable parses agree. */
export function parseVoiceCandidates(
  raw: string, alternatives: string[], aircraft: Aircraft[], selectedId: string | null,
  airport: AirportConfig, direction: RunwayDirectionConfig = '09', runwayMode: RunwayCountMode = 'DUAL',
  unit: AltitudeUnit = 'METRIC', assistEnabled = true
): FuzzyVoiceParseResult {
  const parse = (text: string) => parseFuzzyVoiceTranscript(text, aircraft, selectedId, airport, direction, runwayMode, unit, assistEnabled);
  const first = parse(raw);
  const explicitUnknownFlight = !first.matchedAircraftId && /(?:\b[A-Z]{3}|东方|国航|南方|海南|厦门|四川|国泰|全日空|日本航空|英国航空|维珍|航空|[\u3400-\u9fff]{1,3}航)\s*\d{2,}/.test(first.normalizedPreviewCn);
  if (first.commands.length || !assistEnabled || first.candidateAircraftIds?.length || explicitUnknownFlight ||
      /不(?:要|准|能|可以|用|需要)|别|禁止|取消|NOT\s+CLEARED|DO\s+NOT|CANCEL|ABORT\s+TAKEOFF/i.test(raw)) return first;
  const usable = [...new Set(alternatives.filter((text) => text && text !== raw))].map(parse)
    .filter((result) => result.matchedAircraftId && result.commands.length);
  if (!usable.length) return first;
  const signatures = new Set(usable.map((result) => JSON.stringify([result.matchedAircraftId, result.commands])));
  if (signatures.size !== 1) return { ...first, commands: [],
    candidateAircraftIds: [...new Set(usable.map((result) => result.matchedAircraftId!))],
    summaryCn: '不同识别结果存在歧义，请先选择航班，再重说关键指令和数值' };
  return { ...usable[0], rawTranscript: raw,
    correctionNote: `采用备选识别：${usable[0].rawTranscript}${usable[0].correctionNote ? ` · ${usable[0].correctionNote}` : ''}` };
}
