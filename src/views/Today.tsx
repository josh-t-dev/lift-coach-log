import { useMemo, useRef, useState } from 'react';
import { BarList } from '../components/Charts';
import { exerciseName, findExercise, metricOf } from '../data/exercises';
import type { AppState, Recommendation, TemplateExercise, WeekPlanDay } from '../types';
import { blockWeek, isoDate, snapshot } from '../lib/analytics';
import { isDaily, planDaysOn, startablePlanDay } from '../lib/planner';
import { recommend } from '../lib/llm';
import { presetOf } from '../lib/providers';
import { startSession, uid, update, useAppState } from '../store';
import type { Muscle } from '../types';

const SHOWN_MUSCLES: Muscle[] = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps'];

export function Today({ goWorkout, goSettings, goPlan }: { goWorkout: () => void; goSettings: () => void; goPlan: () => void }) {
  const state = useAppState();
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState('');
  const abort = useRef<AbortController | null>(null);
  const plan = state.plan;
  const snap = useMemo(() => snapshot(state.sessions, plan, state.customExercises), [state.sessions, plan, state.customExercises]);
  const reviewDue = plan.reviewDate <= isoDate(new Date());
  const todaysActivities = (plan.activities ?? []).filter((a) => a.weekdays.includes(new Date().getDay()));
  const todaysDays = planDaysOn(plan.days, new Date()).sort((a, b) => Number(isDaily(b)) - Number(isDaily(a)));
  const doneToday = new Set(state.sessions.filter((x) => x.finishedAt && isoDate(new Date(x.startedAt)) === isoDate(new Date())).map((x) => x.name));
  const block = blockWeek(plan);
  const weekNote = plan.weekNotes?.[block.week - 1];
  const rec = state.recommendation;
  const stale = rec && isoDate(new Date(rec.createdAt)) !== isoDate(new Date());

  const ask = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setLoading(true);
    try {
      const r = await recommend(
        { plan, unit: state.unit, distanceUnit: state.distanceUnit, sessions: state.sessions, customExercises: state.customExercises },
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

  const maxWeek = Math.max(plan.profile.daysPerWeek, ...snap.weeks.map((w) => w.sessions));

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

      {block.total > 1 && block.total <= 16 && (
        <div className="small">
          <b>Week {block.week} of {block.total}</b> · {plan.name}{weekNote ? ` · ${weekNote}` : ''}
        </div>
      )}

      {todaysDays.length > 0 && (
        <div className="card">
          <h2>Today's plan</h2>
          <ul className="list">
            {todaysDays.map((d) => {
              const built = startablePlanDay(d, plan, state.unit, state.sessions, state.customExercises);
              const done = doneToday.has(d.name);
              return (
                <li key={d.id} className="row spread" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <b>{d.name}</b> {done && <span className="badge">Done</span>}
                    {d.note && <div className="small">{d.note}</div>}
                    <div className="small muted">
                      {built.exercises.filter((e) => e.note?.startsWith(`W${block.week}:`)).map((e) => `${exerciseName(e.exerciseId, state.customExercises)} ${e.note!.split(' — ')[0].replace(/^W\d+: /, '')}`).join(' · ')
                        || summarize(built.exercises.map((e) => exerciseName(e.exerciseId, state.customExercises)))}
                    </div>
                  </div>
                  <button className={`btn ${done ? '' : 'primary'}`} onClick={() => begin(d.name, built.exercises, 'template')}>{done ? 'Again' : 'Start'}</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {todaysActivities.map((a) => (
        <div className="card row spread" key={a.id} style={{ borderColor: 'var(--warn)' }}>
          <div>
            <h3 style={{ margin: 0 }}>Today: {exerciseName(a.exerciseId, state.customExercises)}</h3>
            <span className="small muted">{a.minutes} min · {a.intensity} · counts toward cardio</span>
          </div>
          <button className="btn" onClick={() => begin(exerciseName(a.exerciseId, state.customExercises), [{ exerciseId: a.exerciseId, metric: 'time_distance', sets: 1, repMin: 0, repMax: 0, minutes: a.minutes }], 'template')}>
            Log it
          </button>
        </div>
      ))}

      {reviewDue && (
        <div className="banner warn row spread">
          <span>Your plan "{plan.name}" is due for review.</span>
          <button className="btn small" onClick={goPlan}>Review plan</button>
        </div>
      )}

      {/* Where you stand — computed locally, always up to date */}
      <div className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>This week</h2>
          <span className="tag">{snap.thisWeek.sessions}/{plan.profile.daysPerWeek} sessions</span>
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
        <h3 style={{ marginTop: 14 }}>Hard sets this week <span className="muted small">(tick = plan target)</span></h3>
        <BarList rows={SHOWN_MUSCLES.map((m) => ({ label: m, value: snap.thisWeek.setsPerMuscle[m], target: snap.setTargets[m] }))} />
        {snap.cardioTarget > 0 && (
          <div style={{ marginTop: 6 }}>
            <BarList rows={[{ label: 'Cardio min', value: snap.thisWeek.cardioMinutes, target: snap.cardioTarget }]} />
          </div>
        )}
      </div>

      {/* Coach */}
      <div className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Coach</h2>
          {rec && <span className="tag">{rec.source === 'llm' ? `AI · ${rec.model}` : 'Built-in rules'}</span>}
        </div>

        {!rec && (
          <p className="small muted" style={{ marginTop: 6 }}>
            Get this week's schedule and today's workout, built from your base plan and adjusted for how your training has gone.
            <br />
            Plan: <button className="link" onClick={goPlan}>{plan.name}</button>
            {' · '}
            {state.llm.enabled ? (
              <>AI: <button className="link" onClick={goSettings}>{presetOf(state.llm).label.split(' — ')[0]} · {state.llm.model}</button></>
            ) : (
              <>AI: <button className="link" onClick={goSettings}>off (built-in planner)</button></>
            )}
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
              {rec.planName && <div className="small muted" style={{ marginBottom: 4 }}>From your plan: <button className="btn small ghost" style={{ padding: 0, minHeight: 0 }} onClick={goPlan}>{rec.planName}</button></div>}
              <p className="small">{rec.summary}</p>
            </div>
            <WeekStrip days={rec.weekPlan} />
            <div>
              <h3>{nextLabel(rec)}: {rec.today.name}</h3>
              <ul className="list">
                {rec.today.exercises.map((e, i) => (
                  <li key={i} className="row spread">
                    <div className="grow">
                      <div>{exerciseName(e.exerciseId, state.customExercises)}</div>
                      {e.note && <div className="small muted">{e.note}</div>}
                    </div>
                    {metricOf(e, state.customExercises) === 'time_distance' ? (
                      <div className="small" style={{ textAlign: 'right' }}>
                        {timedTarget(e, state) || 'time & distance'}
                      </div>
                    ) : (
                      <div className="small" style={{ textAlign: 'right' }}>
                        {e.sets} × {e.repMin === e.repMax ? e.repMin : `${e.repMin}–${e.repMax}`}
                        {loadText(e, state) && <div className="muted">{loadText(e, state)}</div>}
                      </div>
                    )}
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

      <button className="btn block ghost" onClick={goPlan}>Edit your base plan & the evidence behind it →</button>
    </div>
  );
}

function summarize(names: string[], max = 4): string {
  return names.length <= max ? names.join(' · ') : `${names.slice(0, max).join(' · ')} +${names.length - max} more`;
}


/** "80 kg · RPE 8" for loaded lifts; nothing for bodyweight drills. */
function loadText(e: TemplateExercise, state: AppState): string {
  const ex = findExercise(e.exerciseId, state.customExercises);
  const loaded = ex && ex.equipment !== 'bodyweight';
  const parts = [e.weight != null ? `${e.weight} ${state.unit}` : loaded ? 'find weight' : '', e.rpe != null ? `RPE ${e.rpe}` : ''];
  return parts.filter(Boolean).join(' · ');
}

const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday (0 = Sun) for a plan label like "Today (Sun)", "Mon" or "Wednesday". */
function weekdayOf(label: string): number {
  const m = label.match(/(sun|mon|tue|wed|thu|fri|sat)/i);
  if (m) return WD3.findIndex((w) => w.toLowerCase() === m[1].toLowerCase());
  return /^today/i.test(label) ? new Date().getDay() : -1;
}

/** The week as two rows: Mon–Fri, then Sat–Sun. Today is highlighted. */
function WeekStrip({ days }: { days: WeekPlanDay[] }) {
  const today = new Date().getDay();
  const byDay = new Map<number, WeekPlanDay>();
  for (const d of days) {
    const w = weekdayOf(d.day);
    if (w >= 0 && !byDay.has(w)) byDay.set(w, d);
  }
  const cell = (w: number) => {
    const d = byDay.get(w);
    const rest = !d || /rest|walk|off/i.test(d.focus) || d.focus === d.activity;
    return (
      <div key={w} className={`${rest ? '' : 'train'} ${d?.activity ? 'activity' : ''} ${w === today ? 'today' : ''}`}>
        <b>{w === today ? 'Today' : WD3[w]}</b>
        {d ? d.focus.replace(/ \d+ min/g, '') : '—'}
        {d?.activity && d.activity !== d.focus && <i>+ {d.activity.replace(/ \d+ min/g, '')}</i>}
      </div>
    );
  };
  return (
    <div className="week-strip" aria-label="This week">
      <div className="plan-days wk5">{[1, 2, 3, 4, 5].map(cell)}</div>
      <div className="plan-days wk2">{[6, 0].map(cell)}</div>
    </div>
  );
}

/** "Today" when today's scheduled session is the one shown, else "Next session (Mon)". */
function nextLabel(rec: Recommendation): string {
  const has = (d?: WeekPlanDay) => !!d && d.focus.split(' + ').some((f) => rec.today.name.toLowerCase().startsWith(f.toLowerCase()));
  if (has(rec.weekPlan[0])) return 'Today';
  const idx = rec.weekPlan.findIndex(has);
  const day = idx > 0 ? rec.weekPlan[idx].day.replace(/^Today \((\w+)\)$/, '$1').slice(0, 3) : '';
  return day ? `Next session (${day})` : 'Next session';
}

/** "40 min · 8 km" for runs, "6 × 20 m" for sprints. */
function timedTarget(e: TemplateExercise, state: AppState): string {
  const ex = findExercise(e.exerciseId, state.customExercises);
  if (ex?.distUnit === 'm') return e.distance ? `${e.sets} × ${e.distance} m` : `${e.sets} reps`;
  return [e.minutes ? `${e.minutes} min` : '', e.distance ? `${e.distance} ${state.distanceUnit}` : ''].filter(Boolean).join(' · ');
}
