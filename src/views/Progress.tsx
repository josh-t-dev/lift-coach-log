import { useMemo, useState } from 'react';
import { BarList, ChartCard, ColumnChart } from '../components/Charts';
import { exerciseName } from '../data/exercises';
import {
  addDays,
  cardioMinutes,
  exerciseSeries,
  loggedExercises,
  MEASURES,
  sessionsBetween,
  setsPerMuscle,
  sessionVolume,
  weekStart,
  weeklySeries,
  type ExerciseMeasure,
} from '../lib/analytics';
import { useAppState } from '../store';
import { MUSCLES } from '../types';
import { History } from './History';

const RANGES = [
  { weeks: 8, label: '8 weeks' },
  { weeks: 12, label: '12 weeks' },
  { weeks: 26, label: '6 months' },
  { weeks: 52, label: '1 year' },
];

export function Progress() {
  const state = useAppState();
  const { sessions, plan, customExercises: custom } = state;
  const [weeks, setWeeks] = useState(12);
  const [weekOffset, setWeekOffset] = useState(0);

  const perWeek = useMemo(() => weeklySeries(sessions, weeks, (s) => s.length), [sessions, weeks]);
  const cardioWeek = useMemo(() => weeklySeries(sessions, weeks, (s) => cardioMinutes(s, custom)), [sessions, weeks, custom]);
  const volumeWeek = useMemo(() => weeklySeries(sessions, weeks, (s) => Math.round(s.reduce((a, x) => a + sessionVolume(x), 0))), [sessions, weeks]);

  const mon = addDays(weekStart(new Date()), -7 * weekOffset);
  const muscleSets = useMemo(() => setsPerMuscle(sessionsBetween(sessions, mon, addDays(mon, 7)), custom), [sessions, custom, mon.getTime()]);
  const weekLabel = weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Last week' : `Week of ${mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  const lifts = useMemo(() => loggedExercises(sessions, custom), [sessions, custom]);
  const [exId, setExId] = useState<string>('');
  const selected = lifts.find((l) => l.id === exId) ?? lifts[0];
  const [measure, setMeasure] = useState<ExerciseMeasure>('e1rm');
  const measures = selected ? MEASURES[selected.metric] : [];
  const m = measures.find((x) => x.id === measure) ?? measures[0];
  const exSeries = useMemo(() => (selected && m ? exerciseSeries(sessions, selected.id, m.id, 12) : []), [sessions, selected, m]);
  const exUnit = !m ? '' : m.id === 'distance' ? state.distanceUnit : m.id === 'minutes' ? 'min' : state.unit;

  const rows = (pts: { label: string; value: number }[], unit = '') => pts.map((p): [string, string] => [p.label, `${p.value.toLocaleString()}${unit ? ` ${unit}` : ''}`]);
  const rangeSelect = (
    <select aria-label="Time range" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
      {RANGES.map((r) => <option key={r.weeks} value={r.weeks}>{r.label}</option>)}
    </select>
  );

  if (!sessions.some((s) => s.finishedAt)) {
    return (
      <div className="stack">
        <h2>Progress</h2>
        <div className="card muted">Finish a workout and your charts will show up here.</div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Progress</h2>
        {rangeSelect}
      </div>

      <ChartCard title="Workouts per week" subtitle={`Line = your plan (${plan.profile.daysPerWeek}/week)`} table={{ head: ['Week', 'Workouts'], rows: rows(perWeek) }}>
        <ColumnChart data={perWeek} target={plan.profile.daysPerWeek} targetLabel="Plan" format={(n) => String(Math.round(n * 10) / 10)} />
      </ChartCard>

      <ChartCard
        title="Exercise progress"
        subtitle={selected ? `${m?.label} per session, last ${exSeries.length}` : undefined}
        controls={
          lifts.length ? (
            <>
              <select aria-label="Exercise" value={selected?.id} onChange={(e) => setExId(e.target.value)}>
                {lifts.map((l) => <option key={l.id} value={l.id}>{exerciseName(l.id, custom)}</option>)}
              </select>
              <select aria-label="Measure" value={m?.id} onChange={(e) => setMeasure(e.target.value as ExerciseMeasure)}>
                {measures.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </>
          ) : undefined
        }
        table={{ head: ['Session', m?.label ?? ''], rows: rows(exSeries, exUnit) }}
      >
        <ColumnChart data={exSeries} unit={exUnit} empty="No sessions with this exercise yet." />
      </ChartCard>

      <ChartCard
        title="Hard sets per muscle"
        subtitle={`${weekLabel} · tick = your plan's target`}
        controls={
          <div className="row">
            <button className="btn small" onClick={() => setWeekOffset(weekOffset + 1)} aria-label="Previous week">‹</button>
            <span className="small">{weekLabel}</span>
            <button className="btn small" disabled={weekOffset === 0} onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Next week">›</button>
          </div>
        }
        table={{ head: ['Muscle', 'Sets / target'], rows: MUSCLES.map((x): [string, string] => [x, `${muscleSets[x]} / ${plan.setTargets[x]}`]) }}
      >
        <div style={{ marginTop: 12 }}>
          <BarList rows={MUSCLES.map((x) => ({ label: x, value: muscleSets[x], target: plan.setTargets[x] }))} />
        </div>
      </ChartCard>

      <ChartCard title="Cardio minutes per week" subtitle={plan.cardioMinutes ? `Line = your target (${plan.cardioMinutes} min)` : undefined} table={{ head: ['Week', 'Minutes'], rows: rows(cardioWeek, 'min') }}>
        <ColumnChart data={cardioWeek} target={plan.cardioMinutes || undefined} unit="min" empty="No cardio logged yet." />
      </ChartCard>

      <ChartCard title="Weekly lifting volume" subtitle={`Total weight × reps (${state.unit})`} table={{ head: ['Week', `Volume (${state.unit})`], rows: rows(volumeWeek, state.unit) }}>
        <ColumnChart data={volumeWeek} unit={state.unit} format={(n) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n.toLocaleString())} />
      </ChartCard>

      <History />
    </div>
  );
}
