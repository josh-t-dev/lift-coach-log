import { useMemo, useRef, useState } from 'react';
import { BarList } from '../components/Charts';
import { exerciseName, findExercise, metricOf } from '../data/exercises';
import type { AppState, Recommendation, TemplateExercise, WeekPlanDay } from '../types';
import { blockWeek, isoDate, snapshot, weekStart } from '../lib/analytics';
import { upcomingChanges, weekView, type WeekCell } from '../lib/week';
import { isDaily, planDaysOn, startablePlanDay } from '../lib/planner';
import { recommend, sessionsIn } from '../lib/llm';
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
  const doneToday = new Set(state.sessions.filter((x) => x.finishedAt && isoDate(new Date(x.startedAt)) === isoDate(new Date())).map((x) => x.name));
  const block = blockWeek(plan);
  const weekNote = plan.weekNotes?.[block.week - 1];
  const rec = state.recommendation;
  const now = new Date();
  // A plan from an earlier week no longer applies; one from earlier this week
  // still carries its changes for the days ahead, but its "today" is stale.
  const recThisWeek = rec && new Date(rec.createdAt) >= weekStart(now) ? rec : null;
  const stale = !!recThisWeek && isoDate(new Date(recThisWeek.createdAt)) !== isoDate(now);
  const cells = useMemo(
    () => weekView(plan, state.sessions, recThisWeek, state.unit, state.customExercises),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, state.sessions, recThisWeek, state.unit, state.customExercises, isoDate(now)],
  );
  const todayCell = cells.find((c) => c.status === 'today');
  const changesAhead = upcomingChanges(recThisWeek, now);
  const noteSince = Math.min(weekStart(now).getTime(), now.getTime() - 3 * 86_400_000);
  const rememberedNotes = state.coachNotes.filter((n) => new Date(n.at).getTime() >= noteSince);
  // Today's plan follows the current week (incl. coach moves/changes), plus daily routines.
  const todayItems = useMemo(() => {
    const items: { key: string; label: string; sessionName: string; note?: string; exercises?: TemplateExercise[]; changed?: boolean; fromCoach?: boolean }[] = [];
    const today = new Date();
    for (const d of planDaysOn(plan.days, today).filter(isDaily)) {
      const built = startablePlanDay(d, plan, state.unit, state.sessions, state.customExercises, today);
      items.push({ key: d.id, label: d.name, sessionName: d.name, note: d.note, exercises: built.exercises });
    }
    if (todayCell && !/^rest\b/i.test(todayCell.focus) && todayCell.focus !== todayCell.activity) {
      const lc = (x: string) => x.toLowerCase();
      const names = sessionsIn(plan, todayCell.focus);
      const sessionName = names.length === 1 ? names[0] : todayCell.focus;
      const coachToday = recThisWeek?.today;
      const coachMatches =
        !!coachToday?.exercises.length &&
        (lc(todayCell.focus).includes(lc(coachToday.name)) || lc(coachToday.name).includes(lc(todayCell.focus)) || names.some((n) => lc(coachToday.name).includes(lc(n))));
      if (coachMatches) {
        items.push({ key: 'coach', label: todayCell.focus, sessionName, exercises: coachToday!.exercises, changed: todayCell.changed, fromCoach: true });
      } else if (names.length) {
        for (const n of names) {
          const d = plan.days.find((x) => x.name === n)!;
          const built = startablePlanDay(d, plan, state.unit, state.sessions, state.customExercises, today);
          items.push({ key: d.id, label: d.name, sessionName: d.name, note: d.note, exercises: built.exercises, changed: todayCell.changed });
        }
      } else {
        items.push({ key: 'new', label: todayCell.focus, sessionName, changed: true });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, state.sessions, state.unit, state.customExercises, todayCell, recThisWeek]);
  const todaysActivities = (plan.activities ?? [])
    .filter((a) => a.weekdays.includes(new Date().getDay()))
    // Hide a sport the coach skipped for today.
    .filter((a) => !todayCell || (todayCell.activity ?? '').toLowerCase().includes(exerciseName(a.exerciseId, state.customExercises).toLowerCase()));

  const ask = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setLoading(true);
    try {
      const note = request.trim();
      const r = await recommend(
        {
          plan, unit: state.unit, distanceUnit: state.distanceUnit, sessions: state.sessions, customExercises: state.customExercises,
          previous: state.recommendation,
          notes: state.coachNotes,
        },
        state.llm,
        note,
        ctl.signal,
      );
      update((d) => {
        d.recommendation = r;
        // Remember what the user told the coach, so later refreshes keep honoring it.
        if (note) d.coachNotes = [...d.coachNotes, { at: new Date().toISOString(), text: note }].slice(-50);
      });
      if (note) setRequest('');
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

      {todayItems.length > 0 && (
        <div className="card">
          <h2>Today's plan</h2>
          <ul className="list">
            {todayItems.map((it) => {
              const done = doneToday.has(it.sessionName);
              return (
                <li key={it.key} className="row spread" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <b>{it.label}</b> {it.changed && <span className="changed-dot" title="Changed by the coach this week" />} {done && <span className="badge">Done</span>}
                    {it.note && <div className="small">{it.note}</div>}
                    {it.exercises ? (
                      <div className="small muted">
                        {it.exercises.filter((e) => e.note?.startsWith(`W${block.week}:`)).map((e) => `${exerciseName(e.exerciseId, state.customExercises)} ${e.note!.split(' — ')[0].replace(/^W\d+: /, '')}`).join(' · ')
                          || summarize(it.exercises.map((e) => exerciseName(e.exerciseId, state.customExercises)))}
                      </div>
                    ) : (
                      <div className="small muted">The coach added this session — tap Refresh plan to build its workout.</div>
                    )}
                  </div>
                  {it.exercises && (
                    <button className={`btn ${done ? '' : 'primary'}`} onClick={() => begin(it.sessionName, it.exercises!, it.fromCoach ? 'coach' : 'template')}>{done ? 'Again' : 'Start'}</button>
                  )}
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

        {!recThisWeek && (
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

        <div className="stack" style={{ marginTop: 8 }}>
          {recThisWeek?.warning && !stale && (
            <div className="banner warn">
              {recThisWeek.warning}{' '}
              <button className="btn small ghost" onClick={goSettings}>AI settings</button>
            </div>
          )}
          {recThisWeek && (
            <div>
              {stale && (
                <div className="banner info" style={{ marginBottom: 8 }}>
                  Plan made {new Date(recThisWeek.createdAt).toLocaleDateString(undefined, { weekday: 'long' })}. Its changes for the days ahead still apply — tap <b>Refresh plan</b> for today.
                </div>
              )}
              <h3 style={{ fontSize: 17 }}>{recThisWeek.headline}</h3>
              {recThisWeek.planName && <div className="small muted" style={{ marginBottom: 4 }}>From your plan: <button className="btn small ghost" style={{ padding: 0, minHeight: 0 }} onClick={goPlan}>{recThisWeek.planName}</button></div>}
              {!stale && <p className="small">{recThisWeek.summary}</p>}
            </div>
          )}
          <WeekStrip cells={cells} />
          {changesAhead.length ? (
            <div className="changes">
              <h3>What the coach changed this week</h3>
              <ul className="bullets">
                {changesAhead.map((c, i) => (
                  <li key={i}>
                    <b>{c.date ? new Date(c.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' }) : c.day}</b>
                    {c.scope && <span className="tag" style={{ marginLeft: 6 }}>{c.scope === 'today' ? 'today only' : 'rest of week'}</span>}
                    {' · '}{c.change} — {c.reason}
                    {c.principle && <span className="muted"> (follows: {c.principle})</span>}
                  </li>
                ))}
              </ul>
              <div className="row spread wrap" style={{ marginTop: 4 }}>
                <span className="small muted">Your base plan is unchanged; next week starts from it again.</span>
                <button className="btn small ghost" onClick={() => confirm("Undo the coach's changes for this week and go back to your base plan?") && update((d) => void (d.recommendation = null))}>
                  Reset to base plan
                </button>
              </div>
            </div>
          ) : null}
          {recThisWeek && !stale && (
            <>
              <div>
                <h3>{nextLabel(recThisWeek)}: {recThisWeek.today.name}</h3>
                <ul className="list">
                  {recThisWeek.today.exercises.map((e, i) => (
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
                <button className="btn primary grow" onClick={() => {
                  const names = sessionsIn(plan, recThisWeek.today.name);
                  begin(names.length === 1 ? names[0] : recThisWeek.today.name, recThisWeek.today.exercises, 'coach');
                }}>Start this workout</button>
                <button
                  className="btn"
                  onClick={() => {
                    update((d) => void d.templates.push({ id: uid(), name: recThisWeek.today.name, exercises: recThisWeek.today.exercises, updatedAt: new Date().toISOString() }));
                    alert(`Saved "${recThisWeek.today.name}" to your workouts.`);
                  }}
                >
                  Save
                </button>
              </div>
              <details>
                <summary className="small" style={{ cursor: 'pointer' }}>Why this plan</summary>
                <ul className="bullets">{recThisWeek.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </details>
            </>
          )}
        </div>

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
          {rememberedNotes.length > 0 && (
            <div className="small">
              <span className="muted">Coach remembers (this week & last few days):</span>
              <ul className="remembered">
                {rememberedNotes.map((n, i) => (
                  <li key={`${n.at}-${i}`}>
                    <span className="muted">{new Date(n.at).toLocaleDateString(undefined, { weekday: 'short' })}</span> {n.text}
                    <button className="btn ghost small" aria-label={`Forget: ${n.text}`} title="Forget this note"
                      onClick={() => update((d) => {
                        // Remove exactly this note (two notes can share a timestamp).
                        const idx = d.coachNotes.findIndex((x) => x.at === n.at && x.text === n.text);
                        if (idx !== -1) d.coachNotes.splice(idx, 1);
                      })}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

/** This calendar week as two rows: Mon–Fri, then Sat–Sun. Past days show done/missed; today is outlined. */
function WeekStrip({ cells }: { cells: WeekCell[] }) {
  const cell = (c: WeekCell) => {
    const rest = /^(rest|rest \/ easy cardio)$/i.test(c.focus) || c.focus === c.activity;
    const cls = [
      c.status === 'done' ? 'done' : c.status === 'missed' ? 'missed' : rest ? '' : 'train',
      c.activity && c.status !== 'missed' ? 'activity' : '',
      c.status === 'today' ? 'today' : '',
      c.changed ? 'changed' : '',
      c.status === 'done' || c.status === 'missed' || c.status === 'rest' ? 'past' : '',
    ].join(' ');
    return (
      <div key={c.date} className={cls} title={c.changed ? 'Changed by the coach this week' : undefined}>
        <b>{c.status === 'today' ? 'Today' : WD3[c.weekday]}</b>
        {c.status === 'done' && '✓ '}
        {shortLabel(c.focus)}
        {c.status === 'missed' && <span className="small"> · missed</span>}
        {c.activity && c.activity !== c.focus && c.status !== 'missed' && <i>+ {shortLabel(c.activity)}</i>}
      </div>
    );
  };
  return (
    <div className="week-strip" aria-label="This week">
      <div className="plan-days wk5">{cells.slice(0, 5).map(cell)}</div>
      <div className="plan-days wk2">{cells.slice(5, 7).map(cell)}</div>
      {cells.some((d) => d.changed) && <p className="small muted" style={{ margin: 0 }}><span className="changed-dot" /> changed by the coach this week</p>}
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

/**
 * Compact label for the week squares: "Bike Cardio + Plyos (modified)" → "Bike + Plyos",
 * "Rest / easy cardio" → "Rest", "Basketball 60 min" → "Basketball". Display only.
 */
export function shortLabel(label: string): string {
  if (/^rest\b/i.test(label.trim())) return 'Rest';
  const out = label
    .replace(/ \d+\s?min\b/gi, '')
    .replace(/\s*\((modified|adjusted|changed|updated|swapped|indoor version)\)/gi, '')
    .replace(/\b(session|workout|training)\b/gi, '')
    .replace(/(\w)\s+cardio\b/gi, '$1') // "Bike Cardio" → "Bike"; a lone "Cardio" stays
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([+/])\s+/g, ' $1 ')
    .replace(/^[\s+:–-]+|[\s+:–-]+$/g, '')
    .trim();
  return out || label;
}
