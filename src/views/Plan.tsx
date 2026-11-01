import { useRef, useState } from 'react';
import { BarList } from '../components/Charts';
import { allExercises, cardio as makeCardio, exerciseName, metricOf } from '../data/exercises';
import { blockWeek, isoDate } from '../lib/analytics';
import { defaultPrinciples } from '../lib/evidence';
import { generateBasePlan, generateDays, projectedCardioMinutes, projectedWeeklySets, resetTargets } from '../lib/planner';
import { importPlan, uid, update, useAppState } from '../store';
import { EQUIPMENT, MUSCLES, type Activity, type BasePlan, type Experience, type Goal, type Intensity, type PlanDay } from '../types';
import { describeTarget, RPE_OPTIONS, rpeHint, WorkoutEditor } from './Workouts';

function editPlan(fn: (p: BasePlan) => void) {
  update((d) => {
    fn(d.plan);
    d.plan.updatedAt = new Date().toISOString();
  });
}

function daysUntil(date: string): number {
  const a = new Date(isoDate(new Date()) + 'T00:00');
  const b = new Date(date + 'T00:00');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Plan() {
  const state = useAppState();
  const plan = state.plan;
  const [editingDay, setEditingDay] = useState<PlanDay | null>(null);
  const [newBlock, setNewBlock] = useState(false);

  if (editingDay) {
    return (
      <WorkoutEditor
        title={plan.days.some((d) => d.id === editingDay.id) ? 'Edit plan day' : 'New plan day'}
        initial={editingDay}
        saveLabel="Save day"
        schedule
        blockWeeks={blockWeek(plan).total}
        onCancel={() => setEditingDay(null)}
        onSave={(day) => {
          editPlan((p) => {
            const i = p.days.findIndex((x) => x.id === day.id);
            if (i === -1) p.days.push(day);
            else p.days[i] = day;
          });
          setEditingDay(null);
        }}
      />
    );
  }

  const due = daysUntil(plan.reviewDate);
  const projected = projectedWeeklySets(plan.days, state.customExercises);
  const cardio = projectedCardioMinutes(plan.days, state.customExercises, plan.activities);
  const p = plan.profile;

  return (
    <div className="stack">
      {/* Block header */}
      <div className={`card ${due <= 0 ? 'accent' : ''}`}>
        <div className="row spread">
          <input
            type="text"
            aria-label="Plan name"
            value={plan.name}
            onChange={(e) => editPlan((x) => void (x.name = e.target.value))}
            style={{ fontWeight: 650, fontSize: 18, border: 0, padding: 0, minHeight: 0, background: 'transparent' }}
          />
          <span className={`badge ${due <= 14 ? 'due' : ''}`}>{due <= 0 ? 'Review due' : `Review in ${due} days`}</span>
        </div>
        <div className="row wrap small muted" style={{ marginTop: 6 }}>
          <span>Block:</span>
          <input type="date" aria-label="Block start" value={plan.startDate} onChange={(e) => e.target.value && editPlan((x) => void (x.startDate = e.target.value))} style={{ width: 'auto', minHeight: 32, padding: '2px 6px' }} />
          <span>→ review</span>
          <input type="date" aria-label="Review date" value={plan.reviewDate} onChange={(e) => e.target.value && editPlan((x) => void (x.reviewDate = e.target.value))} style={{ width: 'auto', minHeight: 32, padding: '2px 6px' }} />
        </div>
        {blockWeek(plan).total > 1 && blockWeek(plan).total <= 16 && (
          <p style={{ marginTop: 8, fontWeight: 600 }}>
            Week {blockWeek(plan).week} of {blockWeek(plan).total}
            {plan.weekNotes?.[blockWeek(plan).week - 1] ? <span className="muted" style={{ fontWeight: 400 }}> · {plan.weekNotes[blockWeek(plan).week - 1]}</span> : null}
          </p>
        )}
        <p className="small" style={{ marginTop: 8 }}>
          This is your base plan. Every time you ask the coach for your week, it starts from these days, targets and rules, then
          adjusts for how your training has actually gone.
        </p>
        <WeekNotes plan={plan} />
        <div className="row wrap">
          <button className="btn grow" onClick={() => setNewBlock(true)}>Start a new block…</button>
          <PlanFileButtons />
        </div>
      </div>

      {newBlock && <NewBlockDialog onClose={() => setNewBlock(false)} />}

      {/* Weekly days */}
      <div className="card stack">
        <div className="row spread">
          <h3 style={{ margin: 0 }}>Weekly schedule</h3>
          <span className="tag">{plan.days.length} days</span>
        </div>
        {!plan.days.some((d) => d.weekdays?.length) && plan.days.length !== p.daysPerWeek && (
          <div className="banner warn">
            Your plan has {plan.days.length} days but you train {p.daysPerWeek}×/week.{' '}
            <button className="btn small ghost" onClick={() => rebuildDays(state)}>Rebuild days from evidence</button>
          </div>
        )}
        {plan.days.map((d, i) => (
          <div key={d.id} style={{ borderTop: i ? '1px solid var(--border)' : 0, paddingTop: i ? 10 : 0 }}>
            <div className="row spread">
              <b>{i + 1}. {d.name} <span className="tag">{dayWhen(d)}</span></b>
              <div className="row" style={{ gap: 0 }}>
                <button className="btn ghost small" disabled={i === 0} aria-label="Move day up" onClick={() => editPlan((x) => void ([x.days[i - 1], x.days[i]] = [x.days[i], x.days[i - 1]]))}>↑</button>
                <button className="btn ghost small" onClick={() => setEditingDay(structuredClone(d))}>Edit</button>
                <button className="btn ghost small danger" aria-label={`Delete ${d.name}`} onClick={() => confirm(`Remove "${d.name}" from your plan?`) && editPlan((x) => void (x.days = x.days.filter((y) => y.id !== d.id)))}>✕</button>
              </div>
            </div>
            {d.note && <div className="small">{d.note}</div>}
            <div className="small muted">
              {d.exercises.map((e) => `${exerciseName(e.exerciseId, state.customExercises)} ${describeTarget(e, metricOf(e, state.customExercises), state.distanceUnit)}`).join(' · ')}
            </div>
          </div>
        ))}
        <div className="row wrap">
          <button className="btn" onClick={() => setEditingDay({ id: uid(), name: `Day ${plan.days.length + 1}`, exercises: [] })}>+ Add day</button>
          <button className="btn ghost" onClick={() => confirm('Replace all plan days with a fresh evidence-based split for your profile?') && rebuildDays(state)}>Rebuild from evidence</button>
        </div>
        <div>
          <h3 style={{ marginTop: 6 }}>What this plan gives you each week</h3>
          <p className="small muted">Hard sets per muscle if you do every day once; the tick is your target. Falling short is usually session time: add a day, add minutes, or accept it for smaller muscles.</p>
          <BarList rows={MUSCLES.map((m) => ({ label: m, value: projected[m], target: plan.setTargets[m] }))} />
          {plan.cardioMinutes > 0 && (
            <p className="small" style={{ marginTop: 8 }}>
              Cardio: {cardio} of {plan.cardioMinutes} min/week planned{cardio < plan.cardioMinutes ? ' — add cardio to a day or do it on rest days.' : '.'}
            </p>
          )}
        </div>
      </div>

      <Activities plan={plan} />

      {/* Profile */}
      <div className="card stack">
        <h3>About you</h3>
        <div className="grid2">
          <label className="field"><span>Goal</span>
            <select value={p.goal} onChange={(e) => editPlan((x) => void (x.profile.goal = e.target.value as Goal))}>
              <option value="hypertrophy">Build muscle</option>
              <option value="strength">Get stronger</option>
              <option value="athletic">Athletic: power, speed, endurance</option>
              <option value="general">General fitness</option>
            </select>
          </label>
          <label className="field"><span>Experience</span>
            <select value={p.experience} onChange={(e) => editPlan((x) => void (x.profile.experience = e.target.value as Experience))}>
              <option value="beginner">Beginner (&lt;1 yr)</option>
              <option value="intermediate">Intermediate (1–3 yrs)</option>
              <option value="advanced">Advanced (3+ yrs)</option>
            </select>
          </label>
          <label className="field"><span>Days per week</span>
            <select value={p.daysPerWeek} onChange={(e) => editPlan((x) => void (x.profile.daysPerWeek = Number(e.target.value)))}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field"><span>Session length</span>
            <select value={p.sessionMinutes} onChange={(e) => editPlan((x) => void (x.profile.sessionMinutes = Number(e.target.value)))}>
              {[30, 45, 60, 75, 90].map((n) => <option key={n} value={n}>{n} min</option>)}
            </select>
          </label>
        </div>
        <div>
          <span className="muted small">Equipment you have</span>
          <div className="chips" style={{ marginTop: 4 }}>
            {EQUIPMENT.map((x) => (
              <button key={x} className={`chip ${p.equipment.includes(x) ? 'on' : ''}`} aria-pressed={p.equipment.includes(x)}
                onClick={() => editPlan((pl) => void (pl.profile.equipment = p.equipment.includes(x) ? p.equipment.filter((y) => y !== x) : [...p.equipment, x]))}>
                {x}
              </button>
            ))}
          </div>
        </div>
        <label className="field"><span>Notes for the coach (injuries, preferences, priorities)</span>
          <textarea value={p.notes} placeholder="e.g. Left knee is cranky with deep lunges. Want bigger shoulders." onChange={(e) => editPlan((x) => void (x.profile.notes = e.target.value))} />
        </label>
      </div>

      {/* Targets */}
      <div className="card stack">
        <div className="row spread">
          <h3 style={{ margin: 0 }}>Targets</h3>
          <button className="btn small ghost" onClick={() => confirm('Reset targets to the evidence-based defaults for your goal and experience?') && editPlan((x) => Object.assign(x, resetTargets(x)))}>
            Reset to evidence
          </button>
        </div>
        <div>
          <span className="muted small">Weekly hard sets per muscle (research range: ~10–20; raise a muscle you want to prioritise)</span>
          <div className="target-grid" style={{ marginTop: 6 }}>
            {MUSCLES.map((m) => (
              <label key={m}>
                {m}
                <input type="number" inputMode="numeric" min={0} max={30} value={plan.setTargets[m]}
                  onChange={(e) => editPlan((x) => void (x.setTargets[m] = Math.max(0, Math.min(40, Number(e.target.value) || 0))))} />
              </label>
            ))}
          </div>
        </div>
        <div className="grid2">
          <RangeField label="Compound reps" value={plan.repRanges.compound} onChange={(v) => editPlan((x) => void (x.repRanges.compound = v))} />
          <RangeField label="Isolation reps" value={plan.repRanges.isolation} onChange={(v) => editPlan((x) => void (x.repRanges.isolation = v))} />
          <label className="field"><span>Default effort (RPE)</span>
            <select value={plan.rpe} onChange={(e) => editPlan((x) => void (x.rpe = Number(e.target.value)))}>
              {RPE_OPTIONS.map((n) => <option key={n} value={n}>RPE {n} — {rpeHint(n)}</option>)}
            </select>
          </label>
          <label className="field"><span>Cardio minutes / week</span>
            <input type="number" inputMode="numeric" min={0} value={plan.cardioMinutes} onChange={(e) => editPlan((x) => void (x.cardioMinutes = Math.max(0, Number(e.target.value) || 0)))} />
          </label>
        </div>
        <p className="small muted">Rep ranges and effort apply when days are rebuilt; edit a day to change its exercises directly.</p>
      </div>

      <Principles plan={plan} />

      <PastBlocks />
    </div>
  );
}

function rebuildDays(state: ReturnType<typeof useAppState>) {
  editPlan((x) => void (x.days = generateDays(x.profile, x, state.sessions, state.customExercises)));
}

function RangeField({ label, value, onChange }: { label: string; value: [number, number]; onChange: (v: [number, number]) => void }) {
  return (
    <label className="field"><span>{label}</span>
      <div className="row" style={{ gap: 4 }}>
        <input type="number" inputMode="numeric" aria-label={`${label} min`} value={value[0]} onChange={(e) => onChange([Math.max(1, Number(e.target.value) || 1), value[1]])} />
        <span className="muted">–</span>
        <input type="number" inputMode="numeric" aria-label={`${label} max`} value={value[1]} onChange={(e) => onChange([value[0], Math.max(1, Number(e.target.value) || 1)])} />
      </div>
    </label>
  );
}

function Principles({ plan }: { plan: BasePlan }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newRule, setNewRule] = useState('');
  const missingDefaults = defaultPrinciples().filter((d) => !plan.principles.some((p) => p.id === d.id));

  return (
    <div className="card">
      <h3>Evidence & your rules</h3>
      <p className="small muted">
        The coach follows every ticked rule. Untick research you want it to ignore, edit wording, or add your own rules
        (e.g. "No barbell squats", "Sundays are long runs", "Prioritise shoulders").
      </p>
      <div>
        {plan.principles.map((pr) => (
          <div key={pr.id} className={`principle ${pr.enabled ? '' : 'off'}`}>
            <input type="checkbox" checked={pr.enabled} aria-label={`Use rule: ${pr.rule.slice(0, 40)}`}
              onChange={(e) => editPlan((x) => void (x.principles.find((y) => y.id === pr.id)!.enabled = e.target.checked))} />
            <div className="grow text">
              {editing === pr.id ? (
                <div className="stack">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  <div className="row">
                    <button className="btn small primary" onClick={() => { editPlan((x) => void (x.principles.find((y) => y.id === pr.id)!.rule = draft.trim() || pr.rule)); setEditing(null); }}>Save</button>
                    <button className="btn small ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 14 }}>{pr.custom && <span className="badge" style={{ marginRight: 6 }}>Your rule</span>}{pr.rule}</div>
                  {pr.source && <div className="small muted">{pr.source}</div>}
                  <div className="row" style={{ gap: 0, marginTop: 2 }}>
                    <button className="btn ghost small" onClick={() => { setEditing(pr.id); setDraft(pr.rule); }}>Edit</button>
                    <button className="btn ghost small danger" onClick={() => confirm('Delete this rule?') && editPlan((x) => void (x.principles = x.principles.filter((y) => y.id !== pr.id)))}>Delete</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="stack" style={{ marginTop: 10 }}>
        <textarea placeholder="Add your own rule for the coach…" value={newRule} onChange={(e) => setNewRule(e.target.value)} />
        <div className="row wrap">
          <button className="btn" disabled={!newRule.trim()} onClick={() => {
            editPlan((x) => void x.principles.push({ id: `custom-${uid()}`, rule: newRule.trim(), source: '', enabled: true, custom: true }));
            setNewRule('');
          }}>Add rule</button>
          {missingDefaults.length > 0 && (
            <button className="btn ghost" onClick={() => editPlan((x) => void x.principles.push(...missingDefaults))}>
              Restore {missingDefaults.length} research rule{missingDefaults.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NewBlockDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const now = new Date();
  const [months, setMonths] = useState(3);
  const [from, setFrom] = useState<'copy' | 'fresh'>('copy');
  const [name, setName] = useState(() => {
    const q = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()} plan`;
    return q === state.plan.name ? `${q} (v2)` : q;
  });

  const create = () => {
    const review = new Date(now);
    review.setMonth(review.getMonth() + months);
    update((d) => {
      d.planHistory.unshift({ ...d.plan, endDate: isoDate(now) });
      const base = from === 'copy'
        ? structuredClone(d.plan)
        : generateBasePlan(d.plan.profile, { sessions: d.sessions, custom: d.customExercises, months });
      d.plan = { ...base, id: uid(), name: name.trim() || base.name, startDate: isoDate(now), reviewDate: isoDate(review), endDate: undefined, updatedAt: now.toISOString() };
      d.recommendation = null;
    });
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Start a new block">
        <h2>Start a new training block</h2>
        <p className="small muted">"{state.plan.name}" will be saved under Past blocks so you can look back or restore it.</p>
        <label className="field"><span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field"><span>Review after</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={1}>1 month</option>
            <option value={3}>3 months (quarter)</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months (year)</option>
          </select>
        </label>
        <div>
          <span className="muted small">Start from</span>
          <div className="segmented" style={{ display: 'flex', marginTop: 4 }}>
            <button style={{ flex: 1 }} className={from === 'copy' ? 'on' : ''} onClick={() => setFrom('copy')}>Copy of current plan</button>
            <button style={{ flex: 1 }} className={from === 'fresh' ? 'on' : ''} onClick={() => setFrom('fresh')}>Fresh from evidence</button>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary grow" onClick={create}>Start block</button>
        </div>
      </div>
    </div>
  );
}

function PastBlocks() {
  const state = useAppState();
  const [open, setOpen] = useState<string | null>(null);
  if (!state.planHistory.length) return null;
  return (
    <div className="card">
      <h3>Past blocks</h3>
      <ul className="list">
        {state.planHistory.map((b) => {
          const sessions = state.sessions.filter((s) => s.finishedAt && s.startedAt.slice(0, 10) >= b.startDate && s.startedAt.slice(0, 10) <= (b.endDate ?? b.reviewDate)).length;
          return (
            <li key={b.id}>
              <button className="row spread" style={{ width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                <div>
                  <b>{b.name}</b>
                  <div className="small muted">{fmtDate(b.startDate)} – {fmtDate(b.endDate ?? b.reviewDate)} · {sessions} workouts</div>
                </div>
                <span className="muted">{open === b.id ? '▾' : '▸'}</span>
              </button>
              {open === b.id && (
                <div className="small" style={{ marginTop: 6 }}>
                  <div>{b.profile.goal}, {b.profile.experience}, {b.profile.daysPerWeek}×/week, {b.cardioMinutes} cardio min/week</div>
                  <div className="muted">{b.days.map((d) => d.name).join(' · ')}</div>
                  <div className="muted">{b.principles.filter((p) => p.custom).map((p) => `“${p.rule}”`).join(' ')}</div>
                  <button className="btn small" style={{ marginTop: 6 }} onClick={() => {
                    if (!confirm(`Make "${b.name}" your current plan again? The current plan is saved to Past blocks.`)) return;
                    const now = new Date();
                    update((d) => {
                      const months = Math.max(1, Math.round((new Date(b.reviewDate).getTime() - new Date(b.startDate).getTime()) / (30.4 * 86_400_000)));
                      const review = new Date(now);
                      review.setMonth(review.getMonth() + months);
                      d.planHistory.unshift({ ...d.plan, endDate: isoDate(now) });
                      d.plan = { ...structuredClone(b), id: uid(), startDate: isoDate(now), reviewDate: isoDate(review), endDate: undefined, updatedAt: now.toISOString() };
                      d.recommendation = null;
                    });
                  }}>Restore as current plan</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Activities({ plan }: { plan: BasePlan }) {
  const state = useAppState();
  const sports = allExercises(state.customExercises).filter((e) => e.sport);
  const [pick, setPick] = useState(sports[0]?.id ?? '');
  const [otherName, setOtherName] = useState('');
  const edit = (id: string, fn: (a: Activity) => void) =>
    editPlan((x) => {
      const a = x.activities.find((y) => y.id === id);
      if (a) fn(a);
    });

  const add = () => {
    let exerciseId = pick;
    if (pick === '__other') {
      const name = otherName.trim();
      if (!name) return;
      exerciseId = `custom-${uid()}`;
      const ex = { ...makeCardio(exerciseId, name, 'bodyweight'), sport: true, custom: true };
      update((d) => void d.customExercises.push(ex));
      setOtherName('');
    }
    editPlan((x) => void x.activities.push({ id: uid(), exerciseId, weekdays: [], minutes: 60, intensity: 'moderate' }));
  };

  return (
    <div className="card stack">
      <div>
        <h3 style={{ margin: 0 }}>Weekly activities</h3>
        <p className="small muted" style={{ marginTop: 4 }}>
          Sports and classes on set days. The coach plans lifting around them, keeps heavy leg work away from the day before a hard
          game, and counts them toward your cardio minutes.
        </p>
      </div>
      {plan.activities.map((a) => (
        <div key={a.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="row spread">
            <b>{exerciseName(a.exerciseId, state.customExercises)}</b>
            <button className="btn ghost small danger" aria-label={`Remove ${exerciseName(a.exerciseId, state.customExercises)}`}
              onClick={() => editPlan((x) => void (x.activities = x.activities.filter((y) => y.id !== a.id)))}>✕</button>
          </div>
          <div className="weekday-chips" role="group" aria-label="Days" style={{ margin: '6px 0' }}>
            {WEEKDAY_ORDER.map((w) => {
              const on = a.weekdays.includes(w);
              return (
                <button key={w} className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
                  onClick={() => edit(a.id, (x) => void (x.weekdays = on ? x.weekdays.filter((y) => y !== w) : [...x.weekdays, w].sort()))}>
                  {WEEKDAY_SHORT[w]}
                </button>
              );
            })}
          </div>
          <div className="grid2">
            <label className="field"><span>Minutes</span>
              <input type="number" inputMode="numeric" min={5} value={a.minutes} onChange={(e) => edit(a.id, (x) => void (x.minutes = Math.max(0, Number(e.target.value) || 0)))} />
            </label>
            <label className="field"><span>Intensity</span>
              <select value={a.intensity} onChange={(e) => edit(a.id, (x) => void (x.intensity = e.target.value as Intensity))}>
                <option value="light">Light (casual / drills)</option>
                <option value="moderate">Moderate (rec league)</option>
                <option value="hard">Hard (competitive game)</option>
              </select>
            </label>
          </div>
          {!a.weekdays.length && <p className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>Pick the days you play.</p>}
        </div>
      ))}
      <div className="row wrap" style={{ borderTop: plan.activities.length ? '1px solid var(--border)' : 0, paddingTop: plan.activities.length ? 10 : 0 }}>
        <select aria-label="Activity" value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1, minWidth: 150 }}>
          {sports.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          <option value="__other">Other…</option>
        </select>
        {pick === '__other' && (
          <input type="text" placeholder="Activity name" aria-label="Activity name" value={otherName} onChange={(e) => setOtherName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        )}
        <button className="btn" onClick={add} disabled={pick === '__other' && !otherName.trim()}>+ Add activity</button>
      </div>
    </div>
  );
}

function dayWhen(d: PlanDay): string {
  if (!d.weekdays?.length) return 'rotates';
  if (d.weekdays.length >= 7) return 'daily';
  return [1, 2, 3, 4, 5, 6, 0].filter((w) => d.weekdays!.includes(w)).map((w) => WEEKDAY_SHORT[w]).join('/');
}

function WeekNotes({ plan }: { plan: BasePlan }) {
  const { total } = blockWeek(plan);
  if (total < 2 || total > 16) return null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="small" style={{ cursor: 'pointer' }}>Week-by-week focus ({plan.weekNotes?.filter(Boolean).length ?? 0}/{total})</summary>
      <div className="stack" style={{ marginTop: 6 }}>
        {Array.from({ length: total }, (_, w) => (
          <label key={w} className="row small">
            <span style={{ width: 28 }}>W{w + 1}</span>
            <input type="text" value={plan.weekNotes?.[w] ?? ''} placeholder="e.g. 80% RPE 7 · or Deload + retest"
              onChange={(e) => editPlan((x) => {
                const notes = Array.from({ length: total }, (_, k) => x.weekNotes?.[k] ?? '');
                notes[w] = e.target.value;
                x.weekNotes = notes;
              })} />
          </label>
        ))}
      </div>
    </details>
  );
}

/** Export the base plan as a file, or import one (the current plan is archived). */
function PlanFileButtons() {
  const state = useAppState();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn" onClick={() => {
        const used = new Set(state.plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)).concat(state.plan.activities.map((a) => a.exerciseId)));
        const data = { kind: 'lift-log-plan', version: 1, plan: state.plan, customExercises: state.customExercises.filter((e) => used.has(e.id)) };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = `${state.plan.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'plan'}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }}>Export plan</button>
      <button className="btn" onClick={() => input.current?.click()}>Import plan</button>
      <input ref={input} type="file" accept="application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
          const result = importPlan(JSON.parse(await f.text()));
          if (!confirm(`Replace your current plan with "${result.plan.name}" (${result.plan.days.length} days)? Your current plan is saved under Past blocks.`)) return;
          update((d) => {
            d.planHistory.unshift({ ...d.plan, endDate: isoDate(new Date()) });
            d.plan = result.plan;
            for (const ex of result.customExercises) if (!d.customExercises.some((c) => c.id === ex.id)) d.customExercises.push(ex);
            d.recommendation = null;
          });
        } catch (err) {
          alert(`That file isn't a plan export: ${err instanceof Error ? err.message : err}`);
        }
      }} />
    </>
  );
}
