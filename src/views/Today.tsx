import { useMemo, useRef, useState } from 'react';
import { exerciseName } from '../data/exercises';
import { isoDate, snapshot } from '../lib/analytics';
import { PRINCIPLES } from '../lib/evidence';
import { recommend } from '../lib/llm';
import { startSession, uid, update, useAppState } from '../store';
import type { Muscle } from '../types';

const SHOWN_MUSCLES: Muscle[] = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps'];

export function Today({ goWorkout, goSettings }: { goWorkout: () => void; goSettings: () => void }) {
  const state = useAppState();
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState('');
  const abort = useRef<AbortController | null>(null);
  const snap = useMemo(() => snapshot(state.sessions, state.profile, state.customExercises), [state.sessions, state.profile, state.customExercises]);
  const rec = state.recommendation;
  const stale = rec && isoDate(new Date(rec.createdAt)) !== isoDate(new Date());

  const ask = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setLoading(true);
    try {
      const r = await recommend(
        { profile: state.profile, unit: state.unit, sessions: state.sessions, customExercises: state.customExercises },
        state.llm,
        request,
        ctl.signal,
      );
      update((d) => void (d.recommendation = r));
    } catch {
      // aborted
    } finally {
      if (abort.current === ctl) setLoading(false);
    }
  };

  const begin = (name: string, exercises: Parameters<typeof startSession>[1], source: 'blank' | 'template' | 'coach', templateId?: string) => {
    if (state.active && !confirm('A workout is already in progress. Replace it?')) return;
    startSession(name, exercises, source, templateId);
    goWorkout();
  };

  const maxWeek = Math.max(state.profile.daysPerWeek, ...snap.weeks.map((w) => w.sessions));

  return (
    <div className="stack">
      {state.active && (
        <div className="card accent row spread">
          <div>
            <h3 style={{ margin: 0 }}>{state.active.name}</h3>
            <span className="small muted">Workout in progress</span>
          </div>
          <button className="btn primary" onClick={goWorkout}>Resume</button>
        </div>
      )}

      {/* Where you stand — computed locally, always up to date */}
      <div className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>This week</h2>
          <span className="tag">{snap.thisWeek.sessions}/{state.profile.daysPerWeek} sessions</span>
        </div>
        <p className="small" style={{ marginTop: 4 }}>{snap.statusText}</p>
        <div className="weeks" aria-label="Sessions per week, last 5 weeks">
          {snap.weeks.map((w, i) => (
            <div className={`w ${i === snap.weeks.length - 1 ? 'cur' : ''}`} key={w.weekOf} title={`Week of ${w.weekOf}: ${w.sessions} sessions`}>
              <div className="col"><i style={{ height: `${(w.sessions / maxWeek) * 100}%` }} /></div>
              <span>{i === snap.weeks.length - 1 ? 'Now' : new Date(w.weekOf + 'T00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</span>
            </div>
          ))}
        </div>
        <h3 style={{ marginTop: 14 }}>Hard sets this week <span className="muted small">(target {snap.setTarget.min}–{snap.setTarget.max})</span></h3>
        <div className="bars">
          {SHOWN_MUSCLES.map((m) => {
            const v = snap.thisWeek.setsPerMuscle[m];
            const scale = snap.setTarget.max * 1.2;
            return (
              <FragmentRow key={m} label={m} value={v} pct={Math.min(100, (v / scale) * 100)} target={(snap.setTarget.min / scale) * 100} />
            );
          })}
        </div>
      </div>

      {/* Coach */}
      <div className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Coach</h2>
          {rec && <span className="tag">{rec.source === 'llm' ? `AI · ${rec.model}` : 'Built-in rules'}</span>}
        </div>

        {!rec && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Get a plan for this week and today, based on your history and training research.
            {state.llm.enabled ? ` Uses ${state.llm.model} at ${state.llm.baseUrl}.` : ' AI is off, so the built-in planner will be used.'}
          </p>
        )}

        {rec && (
          <div className="stack" style={{ marginTop: 8 }}>
            {rec.warning && (
              <div className="banner warn">
                {rec.warning}{' '}
                <button className="btn small ghost" onClick={goSettings}>AI settings</button>
              </div>
            )}
            {stale && <div className="banner info">This plan is from {new Date(rec.createdAt).toLocaleDateString()}. Refresh for today.</div>}
            <div>
              <h3 style={{ fontSize: 17 }}>{rec.headline}</h3>
              <p className="small">{rec.summary}</p>
            </div>
            <div className="plan-days">
              {rec.weekPlan.map((d, i) => (
                <div key={i} className={/rest|walk|off/i.test(d.focus) ? '' : 'train'}>
                  <b>{d.day.replace(/^Today \((\w+)\)$/, 'Today')}</b>
                  {d.focus}
                </div>
              ))}
            </div>
            <div>
              <h3>Today: {rec.today.name}</h3>
              <ul className="list">
                {rec.today.exercises.map((e, i) => (
                  <li key={i} className="row spread">
                    <div className="grow">
                      <div>{exerciseName(e.exerciseId, state.customExercises)}</div>
                      {e.note && <div className="small muted">{e.note}</div>}
                    </div>
                    <div className="small" style={{ textAlign: 'right' }}>
                      {e.sets} × {e.repMin === e.repMax ? e.repMin : `${e.repMin}–${e.repMax}`}
                      <div className="muted">{e.weight != null ? `${e.weight} ${state.unit}` : 'find weight'}{e.rir != null ? ` · RIR ${e.rir}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="row wrap">
              <button className="btn primary grow" onClick={() => begin(rec.today.name, rec.today.exercises, 'coach')}>Start this workout</button>
              <button
                className="btn"
                onClick={() => {
                  update((d) => void d.templates.push({ id: uid(), name: rec.today.name, exercises: rec.today.exercises, updatedAt: new Date().toISOString() }));
                  alert(`Saved "${rec.today.name}" to your workouts.`);
                }}
              >
                Save
              </button>
            </div>
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>Why this plan</summary>
              <ul className="bullets">{rec.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </details>
          </div>
        )}

        <div className="stack" style={{ marginTop: 12 }}>
          <input
            type="text"
            placeholder="Anything for today? e.g. only 30 min, sore shoulder (optional)"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && ask()}
          />
          <button className="btn block" onClick={ask} disabled={loading}>
            {loading ? <><span className="spinner" /> Thinking…</> : rec ? 'Refresh plan' : 'Plan my week'}
          </button>
        </div>
      </div>

      {/* Quick start */}
      <div className="card">
        <h2>Start a workout</h2>
        <div className="stack">
          <button className="btn block" onClick={() => begin('Workout', [], 'blank')}>Empty workout — add exercises as you go</button>
          {state.templates.map((t) => (
            <button key={t.id} className="btn block" style={{ textAlign: 'left' }} onClick={() => begin(t.name, t.exercises, 'template', t.id)}>
              ▶ {t.name} <span className="muted small">· {t.exercises.length} exercises</span>
            </button>
          ))}
        </div>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer' }}><b>The evidence behind the coach</b></summary>
        <ul className="bullets">
          {PRINCIPLES.map((p) => (
            <li key={p.id}>{p.rule} <span className="muted">— {p.source}</span></li>
          ))}
        </ul>
        <p className="small muted" style={{ marginTop: 8 }}>General fitness guidance, not medical advice.</p>
      </details>
    </div>
  );
}

function FragmentRow({ label, value, pct, target }: { label: string; value: number; pct: number; target: number }) {
  return (
    <>
      <span style={{ textTransform: 'capitalize' }}>{label}</span>
      <div className="bar"><i style={{ width: `${pct}%` }} /><b style={{ left: `${target}%` }} /></div>
      <span className="muted" style={{ textAlign: 'right' }}>{Number.isInteger(value) ? value : value.toFixed(1)}</span>
    </>
  );
}
