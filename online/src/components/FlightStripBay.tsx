import { localizeUi } from '../i18n/react';
import React from 'react';
import { useGameStore } from '../game/store';
import { Aircraft, FlightPhase } from '../aircraft/types';
import { formatAltitudeValue, formatHeading } from '../aircraft/physics';
import { getAirlineBrandByCallsign } from '../airport/harborAirport';

const PHASE_LABELS: Record<FlightPhase, { text: string; cls: string }> = {
  HOLDING_GROUND: { text: '地面等待 GND', cls: 'phase-gnd' },
  LINE_UP_WAIT: { text: '进跑道等待 LUAW', cls: 'phase-tkof' },
  TAKEOFF_ROLL: { text: '起飞滑跑 TKOF', cls: 'phase-tkof' },
  INITIAL_CLIMB: { text: '初始爬升 CLB', cls: 'phase-dep' },
  DEPARTING: { text: '离场引导 DEP', cls: 'phase-dep' },
  ARRIVING: { text: '进港引导 ARR', cls: 'phase-arr' },
  HOLDING_AIR: { text: '空中等待 HOLD', cls: 'phase-hold' },
  INTERCEPTING: { text: '切入五边 LOC ARM', cls: 'phase-ils' },
  FINAL_APPROACH: { text: '五边盲降 ILS', cls: 'phase-ils-lock' },
  LANDING_ROLL: { text: '着陆滑跑 ROLL', cls: 'phase-land' },
  HOLD_CROSSING: { text: '等待穿越 X-RWY', cls: 'phase-warn' },
  GO_AROUND: { text: '复飞爬升 G/A', cls: 'phase-warn' },
  LANDED: { text: '已安全着陆 LANDED', cls: 'phase-done' },
  HANDED_OFF: { text: '已移交区调 HANDOFF', cls: 'phase-done' },
  EXITED_AIRSPACE: { text: '飞出扇区 EXITED', cls: 'phase-warn' },
};

export const FlightStripBay: React.FC = () => {
  const store = useGameStore();
  const altUnit = store.settings.altitudeUnit || 'METRIC';
  const isTutorialHighlight = store.tutorial.active && store.tutorial.step === 2;

  const filteredAircraft = store.aircraft.filter((ac) => {
    const isCompleted =
      ac.phase === 'LANDED' ||
      ac.phase === 'HANDED_OFF' ||
      ac.phase === 'EXITED_AIRSPACE';
    if (store.activeTab === 'COMPLETED') return isCompleted;
    if (isCompleted) return false;
    if (store.activeTab === 'ARRIVAL') return ac.category === 'ARRIVAL';
    if (store.activeTab === 'DEPARTURE') return ac.category === 'DEPARTURE';
    return true;
  });

  const activeArrivalsCount = store.aircraft.filter(
    (a) => a.category === 'ARRIVAL' && a.phase !== 'LANDED' && a.phase !== 'EXITED_AIRSPACE'
  ).length;
  const activeDeparturesCount = store.aircraft.filter(
    (a) => a.category === 'DEPARTURE' && a.phase !== 'HANDED_OFF' && a.phase !== 'EXITED_AIRSPACE'
  ).length;
  const completedCount = store.aircraft.filter(
    (a) => a.phase === 'LANDED' || a.phase === 'HANDED_OFF' || a.phase === 'EXITED_AIRSPACE'
  ).length;

  return localizeUi((
    <div
      className="flight-strip-bay"
      data-testid="flight-strip-bay"
      style={
        isTutorialHighlight
          ? { boxShadow: 'inset 0 0 0 2px #fbbf24', background: 'rgba(251, 191, 36, 0.08)' }
          : undefined
      }
    >
      <div className="panel-header">
        <span className="panel-title">
          电子进程单 FLIGHT STRIPS ({altUnit === 'METRIC' ? '米制 m' : '英制 ft'})
        </span>
        <div className="strip-tabs">
          <button
            type="button"
            className={`tab-btn ${store.activeTab === 'ALL' ? 'active' : ''}`}
            data-testid="tab-all"
            onClick={() => store.setActiveTab('ALL')}
          >
            全部 ({activeArrivalsCount + activeDeparturesCount})
          </button>
          <button
            type="button"
            className={`tab-btn ${store.activeTab === 'ARRIVAL' ? 'active' : ''}`}
            data-testid="tab-arrival"
            onClick={() => store.setActiveTab('ARRIVAL')}
          >
            进港 ({activeArrivalsCount})
          </button>
          <button
            type="button"
            className={`tab-btn ${store.activeTab === 'DEPARTURE' ? 'active' : ''}`}
            data-testid="tab-departure"
            onClick={() => store.setActiveTab('DEPARTURE')}
          >
            离港 ({activeDeparturesCount})
          </button>
          <button
            type="button"
            className={`tab-btn ${store.activeTab === 'COMPLETED' ? 'active' : ''}`}
            data-testid="tab-completed"
            onClick={() => store.setActiveTab('COMPLETED')}
          >
            完成 ({completedCount})
          </button>
        </div>
      </div>

      <div className="strip-list">
        {filteredAircraft.length === 0 ? (
          <div className="strip-empty">当前分类下暂无航班</div>
        ) : (
          filteredAircraft.map((ac: Aircraft) => {
            const isSelected = ac.id === store.selectedAircraftId;
            const phaseInfo = PHASE_LABELS[ac.phase];
            const wakeBadge =
              store.settings.wakeStandard === 'RECAT_EU' ? ac.recatCode : ac.wakeCode;
            const airlineBrand = getAirlineBrandByCallsign(ac.callsign);
            const curAltStr = formatAltitudeValue(ac.altitude, altUnit);
            const tgtAltStr = formatAltitudeValue(ac.targetAltitude, altUnit);

            return (
              <div
                key={ac.id}
                className={`flight-strip ${
                  ac.category === 'ARRIVAL' ? 'strip-arr' : 'strip-dep'
                } ${isSelected ? 'strip-selected' : ''} ${
                  ac.conflictLevel !== 'NONE' ||
                  ac.inWeatherHazard ||
                  ac.emergencyType !== 'NONE' ||
                  ac.tcasRaActive
                    ? 'strip-conflict'
                    : ''
                }`}
                data-testid={`flight-strip-${ac.callsign}`}
                onClick={() => store.selectAircraft(ac.id)}
              >
                <div className="strip-row-top">
                  <div className="strip-id-group">
                    <span className="strip-callsign">{ac.callsign}</span>
                    <span className="strip-model">
                      {ac.model}/{wakeBadge}
                    </span>
                    <span className="strip-airline">
                      <span className="strip-airline-name">{ac.airlineCn}</span>
                      <img
                        src={airlineBrand.logoDataUri}
                        alt={`${ac.airlineCn} 标志`}
                        title={`${ac.airlineCn} (${airlineBrand.icao}) 航徽标志`}
                        className="strip-airline-logo"
                        data-testid={`airline-logo-${ac.callsign}`}
                      />
                      <span className="strip-squawk">· SQK {ac.squawkCode}</span>
                    </span>
                  </div>
                  <span className={`strip-phase-badge ${phaseInfo.cls}`}>
                    {ac.tcasRaActive
                      ? `TCAS RA ${ac.tcasRaDirection}`
                      : ac.emergencyType !== 'NONE'
                      ? `🚨 ${ac.squawkCode}`
                      : phaseInfo.text}
                  </span>
                </div>

                <div className="strip-row-metrics mono">
                  <div>
                    <span className="m-lbl">ALT</span>{' '}
                    <strong>{curAltStr}</strong>
                    <span className="m-arrow">→</span>
                    <span>{tgtAltStr}</span>
                  </div>
                  <div>
                    <span className="m-lbl">GS</span>{' '}
                    <strong>{Math.round(ac.groundSpeed)}</strong>
                    <span className="m-arrow">→</span>
                    <span>{Math.round(ac.targetSpeed)}kt</span>
                  </div>
                  <div>
                    <span className="m-lbl">HDG</span>{' '}
                    <strong>{formatHeading(ac.heading)}°</strong>
                    <span className="m-arrow">→</span>
                    <span>{formatHeading(ac.targetHeading)}°</span>
                  </div>
                </div>

                <div className="strip-row-bottom">
                  <span className="strip-cmd-tag">{ac.lastCommandText}</span>
                  {ac.category === 'ARRIVAL' ? (
                    <span className="strip-route-tag">
                      ILS RWY {ac.assignedRunway}
                    </span>
                  ) : (
                    <span className="strip-route-tag">
                      RWY {ac.assignedRunway} → {ac.assignedExitId || 'OCEAN'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  ), store.uiLanguage) as React.ReactElement;
};
