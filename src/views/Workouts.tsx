import { useState } from 'react';
import { ExercisePicker } from '../components/ExercisePicker';
import { exerciseName, findExercise, metricOf } from '../data/exercises';
import { startSession, uid, update, useAppState } from '../store';
import type { Template, TemplateExercise } from '../types';
import { fmtRest } from './ActiveWorkout';

/** "3×8–12" or "20 min · 5 km" */
export function describeTarget(e: TemplateExercise, metric: string, distUnit: string): string {
  if (metric === 'time_distance') {
    const parts = [e.minutes ? `${e.minutes} min` : '', e.distance ? `${e.distance} ${distUnit}` : ''].filter(Boolean);
    return parts.join(' · ') || 'time / distance';
  }
  return `${e.sets}×${e.repMin}${e.repMax !== e.repMin ? `–${e.repMax}` : ''}`;
}

export function Workouts({ onStart }: { onStart: () => void }) {
  const state = useAppState();
  const [editing, setEditing] = useState<Template | null>(null);

  if (editing) {
    return (
      <WorkoutEditor
        title={editing.updatedAt ? 'Edit workout' : 'New workout'}
        initial={editing}
        onCancel={() => setEditing(null)}
        onSave={(t) => {
          update((d) => {
            const i = d.templates.findIndex((x) => x.id === t.id);
            const saved = { ...t, updatedAt: new Date().toISOString() };
            if (i === -1) d.templates.push(saved);
            else d.templates[i] = saved;
          });
          setEditing(null);
        }}
      />
    );
  }

  const start = (t: Template) => {
    if (state.active && !confirm('A workout is already in progress. Replace it?')) return;
    startSession(t.name, t.exercises, 'template', t.id);
    onStart();
  };

  return (
    <div className="stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Saved workouts</h2>
        <button className="btn primary" onClick={() => setEditing({ id: uid(), name: '', exercises: [], updatedAt: '' })}>+ New</button>
      </div>
      {!state.templates.length && (
        <div className="card muted">
          No saved workouts yet. Create one here, save one from the coach's plan, or save a finished workout from Progress.
        </div>
      )}
      {state.templates.map((t) => (
        <div className="card" key={t.id}>
          <div className="row spread">
            <h3 style={{ margin: 0 }}>{t.name || 'Untitled'}</h3>
            <span className="tag">{t.exercises.length} exercises</span>
          </div>
          <p className="small muted" style={{ margin: '6px 0 10px' }}>
            {t.exercises.map((e) => `${exerciseName(e.exerciseId, state.customExercises)} ${describeTarget(e, metricOf(e, state.customExercises), state.distanceUnit)}`).join(' · ') || 'Empty'}
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => start(t)}>Start</button>
            <button className="btn" onClick={() => setEditing(structuredClone(t))}>Edit</button>
            <button className="btn ghost danger" onClick={() => confirm(`Delete "${t.name}"?`) && update((d) => void (d.templates = d.templates.filter((x) => x.id !== t.id)))}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

interface Editable {
  id: string;
  name: string;
  exercises: TemplateExercise[];
  weekdays?: number[];
  note?: string;
}

const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Edit a named list of exercises — used for saved workouts and Base Plan days. */
export function WorkoutEditor<T extends Editable>({
  title,
  initial,
  onSave,
  onCancel,
  saveLabel = 'Save workout',
  schedule = false,
  blockWeeks = 0,
}: {
  title: string;
  initial: T;
  onSave: (t: T) => void;
  onCancel: () => void;
  saveLabel?: string;
  /** Show weekday + note fields (Base Plan days). */
  schedule?: boolean;
  /** Weeks in the plan's block; enables week-by-week prescriptions. */
  blockWeeks?: number;
}) {
  const state = useAppState();
  const [t, setT] = useState<T>(initial);
  const [picking, setPicking] = useState(false);
  const setEx = (i: number, patch: Partial<TemplateExercise>) =>
    setT({ ...t, exercises: t.exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const n = (v: string, d: number) => (v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const opt = (v: string) => (v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= t.exercises.length) return;
    const ex = [...t.exercises];
    [ex[i], ex[j]] = [ex[j], ex[i]];
    setT({ ...t, exercises: ex });
  };

  return (
    <div className="stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
      <label className="field">
        <span>Name</span>
        <input type="text" value={t.name} placeholder="e.g. Upper A" onChange={(e) => setT({ ...t, name: e.target.value })} autoFocus={!initial.name} />
      </label>
      {schedule && (
        <>
          <div>
            <span className="muted small">Fixed days (leave empty to rotate into free days; pick all 7 for a daily routine)</span>
            <div className="weekday-chips" role="group" aria-label="Fixed days" style={{ marginTop: 4 }}>
              {WD_ORDER.map((w) => {
                const on = !!t.weekdays?.includes(w);
                return (
                  <button key={w} className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
                    onClick={() => setT({ ...t, weekdays: on ? t.weekdays!.filter((x) => x !== w) : [...(t.weekdays ?? []), w].sort() })}>
                    {WD[w]}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="field"><span>Day note (order, time limit, rules)</span>
            <input type="text" value={t.note ?? ''} placeholder="e.g. Sprint first, lift after. 75 min." onChange={(e) => setT({ ...t, note: e.target.value || undefined })} />
          </label>
        </>
      )}
      {t.exercises.map((e, i) => {
        const metric = metricOf(e, state.customExercises);
        return (
          <div className="card" key={`${e.exerciseId}-${i}`}>
            <div className="row spread">
              <h3 style={{ margin: 0 }} className="grow">{exerciseName(e.exerciseId, state.customExercises)}</h3>
              <button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button className="btn ghost small" disabled={i === t.exercises.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button className="btn ghost small danger" aria-label="Remove" onClick={() => setT({ ...t, exercises: t.exercises.filter((_, j) => j !== i) })}>✕</button>
            </div>
            <MetricToggle value={metric} onChange={(m) => setEx(i, m === 'time_distance' ? { metric: m, sets: 1 } : { metric: m, sets: Math.max(e.sets, 3), repMin: e.repMin || 8, repMax: e.repMax || 12 })} />
            {metric === 'weight_reps' ? (
              <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 8 }}>
                <label className="field"><span>Sets</span>
                  <input type="number" inputMode="numeric" value={e.sets} onChange={(ev) => setEx(i, { sets: Math.max(1, n(ev.target.value, 1)) })} /></label>
                <label className="field"><span>Reps min</span>
                  <input type="number" inputMode="numeric" value={e.repMin} onChange={(ev) => setEx(i, { repMin: n(ev.target.value, 1) })} /></label>
                <label className="field"><span>Reps max</span>
                  <input type="number" inputMode="numeric" value={e.repMax} onChange={(ev) => setEx(i, { repMax: n(ev.target.value, 1) })} /></label>
                <label className="field"><span>{state.unit}</span>
                  <input type="number" inputMode="decimal" step="any" value={e.weight ?? ''} onChange={(ev) => setEx(i, { weight: opt(ev.target.value) })} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Target effort</span>
                  <select value={e.rpe ?? ''} onChange={(ev) => setEx(i, { rpe: ev.target.value === '' ? undefined : Number(ev.target.value) })}>
                    <option value="">Plan default</option>
                    {RPE_OPTIONS.map((r) => <option key={r} value={r}>RPE {r} — {rpeHint(r)}</option>)}
                  </select></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Rest between sets</span>
                  <select value={e.restSec ?? ''} onChange={(ev) => setEx(i, { restSec: ev.target.value === '' ? undefined : Number(ev.target.value) })}>
                    <option value="">Default ({fmtRest(state.defaultRestSec)})</option>
                    {[30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((r) => <option key={r} value={r}>{fmtRest(r)}</option>)}
                  </select></label>
              </div>
            ) : findExercise(e.exerciseId, state.customExercises)?.timeUnit === 'sec' ? (
              <div className="grid2" style={{ marginTop: 8 }}>
                <label className="field"><span>Reps</span>
                  <input type="number" inputMode="numeric" value={e.sets} onChange={(ev) => setEx(i, { sets: Math.max(1, n(ev.target.value, 1)) })} /></label>
                <label className="field"><span>Distance (m)</span>
                  <input type="number" inputMode="decimal" step="any" value={e.distance ?? ''} onChange={(ev) => setEx(i, { distance: opt(ev.target.value) })} /></label>
              </div>
            ) : (
              <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 8 }}>
                <label className="field"><span>Rounds</span>
                  <input type="number" inputMode="numeric" value={e.sets} onChange={(ev) => setEx(i, { sets: Math.max(1, n(ev.target.value, 1)) })} /></label>
                <label className="field"><span>Minutes</span>
                  <input type="number" inputMode="decimal" step="any" value={e.minutes ?? ''} onChange={(ev) => setEx(i, { minutes: opt(ev.target.value) })} /></label>
                <label className="field"><span>Distance ({state.distanceUnit})</span>
                  <input type="number" inputMode="decimal" step="any" value={e.distance ?? ''} onChange={(ev) => setEx(i, { distance: opt(ev.target.value) })} /></label>
              </div>
            )}
            <label className="field" style={{ marginTop: 8 }}><span>Note</span>
              <input type="text" value={e.note ?? ''} placeholder="Cue, tempo, swap…" onChange={(ev) => setEx(i, { note: ev.target.value || undefined })} />
            </label>
            {blockWeeks > 1 && (
              <details style={{ marginTop: 8 }} open={!!e.weekly?.some(Boolean)}>
                <summary className="small" style={{ cursor: 'pointer' }}>Week-by-week ({e.weekly?.filter(Boolean).length ?? 0}/{blockWeeks})</summary>
                <div className="stack" style={{ marginTop: 6 }}>
                  {Array.from({ length: blockWeeks }, (_, w) => (
                    <label key={w} className="row small">
                      <span style={{ width: 28 }}>W{w + 1}</span>
                      <input type="text" value={e.weekly?.[w] ?? ''} placeholder="e.g. 4×5 @ 80%"
                        onChange={(ev) => {
                          const weekly = Array.from({ length: blockWeeks }, (_, k) => e.weekly?.[k] ?? '');
                          weekly[w] = ev.target.value;
                          setEx(i, { weekly: weekly.some((x) => x.trim()) ? weekly : undefined });
                        }} />
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
      <button className="btn block" onClick={() => setPicking(true)}>+ Add exercise</button>
      <button
        className="btn primary block"
        disabled={!t.name.trim() || !t.exercises.length}
        onClick={() => onSave({ ...t, name: t.name.trim(), exercises: t.exercises.map((e) => ({ ...e, repMax: Math.max(e.repMin, e.repMax) })) })}
      >
        {saveLabel}
      </button>
      {picking && (
        <ExercisePicker
          onClose={() => setPicking(false)}
          onPick={(ex, metric) => {
            const item: TemplateExercise =
              metric === 'time_distance'
                ? { exerciseId: ex.id, metric, sets: 1, repMin: 0, repMax: 0, minutes: ex.cardio ? 20 : null, distance: null }
                : { exerciseId: ex.id, metric, sets: 3, repMin: ex.compound ? 6 : 10, repMax: ex.compound ? 10 : 15, weight: null };
            setT({ ...t, exercises: [...t.exercises, item] });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

export function MetricToggle({ value, onChange }: { value: string; onChange: (m: 'weight_reps' | 'time_distance') => void }) {
  return (
    <div className="segmented" role="group" aria-label="Track by" style={{ marginTop: 8 }}>
      <button className={value === 'weight_reps' ? 'on' : ''} aria-pressed={value === 'weight_reps'} onClick={() => onChange('weight_reps')}>Weight & reps</button>
      <button className={value === 'time_distance' ? 'on' : ''} aria-pressed={value === 'time_distance'} onClick={() => onChange('time_distance')}>Time & distance</button>
    </div>
  );
}

export const RPE_OPTIONS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** RPE in plain words (RIR-based scale). */
export function rpeHint(r: number): string {
  if (r >= 10) return 'nothing left';
  const left = 10 - r;
  return Number.isInteger(left) ? `${left} rep${left === 1 ? '' : 's'} left` : `${Math.floor(left)}–${Math.ceil(left)} reps left`;
}
