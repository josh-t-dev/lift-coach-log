import { useEffect, useMemo, useState } from 'react';
import { ExercisePicker } from '../components/ExercisePicker';
import { findExercise, metricOf } from '../data/exercises';
import { exerciseHistory, isWorkingSet, type LoggedSet } from '../lib/analytics';
import { newSet, uid, update, useAppState } from '../store';
import type { AppState, ExerciseLog, SetLog } from '../types';

function num(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function mmss(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function editActive(fn: (a: NonNullable<AppState['active']>) => void) {
  update((d) => {
    if (d.active) fn(d.active);
  });
}

export function ActiveWorkout({ onDone }: { onDone: () => void }) {
  const state = useAppState();
  const active = state.active;
  const [picking, setPicking] = useState(false);
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [restLabel, setRestLabel] = useState('');
  const now = useNow();
  const hist = useMemo(() => exerciseHistory(state.sessions), [state.sessions]);

  useEffect(() => {
    if (restUntil && now >= restUntil) {
      setRestUntil(null);
      if ('vibrate' in navigator) navigator.vibrate?.(200);
    }
  }, [now, restUntil]);

  if (!active) return null;

  const doneSets = active.exercises.reduce((a, e) => a + e.sets.filter(isWorkingSet).length, 0);

  const finish = () => {
    if (!doneSets && !confirm('No completed sets. Discard this workout?')) return;
    update((d) => {
      if (!d.active) return;
      const s = d.active;
      s.finishedAt = new Date().toISOString();
      s.exercises = s.exercises
        .map((e) => ({ ...e, sets: e.sets.filter(isWorkingSet) }))
        .filter((e) => e.sets.length);
      if (s.exercises.length) d.sessions.push(s);
      d.active = null;
    });
    onDone();
  };

  const discard = () => {
    if (!confirm('Discard this workout? Logged sets will be lost.')) return;
    update((d) => void (d.active = null));
    onDone();
  };

  return (
    <div className="stack">
      <div className="card">
        <input
          type="text"
          aria-label="Workout name"
          value={active.name}
          onChange={(e) => editActive((a) => void (a.name = e.target.value))}
          style={{ fontWeight: 600, fontSize: 18, border: 0, padding: 0, minHeight: 0, background: 'transparent' }}
        />
        <div className="row spread small muted" style={{ marginTop: 4 }}>
          <span>⏱ {mmss((now - new Date(active.startedAt).getTime()) / 1000)}</span>
          <span>{doneSets} sets done</span>
        </div>
      </div>

      {active.exercises.map((log, i) => (
        <ExerciseBlock
          key={log.id}
          log={log}
          index={i}
          count={active.exercises.length}
          unit={state.unit}
          distanceUnit={state.distanceUnit}
          prev={hist.get(log.exerciseId)?.lastSets}
          defaultRest={state.defaultRestSec}
          onSetDone={(sec, name) => {
            if (sec <= 0) return;
            setRestUntil(Date.now() + sec * 1000);
            setRestLabel(name);
          }}
        />
      ))}

      {!active.exercises.length && (
        <div className="card muted" style={{ textAlign: 'center' }}>Add your first exercise to start logging.</div>
      )}

      <button className="btn block" onClick={() => setPicking(true)}>+ Add exercise</button>
      <div className="row">
        <button className="btn danger" onClick={discard}>Discard</button>
        <button className="btn primary grow" onClick={finish}>Finish workout</button>
      </div>

      {picking && (
        <ExercisePicker
          onClose={() => setPicking(false)}
          onPick={(ex, metric) => {
            const last = hist.get(ex.id)?.lastSets.at(-1);
            const count = metric === 'time_distance' ? 1 : 3;
            editActive((a) =>
              a.exercises.push({
                id: uid(),
                exerciseId: ex.id,
                metric: metric === ex.metric ? undefined : metric,
                sets: Array.from({ length: count }, () => newSet(metric === 'weight_reps' ? last?.weight ?? null : null)),
              }),
            );
            setPicking(false);
          }}
        />
      )}

      {restUntil && (
        <div className="rest" role="status">
          <span className="rest-time">Rest {mmss((restUntil - Date.now()) / 1000)}</span>
          {restLabel && <span className="rest-name small">{restLabel}</span>}
          <button className="btn" onClick={() => setRestUntil(restUntil + 30_000)}>+30s</button>
          <button className="btn" onClick={() => setRestUntil(null)}>Skip</button>
        </div>
      )}
    </div>
  );
}

function ExerciseBlock({
  log,
  index,
  count,
  unit,
  distanceUnit,
  prev,
  onSetDone,
  defaultRest,
}: {
  log: ExerciseLog;
  index: number;
  count: number;
  unit: string;
  distanceUnit: string;
  prev?: LoggedSet[];
  onSetDone: (restSec: number, exerciseName: string) => void;
  defaultRest: number;
}) {
  const state = useAppState();
  const ex = findExercise(log.exerciseId, state.customExercises);
  const metric = metricOf(log, state.customExercises);
  const timed = metric === 'time_distance';
  // Sprints log seconds and metres; runs and cardio log minutes and km/mi.
  const secs = ex?.timeUnit === 'sec';
  const dUnit = ex?.distUnit === 'm' ? 'm' : distanceUnit;
  const t = log.target;
  const rest = log.restSec ?? defaultRestFor(ex, defaultRest);

  const editLog = (fn: (l: ExerciseLog) => void) => editActive((a) => {
    const l = a.exercises.find((x) => x.id === log.id);
    if (l) fn(l);
  });
  const editSet = (id: string, fn: (s: SetLog) => void) => editLog((l) => {
    const s = l.sets.find((x) => x.id === id);
    if (s) fn(s);
  });
  const move = (dir: -1 | 1) => editActive((a) => {
    const j = index + dir;
    if (j < 0 || j >= a.exercises.length) return;
    [a.exercises[index], a.exercises[j]] = [a.exercises[j], a.exercises[index]];
  });

  const hasValue = (s: SetLog) => (timed ? (s.durationSec ?? 0) > 0 || (s.distance ?? 0) > 0 : s.reps != null);
  const prevText = (p?: LoggedSet) => {
    if (!p) return '—';
    if (timed) return [p.durationSec ? (secs ? `${p.durationSec}s` : `${Math.round(p.durationSec / 60)}m`) : '', p.distance ? `${p.distance}` : ''].filter(Boolean).join(' ') || '—';
    return `${p.weight}×${p.reps}`;
  };
  // "W4: 4×20 + 4×30 m — cue" → this week's prescription replaces the generic target.
  const weekMatch = log.note?.match(/^W(\d+): (.*?)(?: — (.*))?$/);
  const otherNote = weekMatch ? weekMatch[3] : log.note;
  const targetText = () => {
    if (weekMatch) return `Week ${weekMatch[1]}: ${weekMatch[2]}`;
    if (!t) return null;
    if (timed) {
      const parts = [!secs && t.minutes ? `${t.minutes} min` : '', t.distance ? `${log.sets.length} × ${t.distance} ${dUnit}` : ''].filter(Boolean);
      return parts.length ? `Target ${parts.join(' · ')}` : null;
    }
    return `Target ${log.sets.length} × ${t.repMin === t.repMax ? t.repMin : `${t.repMin}–${t.repMax}`}${t.rpe != null ? ` @ RPE ${t.rpe}` : ''}`;
  };

  const toggleDone = (s: SetLog, cell: HTMLElement) => {
    const willBeDone = !s.done;
    if (willBeDone && !hasValue(s)) {
      // Fill from the target when there is one; otherwise send the user to the first box.
      const canFill = timed ? !!(t?.minutes || t?.distance) : !!t;
      if (!canFill) {
        cell.closest('tr')?.querySelector<HTMLInputElement>(timed ? 'input' : 'input[aria-label$="reps"]')?.focus();
        return;
      }
    }
    editSet(s.id, (x) => {
      if (willBeDone && !hasValue(x) && t) {
        if (timed) {
          if (!secs) x.durationSec = t.minutes ? Math.round(t.minutes * 60) : x.durationSec;
          x.distance = t.distance ?? x.distance;
        } else x.reps = t.repMax;
      }
      // A timed sprint with no distance typed uses the target distance.
      if (willBeDone && timed && x.distance == null && t?.distance) x.distance = t.distance;
      x.done = willBeDone;
    });
    // Rest after a lift set; for timed work (sprints, intervals) only when more rounds are left.
    const roundsLeft = log.sets.some((x) => x.id !== s.id && !x.done);
    if (willBeDone && (!timed || roundsLeft)) onSetDone(rest, ex?.name ?? '');
  };

  return (
    <div className="card ex-card">
      <div className="row spread">
        <div className="grow">
          <h3 style={{ margin: 0 }}>{ex?.name ?? log.exerciseId}</h3>
          <div className="small muted row wrap" style={{ gap: 6 }}>
            <span>{targetText() ?? (timed ? 'Time & distance' : 'Weight & reps')}</span>
            <RestSelect value={rest} onChange={(v) => editLog((l) => void (l.restSec = v))} />
          </div>
          {otherNote && <div className="small muted">{otherNote}</div>}
        </div>
        <div className="row" style={{ gap: 0 }}>
          <button
            className="btn ghost small"
            title="Switch between weight & reps and time & distance"
            aria-label={timed ? 'Track by weight and reps' : 'Track by time and distance'}
            onClick={() => editLog((l) => void (l.metric = timed ? 'weight_reps' : 'time_distance'))}
          >
            {timed ? '⏱' : '🏋'}⇄
          </button>
          <button className="btn ghost small" disabled={index === 0} onClick={() => move(-1)} aria-label="Move up">↑</button>
          <button className="btn ghost small" disabled={index === count - 1} onClick={() => move(1)} aria-label="Move down">↓</button>
          <button
            className="btn ghost small danger"
            aria-label="Remove exercise"
            onClick={() => confirm(`Remove ${ex?.name ?? 'exercise'}?`) && editActive((a) => void (a.exercises = a.exercises.filter((x) => x.id !== log.id)))}
          >
            ✕
          </button>
        </div>
      </div>
      <table className="sets">
        <thead>
          <tr>
            <th>{timed ? '#' : 'Set'}</th>
            <th>Last</th>
            {timed ? (
              <>
                <th>{secs ? 'Sec' : 'Min'}</th>
                <th>{dUnit}</th>
              </>
            ) : (
              <>
                <th>{unit}</th>
                <th>Reps</th>
                <th title="Rate of perceived exertion, 1–10 (optional). 10 = nothing left, 8 = ~2 reps left">RPE</th>
              </>
            )}
            <th aria-label="Done" />
          </tr>
        </thead>
        <tbody>
          {log.sets.map((s, i) => (
            <tr key={s.id} className={s.done ? 'done' : ''}>
              <td className="n">{i + 1}</td>
              <td className="prev">{prevText(prev?.[i])}</td>
              {timed ? (
                <>
                  <td>
                    {secs ? (
                      <input type="number" inputMode="decimal" step="any" aria-label={`Round ${i + 1} seconds`}
                        value={s.durationSec ?? ''}
                        onChange={(e) => editSet(s.id, (x) => void (x.durationSec = num(e.target.value)))} />
                    ) : (
                      <input type="number" inputMode="decimal" step="any" aria-label={`Round ${i + 1} minutes`}
                        placeholder={t?.minutes ? String(t.minutes) : ''}
                        value={s.durationSec != null ? Math.round((s.durationSec / 60) * 100) / 100 : ''}
                        onChange={(e) => editSet(s.id, (x) => { const m = num(e.target.value); x.durationSec = m == null ? null : Math.round(m * 60); })} />
                    )}
                  </td>
                  <td>
                    <input type="number" inputMode="decimal" step="any" aria-label={`Round ${i + 1} distance`}
                      placeholder={t?.distance ? String(t.distance) : ''} value={s.distance ?? ''}
                      onChange={(e) => editSet(s.id, (x) => void (x.distance = num(e.target.value)))} />
                  </td>
                </>
              ) : (
                <>
                  <td>
                    <input type="number" inputMode="decimal" step="any" aria-label={`Set ${i + 1} weight`} value={s.weight ?? ''}
                      onChange={(e) => editSet(s.id, (x) => void (x.weight = num(e.target.value)))} />
                  </td>
                  <td>
                    <input type="number" inputMode="numeric" aria-label={`Set ${i + 1} reps`}
                      placeholder={t ? String(t.repMax) : ''} value={s.reps ?? ''}
                      onChange={(e) => editSet(s.id, (x) => void (x.reps = num(e.target.value)))} />
                  </td>
                  <td style={{ width: 56 }}>
                    <input type="number" inputMode="decimal" step={0.5} min={1} max={10} aria-label={`Set ${i + 1} RPE`}
                      placeholder={t?.rpe != null ? String(t.rpe) : ''} value={s.rpe ?? ''}
                      onChange={(e) => editSet(s.id, (x) => { const v = num(e.target.value); x.rpe = v == null ? null : Math.min(10, Math.max(1, v)); })} />
                  </td>
                </>
              )}
              <td style={{ width: 44 }}>
                <button
                  className={`check ${s.done ? 'on' : ''}`}
                  aria-label={s.done ? 'Mark set not done' : 'Mark set done'}
                  onClick={(ev) => toggleDone(s, ev.currentTarget)}
                >
                  ✓
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => editLog((l) => void l.sets.push(newSet(timed ? null : l.sets.at(-1)?.weight ?? null)))}>
          + {timed ? 'Round' : 'Set'}
        </button>
        {log.sets.length > 1 && (
          <button className="btn small ghost" onClick={() => editLog((l) => void l.sets.pop())}>− Remove last</button>
        )}
      </div>
    </div>
  );
}

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360];

export function fmtRest(sec: number): string {
  if (!sec) return 'Off';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compact rest-time picker: "⏲ 1:30". */
export function RestSelect({ value, onChange, label = true }: { value: number; onChange: (sec: number) => void; label?: boolean }) {
  const opts = REST_OPTIONS.includes(value) ? REST_OPTIONS : [...REST_OPTIONS, value].sort((a, b) => a - b);
  return (
    <label className="rest-select" title="Rest timer between sets">
      {label && <span aria-hidden>⏲</span>}
      <select aria-label="Rest between sets" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {opts.map((o) => <option key={o} value={o}>{fmtRest(o)}</option>)}
      </select>
    </label>
  );
}

/**
 * Default rest for an exercise when none is set: sprints get 3 min (full recovery,
 * roughly 1 min per 10 m sprinted); everything else uses the app default.
 */
export function defaultRestFor(ex: { timeUnit?: string } | undefined, appDefault: number): number {
  return ex?.timeUnit === 'sec' ? Math.max(180, appDefault) : appDefault;
}
