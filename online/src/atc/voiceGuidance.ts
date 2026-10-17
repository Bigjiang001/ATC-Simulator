import { Aircraft, AltitudeUnit } from '../aircraft/types';
import { checkIlsConditions } from '../aircraft/physics';
import { AirportConfig } from '../aircraft/types';
export function suggestedVoiceCommand(ac: Aircraft, airport: AirportConfig, unit: AltitudeUnit, requireLandingClearance = false): { phrase: string; hint: string } {
  const call = `${ac.airlineCn}${ac.callsign.slice(3)}，`;
  if (ac.emergencyType === 'SQUAWK_7600_NORDO') return { phrase: '', hint: '此机无线电失联，先清空它的进近走廊。' };
  if (ac.tcasRaActive) return { phrase: '', hint: '机组正在自主避撞，等待冲突解除后再下达高度指令。' };
  if (ac.phase === 'HOLD_CROSSING') return { phrase: call + '穿越跑道', hint: '确认跑道没有起降滑跑航班，再放行穿越。' };
  if (ac.phase === 'HOLDING_GROUND' || ac.phase === 'LINE_UP_WAIT') return { phrase: call + '可以起飞', hint: '系统仍会检查跑道占用和尾流间隔。' };
  if (ac.phase === 'TAKEOFF_ROLL' || ac.phase === 'LANDING_ROLL') return { phrase: '', hint: '飞机正在滑跑，先保持跑道畅通。' };
  if (ac.category === 'DEPARTURE') {
    if (ac.canHandoff) return { phrase: call + '移交', hint: '移交后完成本架离港任务。' };
    if (ac.targetAltitude < 5000) return { phrase: call + (unit === 'METRIC' ? '爬升到一千八百米' : 'CLIMB 6000 FEET'), hint: '爬升达到移交条件后，再说“移交”。' };
    return { phrase: '', hint: '飞机正在爬升前往离场出口；可用倍速缩短等待。' };
  }
  if (ac.phase === 'FINAL_APPROACH' || ac.phase === 'INTERCEPTING') return requireLandingClearance && !ac.clearedToLand
    ? { phrase: call + '可以着陆', hint: 'ILS 进近许可不等于着陆许可。确认跑道畅通，再说“可以着陆”。' }
    : { phrase: '', hint: '进近已建立，无需重复发布高度和盲降许可，保持跑道畅通。' };
  return checkIlsConditions(ac, airport, ac.assignedRunway, unit).canAcceptClearance
    ? { phrase: call + '可以盲降', hint: '说“可以盲降”即可建立进近，机组会自动完成下降和落地。' }
    : { phrase: call + '引导五边', hint: '暂未对准五边，可以先用这句完成转向、下降与进近引导。' };
}
