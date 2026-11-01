import { useEffect, useMemo, useState } from 'react';
import { ExercisePicker } from '../components/ExercisePicker';
import { findExercise } from '../data/exercises';
import { exerciseHistory, isWorkingSet } from '../lib/analytics';
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
          prev={hist.get(log.exerciseId)?.lastSets}
          onSetDone={(isCompound) => setRestUntil(Date.now() + (isCompound ? 150 : 90) * 1000)}
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
          onPick={(ex) => {
            const last = hist.get(ex.id)?.lastSets.at(-1);
            editActive((a) =>
              a.exercises.push({ id: uid(), exerciseId: ex.id, sets: [newSet(last?.weight ?? null), newSet(last?.weight ?? null), newSet(last?.weight ?? null)] }),
            );
            setPicking(false);
          }}
        />
      )}

      {restUntil && (
        <div className="rest" role="status">
          <span>Rest {mmss((restUntil - now) / 1000)}</span>
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
  prev,
  onSetDone,
}: {
  log: ExerciseLog;
  index: number;
  count: number;
  unit: string;
  prev?: { weight: number; reps: number }[];
  onSetDone: (compound: boolean) => void;
}) {
  const state = useAppState();
  const ex = findExercise(log.exerciseId, state.customExercises);
  const t = log.target;

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

  return (
    <div className="card ex-card">
      <div className="row spread">
        <div className="grow">
          <h3 style={{ margin: 0 }}>{ex?.name ?? log.exerciseId}</h3>
          {t && (
            <div className="small muted">
              Target {log.sets.length} × {t.repMin === t.repMax ? t.repMin : `${t.repMin}–${t.repMax}`}
              {t.rir != null ? ` · ${t.rir} reps in reserve` : ''}
            </div>
          )}
          {log.note && <div className="small muted">{log.note}</div>}
        </div>
        <div className="row" style={{ gap: 0 }}>
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
            <th>Set</th>
            <th>Last</th>
            <th>{unit}</th>
            <th>Reps</th>
            <th title="Reps in reserve (optional)">RIR</th>
            <th aria-label="Done" />
          </tr>
        </thead>
        <tbody>
          {log.sets.map((s, i) => (
            <tr key={s.id} className={s.done ? 'done' : ''}>
              <td className="n">{i + 1}</td>
              <td className="prev">{prev?.[i] ? `${prev[i].weight}×${prev[i].reps}` : '—'}</td>
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
                <input type="number" inputMode="numeric" aria-label={`Set ${i + 1} reps in reserve`} value={s.rir ?? ''}
                  onChange={(e) => editSet(s.id, (x) => void (x.rir = num(e.target.value)))} />
              </td>
              <td style={{ width: 44 }}>
                <button
                  className={`check ${s.done ? 'on' : ''}`}
                  aria-label={s.done ? 'Mark set not done' : 'Mark set done'}
                  onClick={(ev) => {
                    const willBeDone = !s.done;
                    // A set needs a rep count to count; send the user to the reps box instead.
                    if (willBeDone && s.reps == null && !t) {
                      ev.currentTarget.closest('tr')?.querySelector<HTMLInputElement>('input[aria-label$="reps"]')?.focus();
                      return;
                    }
                    editSet(s.id, (x) => {
                      // Ticking an empty reps box uses the target as the rep count.
                      if (willBeDone && x.reps == null && t) x.reps = t.repMax;
                      x.done = willBeDone;
                    });
                    if (willBeDone) onSetDone(!!ex?.compound);
                  }}
                >
                  ✓
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => editLog((l) => void l.sets.push(newSet(l.sets.at(-1)?.weight ?? null)))}>+ Set</button>
        {log.sets.length > 1 && (
          <button className="btn small ghost" onClick={() => editLog((l) => void l.sets.pop())}>− Remove last</button>
        )}
      </div>
    </div>
  );
}
