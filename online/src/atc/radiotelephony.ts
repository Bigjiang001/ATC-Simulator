import { Aircraft, RadioLogEntry, SpeechQueueItem } from '../aircraft/types';

function escaped(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function pilotCallsign(ac: Aircraft, language: 'CN' | 'EN'): string {
  const digits = ac.callsign.replace(/^[A-Z]{3}/i, '');
  if (language === 'CN') return `${ac.airlineCn} ${digits}`;
  const wake = ac.wakeCategory === 'SUPER' ? ' SUPER' : ac.wakeCategory === 'HEAVY' ? ' HEAVY' : '';
  return `${ac.airlineName} ${digits}${wake}`;
}
function ownNames(ac: Aircraft): string[] {
  const digits = ac.callsign.replace(/^[A-Z]{3}/i, '');
  return [`${ac.airlineCn} ${ac.callsign}`, pilotCallsign(ac, 'EN'), `${ac.airlineName} ${digits}`, pilotCallsign(ac, 'CN'),
    `${ac.airlineCn}${digits}`, ac.callsign].sort((a, b) => b.length - a.length);
}
/** One source for log text and spoken readback: instruction first, own callsign last.
 * NORDO status messages are not fabricated radio transmissions. MAYDAY urgency stays.
 */
export function formatPilotReadback(ac: Aircraft, text: string, language: 'CN' | 'EN'): string {
  if (!text || /^\s*\[/.test(text)) return text;
  let body = text;
  for (const name of ownNames(ac)) {
    const pattern = escaped(name).replace(/\s+/g, '\\s*');
    body = body.replace(new RegExp(`${pattern}(?![0-9])`, 'gi'), '');
  }
  body = body.replace(/[,，]\s*[。.](?=\s|$)/g, language === 'CN' ? '，' : ', ');
  body = body.replace(/^[\s,，。.!！:：;；]+|[\s,，。.!！:：;；]+$/g, '')
    .replace(/\s+([,，。.!！])/g, '$1').replace(/[,，]\s*[,，]/g, language === 'CN' ? '，' : ', ');
  if (!body) return text;
  return language === 'CN' ? `${body}，${pilotCallsign(ac, 'CN')}。`
    : `${body}, ${pilotCallsign(ac, 'EN')}.`;
}

/** Normalize automatic position reports as well as command readbacks at publication. */
export function normalizePilotMessages<T extends {
  aircraft: Aircraft[]; radioLogs: RadioLogEntry[]; pendingSpeechItems: SpeechQueueItem[];
}>(state: T): T {
  const byCall = new Map(state.aircraft.map((ac) => [ac.callsign, ac]));
  const radioLogs = state.radioLogs.map((entry) => {
    const ac = entry.callsign && byCall.get(entry.callsign);
    if ((entry.sender !== 'PILOT' && entry.sender !== 'ALERT') || !ac || ac.emergencyType === 'SQUAWK_7600_NORDO') return entry;
    return { ...entry, messageCn: formatPilotReadback(ac, entry.messageCn, 'CN'),
      messageEn: formatPilotReadback(ac, entry.messageEn, 'EN') };
  });
  const pendingSpeechItems = state.pendingSpeechItems.flatMap((item) => {
    if (item.role !== 'PILOT') return [item];
    const texts = [item.textEn, item.textCn];
    // Prefer an existing suffix/prefix over another aircraft mentioned inside a refusal.
    let ac = state.aircraft.find((a) => ownNames(a).some((n) => texts.some((t) =>
      new RegExp(`${escaped(n).replace(/\s+/g, '\\s*')}[。.!！\\s]*$`, 'i').test(t))));
    ac ||= state.aircraft.find((a) => ownNames(a).some((n) => texts.some((t) => t.startsWith(n))));
    ac ||= state.aircraft.find((a) => texts.some((t) => t.includes(a.callsign)));
    if (ac?.emergencyType === 'SQUAWK_7600_NORDO') return [];
    return [ac ? { ...item, textCn: formatPilotReadback(ac, item.textCn, 'CN'),
      textEn: formatPilotReadback(ac, item.textEn, 'EN') } : item];
  });
  return { ...state, radioLogs, pendingSpeechItems };
}
