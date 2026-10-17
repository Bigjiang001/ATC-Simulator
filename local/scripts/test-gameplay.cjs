const assert = require('node:assert/strict');
const fs = require('node:fs');
const babel = require('@babel/core');
require.extensions['.ts'] = (module, filename) => module._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }], require.resolve('@babel/preset-typescript')],
}).code, filename);
const { parseFuzzyVoiceTranscript: parse, parseVoiceCandidates, normalizeChineseSpokenNumbers: normalize } = require('../src/atc/voiceRecognizer.ts');
const { executeATCCommand: execute, parseTextCommand } = require('../src/atc/commands.ts');
const { pilotCallsign, formatPilotReadback, normalizePilotMessages } = require('../src/atc/radiotelephony.ts');
const { createInitialSimulationState: initial, issueSimulationCommand: issue, advanceSimulation: advance, spawnEmergencyFlightInState } = require('../src/simulation/engine.ts');
const { getRunwayConfig, updateAircraftPhysics } = require('../src/aircraft/physics.ts');
const { evaluateAirspaceSafety } = require('../src/safety/conflictDetector.ts');
const { MISSIONS, createMissionState, missionStars, isMissionUnlocked, loadMissionProgress, saveMissionProgress } = require('../src/game/missions.ts');
const { useGameStore } = require('../src/game/store.ts');
let passed = 0, failed = 0;
function check(name, run) { try { run(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.error(`FAIL: ${name}\n${error.stack}`); } }
const scene = () => initial('NORMAL', true, { enableEmergencies: false });
function speech(text, state = scene(), selected = state.selectedAircraftId, assist = true) {
  return parse(text, state.aircraft, selected, state.airport, state.activeRunwayDir, state.settings.runwayCountMode, state.settings.altitudeUnit, assist);
}
function assertSuffix(ac, result) {
  for (const [field, lang] of [['pilotReadbackCn', 'CN'], ['pilotReadbackEn', 'EN']]) {
    const call = pilotCallsign(ac, lang), text = result[field];
    assert(text.endsWith(call + (lang === 'CN' ? '。' : '.')), text);
    assert.equal(text.split(call).length - 1, 1, text);
    assert.equal(formatPilotReadback(ac, text, lang), text, 'Formatting must be idempotent');
  }
}
check('Chinese homophones, aviation digits, compound numbers and modal 要 preserve the requested aircraft and values', () => {
  for (const raw of ['冬航五两要三下降到六百可以忙降', '东航五二一散下六白忙讲', '5213下600要盲降']) {
    const p = speech(raw); assert.equal(p.matchedCallsign, 'CES5213');
    assert.deepEqual(p.commands.map(c => c.type), ['ALT', 'CLEARED_ILS']); assert.equal(p.commands[0].altitude, 2000);
  }
  const p = speech('国航是幺八洞两左拐洞九洞减速一百八十');
  assert.equal(p.matchedCallsign, 'CCA1802'); assert.equal(p.commands[0].heading, 90); assert.equal(p.commands[1].speed, 180);
  for (const [raw, value] of [['三千三百','3300'], ['一千六','1600'], ['一千零六','1006'], ['两千四百','2400'], ['TWO THOUSAND FOUR HUNDRED', '2400']]) assert.equal(normalize(raw), value);
});
check('Selected/contextual targeting works; ambiguity and unknown/competing explicit callsigns never dispatch', () => {
  const s = scene(), ces = s.aircraft.find(a => a.callsign === 'CES5213');
  assert.equal(speech('下降到九百米', s, ces.id).commands[0].altitude, 3000);
  const ambiguous = speech('可以起飞', s, null); assert.equal(ambiguous.commands.length, 0); assert.equal(ambiguous.candidateAircraftIds.length, 2);
  for (const text of ['CES9999下600', '东航9999下600', '联合航空1234下600', '绿航1234下600', '东航5213国航1802左转090']) assert.equal(speech(text, s, ces.id).commands.length, 0, text);
  const duplicate = { ...ces, id: 'near-call', callsign: 'CES5215' };
  const p = speech('东航5214下600', { ...s, aircraft: [ces, duplicate] }, ces.id);
  assert.equal(p.commands.length, 0); assert.equal(p.candidateAircraftIds.length, 2);
  assert.equal(speech('东航5214下600', { ...s, aircraft: [ces] }, ces.id, false).commands.length, 0);
  assert.equal(speech('可以起飞', { ...s, aircraft: [s.aircraft.find(a => a.phase === 'HOLDING_GROUND')] }, null).commands[0].type, 'CLEARED_TAKEOFF');
});
check('Flight digits are stripped only once, without deleting the same heading/speed value', () => {
  const s = scene(), ac = { ...s.aircraft[0], callsign: 'CES180', id: 'flight-180' };
  const p = speech('东航180速度180航向180', { ...s, aircraft: [ac] }, ac.id);
  assert.deepEqual(p.commands.map(c => c.type), ['HDG', 'SPD']); assert.equal(p.commands[0].heading, 180); assert.equal(p.commands[1].speed, 180);
});
check('Negation, waiting, invalid headings/speeds and foreign/ambiguous runways never become a clearance', () => {
  const s = scene(), dep = s.aircraft.find(a => a.phase === 'HOLDING_GROUND');
  for (const raw of ['不要起飞', '别起飞', 'NOT CLEARED FOR TAKEOFF', '等待起飞', '航向390', '减速1800', '减速99', '跑道22可以起飞', '跑道09可以起飞']) {
    assert.equal(speech(raw, s, dep.id).commands.length, 0, raw);
  }
  assert.equal(execute(s.aircraft[0], { type: 'CLEARED_ILS', runwayId: '22' }, s.airport, s.aircraft).accepted, false);
  assert.equal(execute(s.aircraft[0], { type: 'HDG', heading: NaN }, s.airport, s.aircraft).accepted, false);
  assert.equal(parseTextCommand('ALT 600F').altitude, 600);
});
check('Raw/ITN alternatives recover a missing phrase but reject disagreement, negation and an explicit unknown flight', () => {
  const s = scene(), ac = s.aircraft[0];
  const candidates = (raw, alternatives) => parseVoiceCandidates(raw, alternatives, s.aircraft, ac.id, s.airport);
  assert.equal(candidates('嗯', ['下降六百米']).commands[0].altitude, 2000);
  assert.equal(candidates('嗯', ['下降六百米', '下降九百米']).commands.length, 0);
  assert.equal(candidates('别起飞', ['可以起飞']).commands.length, 0);
  assert.equal(candidates('CES9999下600', ['东航5213下600']).commands.length, 0);
  assert.equal(candidates('联合航空1234下600', ['东航5213下600']).commands.length, 0);
});
check('Every command family and refusal ends in its own callsign in both languages; NORDO stays silent', () => {
  const s = scene(), ac = s.aircraft[0], dep = s.aircraft.find(a => a.phase === 'HOLDING_GROUND');
  const commands = [{type:'HDG',heading:180}, {type:'ALT',altitude:3000}, {type:'SPD',speed:180}, {type:'DCT',waypointId:s.airport.waypoints[0].id},
    {type:'STAR',procedureId:s.airport.procedures.find(p=>p.type==='STAR').id}, {type:'SID',procedureId:s.airport.procedures.find(p=>p.type==='SID').id},
    {type:'HOLD'}, {type:'ASSIGN_RUNWAY',runwayId:'09R'}, {type:'CLEARED_ILS'}, {type:'CLEARED_LAND'}, {type:'VECTOR_TO_FINAL'},
    {type:'LINE_UP_WAIT'}, {type:'CLEARED_TAKEOFF'}, {type:'GO_AROUND'}, {type:'HANDOFF'}, {type:'BREAK_OUT'}, {type:'CROSS_RUNWAY'}, {type:'SQUAWK_IDENT'}];
  for (const command of commands) for (const aircraft of [ac, dep]) assertSuffix(aircraft, execute(aircraft, command, s.airport, s.aircraft));
  const nordo = {...ac, emergencyType:'SQUAWK_7600_NORDO'};
  const result = execute(nordo, {type:'ALT',altitude:3000}, s.airport, [nordo]);
  assert.match(result.pilotReadbackCn, /^\[/);
  assert.equal(issue({...s, aircraft:[nordo],pendingSpeechItems:[]}, nordo.id, {type:'ALT',altitude:3000}, {suppressAtcTts:true}).pendingSpeechItems.length, 0);
  const spawned=spawnEmergencyFlightInState(s,'SQUAWK_7600_NORDO');
  assert.equal(spawned.pendingSpeechItems.filter(item=>item.role==='PILOT').length,0);
});
check('Readback includes cleared altitude, runway and frequency, and keeps another aircraft mentioned in a refusal', () => {
  const s = createMissionState(MISSIONS[0], scene().settings), ac = s.aircraft[0];
  const ils = execute(ac,{type:'CLEARED_ILS'},s.airport,[ac]); assert(ils.accepted); assert.match(ils.pilotReadbackCn,/600 米/); assert.match(ils.pilotReadbackEn,/UNTIL ESTABLISHED/);
  const crossing = {...ac,phase:'HOLD_CROSSING',crossingRunwayId:'09R'};
  const crossed = execute(crossing,{type:'CROSS_RUNWAY'},s.airport,[crossing]); assert.match(crossed.pilotReadbackCn,/121\.9/); assert.match(crossed.pilotReadbackEn,/121\.9/);
  const second = {...ac,id:'other',callsign:'CCA1802',airlineName:'AIR CHINA',airlineCn:'中国国航'};
  const sample = formatPilotReadback(ac,`${pilotCallsign(ac,'EN')}, UNABLE, TRAFFIC ${second.callsign}.`,'EN');
  const normalized = normalizePilotMessages({...s,aircraft:[ac,second],radioLogs:[],pendingSpeechItems:[{role:'PILOT',textCn:ils.pilotReadbackCn,textEn:sample}]});
  assert(normalized.pendingSpeechItems[0].textEn.includes(second.callsign)); assert(normalized.pendingSpeechItems[0].textEn.endsWith(pilotCallsign(ac,'EN')+'.'));
});
check('Compound spoken command produces one pilot transmission with the callsign once, after all values', () => {
  const s = scene(), ac = s.aircraft[0];
  const next = issue({...s,pendingSpeechItems:[]},ac.id,[{type:'HDG',heading:90},{type:'ALT',altitude:2000},{type:'SPD',speed:180}],{suppressAtcTts:true});
  const speech = next.pendingSpeechItems.filter(i=>i.role==='PILOT'); assert.equal(speech.length,1);
  assertSuffix(ac,{pilotReadbackCn:speech[0].textCn,pilotReadbackEn:speech[0].textEn});
  for (const token of ['090','600','180']) assert(speech[0].textCn.includes(token),speech[0].textCn);
});
check('Runway entry/crossing is blocked by short-final traffic, including intersecting runways', () => {
  const s = scene(), dep = s.aircraft.find(a=>a.phase==='HOLDING_GROUND');
  const rwy = getRunwayConfig(s.airport,dep.assignedRunway), rad = rwy.heading*Math.PI/180;
  const arrival = {...s.aircraft[0],assignedRunway:rwy.id,phase:'FINAL_APPROACH',position:{x:rwy.threshold.x-Math.sin(rad)*2,y:rwy.threshold.y-Math.cos(rad)*2}};
  assert.equal(execute(dep,{type:'LINE_UP_WAIT'},s.airport,[dep,arrival]).accepted,false);
  const linedUp={...dep,id:'another-departure',phase:'LINE_UP_WAIT'};
  assert.equal(execute(dep,{type:'CLEARED_TAKEOFF'},s.airport,[dep,linedUp]).accepted,false);
  const crossing = {...dep,phase:'HOLD_CROSSING',crossingRunwayId:rwy.id};
  assert.equal(execute(crossing,{type:'CROSS_RUNWAY'},s.airport,[crossing,arrival]).accepted,false);
  const intersecting=initial('NORMAL',true,{airportId:'RJTT'}), ground=intersecting.aircraft.find(a=>a.phase==='HOLDING_GROUND');
  const rolling={...intersecting.aircraft[0],phase:'TAKEOFF_ROLL',assignedRunway:intersecting.airport.primaryFlowRunways.arrival};
  assert.equal(execute(ground,{type:'LINE_UP_WAIT'},intersecting.airport,[ground,rolling]).accepted,false);
});
check('Disabling NTZ monitoring also disables the simplified independent-parallel separation exception', () => {
  const s=scene(), a={...s.aircraft[0],phase:'FINAL_APPROACH',assignedRunway:'09L',position:{x:-6,y:.55},altitude:1500};
  const b={...s.aircraft[1],phase:'FINAL_APPROACH',assignedRunway:'09R',position:{x:-6.2,y:-.55},altitude:1500};
  assert.equal(evaluateAirspaceSafety([a,b],0,new Set(),'ICAO',true,s.airport).alerts.length,0);
  assert(evaluateAirspaceSafety([a,b],0,new Set(),'ICAO',false,s.airport).alerts.length>0);
});
check('Procedure training requires separate landing clearance; missing/cancelled clearance causes a go-around', () => {
  let s = createMissionState(MISSIONS[0], scene().settings); s.settings={...s.settings,requireLandingClearance:true};
  s = issue(s,s.aircraft[0].id,{type:'CLEARED_ILS'}); const ac=s.aircraft[0], rwy=getRunwayConfig(s.airport,ac.assignedRunway);
  const rad=rwy.heading*Math.PI/180;
  const shortFinal={...ac,phase:'FINAL_APPROACH',altitude:220,targetAltitude:220,position:{x:rwy.threshold.x-Math.sin(rad)*.7,y:rwy.threshold.y-Math.cos(rad)*.7}};
  const denied=updateAircraftPhysics(shortFinal,.25,s.airport,false,undefined,false,'METRIC',false,true);
  assert.equal(denied.aircraft.phase,'GO_AROUND'); assert(denied.events.some(e=>e.detailEn.includes('NO LANDING CLEARANCE')));
  const cleared=execute(shortFinal,{type:'CLEARED_LAND'},s.airport,[shortFinal]); assert(cleared.accepted); assert(cleared.updatedAircraft.clearedToLand);
  assert.equal(updateAircraftPhysics(cleared.updatedAircraft,.25,s.airport,false,undefined,false,'METRIC',false,true).aircraft.phase,'FINAL_APPROACH');
  assert.equal(execute(cleared.updatedAircraft,{type:'GO_AROUND'},s.airport,[cleared.updatedAircraft]).updatedAircraft.clearedToLand,false);
  assert.equal(speech('可以着陆',s,ac.id).commands[0].type,'CLEARED_LAND');
  assert.equal(speech('CLEAR TO LAND',s,ac.id).commands[0].type,'CLEARED_LAND');
});
check('Repeated handoff, including a duplicate within one batch, cannot inflate completion or score', () => {
  const s=scene(), dep={...s.aircraft.find(a=>a.category==='DEPARTURE'),phase:'DEPARTING',canHandoff:true,altitude:6000};
  const once=issue({...s,aircraft:[dep],departedTarget:9},dep.id,[{type:'HANDOFF'},{type:'HANDOFF'}]);
  assert.equal(once.departedCount,1); const twice=issue(once,dep.id,{type:'HANDOFF'});
  assert.equal(twice.departedCount,1); assert.equal(twice.score,once.score);
});
check('First mission completes through Chinese voice, saves/unlocks, and retries the same scene; tutorial cannot be skipped', () => {
  const entries=new Map(); global.window={localStorage:{getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)}};
  try {
    useGameStore.getState().startMission('FIRST_LANDING'); let s=useGameStore.getState();
    assert.equal(s.aircraft.length,1); assert.equal(isMissionUnlocked('FIRST_DEPARTURE',s.missionProgress),false);
    assert(s.sendVoiceCommand('可以盲降').accepted);
    for(let i=0;i<1200&&useGameStore.getState().status==='RUNNING';i++)useGameStore.getState().tickSimulation(.25);
    s=useGameStore.getState(); assert.equal(s.status,'VICTORY'); assert.equal(s.missionRun.stars,3);
    assert.equal(loadMissionProgress().FIRST_LANDING.stars,3); assert(isMissionUnlocked('FIRST_DEPARTURE',s.missionProgress));
    s.restartGame(); s=useGameStore.getState(); assert.equal(s.missionRun.id,'FIRST_LANDING'); assert.equal(s.landedTarget,1); assert.equal(s.simTimeSec,0);
    s.startRookieTutorial(); useGameStore.getState().completeTutorialLicenseExam(); assert.equal(useGameStore.getState().tutorial.licensePassed,false);
    useGameStore.getState().restartGame('NORMAL',false); assert.equal(useGameStore.getState().trafficCap,undefined);
  } finally {delete global.window;}
});
check('All mission configurations use finite traffic, progressive targets and landing training from level three', () => {
  for(const [index,mission] of MISSIONS.entries()) {
    let s=createMissionState(mission,scene().settings); assert(s.aircraft.length<=mission.trafficCap);
    assert.equal(s.landedTarget,mission.arrivals); assert.equal(s.departedTarget,mission.departures);
    assert.equal(s.settings.requireLandingClearance,index>=2);
    s=advance({...s,nextSpawnTimerSec:.01},1); assert(s.aircraft.filter(a=>!['LANDED','HANDED_OFF','EXITED_AIRSPACE'].includes(a.phase)).length<=mission.trafficCap);
    assert.equal(missionStars({...s,status:'VICTORY',landedCount:mission.arrivals,departedCount:mission.departures,conflictCount:0,exitedCount:0,simTimeSec:mission.parTimeSec},mission),3);
    assert.equal(missionStars({...s,status:'VICTORY',landedCount:mission.arrivals,departedCount:mission.departures,conflictCount:1},mission),1);
  }
  saveMissionProgress({}); assert.equal(isMissionUnlocked('not-a-mission',{}),false);
});
check('Simulation clock advances a normal 250ms tick by 250ms, and rejected voice is visibly reported as a refusal', () => {
  useGameStore.getState().startMission('FIRST_LANDING'); const before=useGameStore.getState().simTimeSec;
  useGameStore.getState().tickSimulation(.25); assert.equal(useGameStore.getState().simTimeSec-before,.25);
  const result=useGameStore.getState().sendVoiceCommand('移交'); assert.equal(result.accepted,false); assert.equal(useGameStore.getState().voicePtt.statusType,'WARN');
  assert(useGameStore.getState().sendVoiceCommand('减速310').accepted);
  assert.match(useGameStore.getState().voicePtt.standardAtcPhraseCn,/250/);
  assert(!useGameStore.getState().voicePtt.lastSummaryCn.includes('310'));
});
check('Settlement review keeps time, aircraft and score frozen even when commands or ticks are attempted', () => {
  const s=createMissionState(MISSIONS[0],scene().settings), ended={...s,status:'GAMEOVER',isPaused:true,score:123};
  const next=issue(ended,s.aircraft[0].id,{type:'HDG',heading:180});
  assert.equal(next.score,123);assert.deepEqual(next.aircraft,ended.aircraft);assert.equal(next.lastCommandResults.length,0);
  assert.equal(advance(next,10).simTimeSec,ended.simTimeSec);
});
check('A rejected tutorial approach clearance cannot advance the lesson', () => {
  useGameStore.getState().startRookieTutorial(); const s=useGameStore.getState();
  useGameStore.setState({tutorial:{...s.tutorial,step:6},aircraft:s.aircraft.map(a=>({...a,altitude:9000,clearedApproach:false}))});
  useGameStore.getState().sendCommand({type:'CLEARED_ILS'});
  assert.equal(useGameStore.getState().tutorial.step,6);
});
check('Recorded SenseVoice outputs from six synthesized Mandarin samples parse to the intended commands', () => {
  const s=scene(), dep=s.aircraft.find(a=>a.phase==='HOLDING_GROUND');
  const cases=[
    ['东航五两幺三下降六百米可以盲降',s.aircraft[0].id,'CES5213',['ALT','CLEARED_ILS']],
    ['国航幺八栋两左转航向动九栋减速一百八十节',null,'CCA1802',['HDG','SPD']],
    ['可以起飞',dep.id,dep.callsign,['CLEARED_TAKEOFF']],
    ['不要起飞',dep.id,dep.callsign,[]],
    ['可以着陆',s.aircraft[0].id,'CES5213',['CLEARED_LAND']],
    ['爬升到一千八百米',dep.id,dep.callsign,['ALT']],
  ];
  for(const [raw,id,call,types] of cases){const p=speech(raw,s,id);assert.equal(p.matchedCallsign,call);assert.deepEqual(p.commands.map(c=>c.type),types);}
});
check('All five missions can be completed with legal game commands and real physics, without moving aircraft in tests', () => {
  const random=Math.random;let seed=112358;
  Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  try { for(const mission of MISSIONS) {
    let s=createMissionState(mission,scene().settings);const last=new Map();
    const command=(ac,cmd)=>{s=issue({...s,pendingSpeechItems:[],pendingSoundEvents:[]},ac.id,cmd);};
    for(let i=0;i<2500&&s.status==='RUNNING';i++) {
      for(const previous of [...s.aircraft]) {
        const ac=s.aircraft.find(a=>a.id===previous.id);
        if(ac.phase==='HOLDING_GROUND'&&(!last.has(ac.id)||s.simTimeSec-last.get(ac.id)>30)) {command(ac,{type:'CLEARED_TAKEOFF'});last.set(ac.id,s.simTimeSec);}
        else if(ac.phase==='HOLD_CROSSING')command(ac,{type:'CROSS_RUNWAY'});
        else if(ac.category==='DEPARTURE'&&ac.phase==='DEPARTING') {
          if(ac.canHandoff)command(ac,{type:'HANDOFF'});else if(ac.targetAltitude<5000)command(ac,{type:'ALT',altitude:6000});
        } else if(ac.category==='ARRIVAL') {
          if(['ARRIVING','HOLDING_AIR','GO_AROUND'].includes(ac.phase)&&(!last.has(ac.id)||s.simTimeSec-last.get(ac.id)>45)) {command(ac,{type:'VECTOR_TO_FINAL'});last.set(ac.id,s.simTimeSec);}
          else if(s.settings.requireLandingClearance&&ac.clearedApproach&&!ac.clearedToLand&&['INTERCEPTING','FINAL_APPROACH'].includes(ac.phase))command(ac,{type:'CLEARED_LAND'});
        }
      }
      if(s.status==='RUNNING')s=advance({...s,pendingSpeechItems:[],pendingSoundEvents:[]},1);
    }
    assert.equal(s.status,'VICTORY',`${mission.id}: ${s.endReasonEn}`);
    assert.equal(s.landedCount,mission.arrivals);assert.equal(s.departedCount,mission.departures);
    if(mission.id==='FIRST_LANDING'||mission.id==='FIRST_DEPARTURE')assert.equal(s.conflictCount,0);
    console.log(`  ${mission.id}: completed in ${s.simTimeSec}s; ${s.landedCount} arrivals / ${s.departedCount} departures`);
  }} finally { Math.random=random; }
});
console.log(`${passed}/${passed+failed} gameplay/voice/readback regression groups passed`);
if(failed) process.exit(1);
