/**
 * Deterministic analysis of the training log. Everything the coach knows
 * about "you" comes from here: weekly volume per muscle, cardio minutes,
 * adherence, time off, and per-exercise performance with a suggested next load.
 */
import { findExercise, metricOf } from '../data/exercises';
import type { BasePlan, Exercise, Metric, Muscle, Session, SetLog, Unit } from '../types';
import { MUSCLES } from '../types';
import { RETURN_ADJUSTMENT } from './evidence';

const DAY_MS = 86_400_000;

/** Monday 00:00 local time of the week containing `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // Mon=0 … Sun=6
  out.setDate(out.getDate() - dow);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function finished(sessions: Session[]): Session[] {
  return sessions
    .filter((s) => s.finishedAt)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** A completed set: ticked off with reps, time or distance logged. */
export function isWorkingSet(s: SetLog): boolean {
  return s.done && ((s.reps ?? 0) > 0 || (s.durationSec ?? 0) > 0 || (s.distance ?? 0) > 0);
}

export function sessionsBetween(sessions: Session[], from: Date, to: Date): Session[] {
  return finished(sessions).filter((s) => {
    const t = new Date(s.startedAt).getTime();
    return t >= from.getTime() && t < to.getTime();
  });
}

export function emptyMuscles(): Record<Muscle, number> {
  return Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
}

/**
 * Hard sets per muscle. A set counts 1 for each primary muscle and 0.5 for
 * each secondary muscle — the common "fractional set" convention.
 */
export function setsPerMuscle(sessions: Session[], custom: Exercise[] = []): Record<Muscle, number> {
  const out = emptyMuscles();
  for (const s of sessions) {
    for (const log of s.exercises) {
      const ex = findExercise(log.exerciseId, custom);
      // Hard sets are lifting sets: sprints, runs and timed holds don't count.
      if (!ex || ex.cardio || metricOf(log, custom) === 'time_distance') continue;
      const n = log.sets.filter(isWorkingSet).length;
      for (const m of ex.primary) out[m] += n;
      for (const m of ex.secondary) out[m] += n * 0.5;
    }
  }
  return out;
}

/** Minutes of logged time on aerobic exercises. */
export function cardioMinutes(sessions: Session[], custom: Exercise[] = []): number {
  let sec = 0;
  for (const s of sessions)
    for (const log of s.exercises) {
      if (!findExercise(log.exerciseId, custom)?.cardio) continue;
      for (const x of log.sets) if (isWorkingSet(x)) sec += x.durationSec ?? 0;
    }
  return Math.round(sec / 60);
}

export type TrainingStatus =
  | 'new' // no history
  | 'on-track'
  | 'missed-last-week' // last week well under target, but not a long break
  | 'returning' // 14–27 days since last session
  | 'detrained'; // 28+ days since last session

export interface WeekSummary {
  weekOf: string; // ISO date of Monday
  sessions: number;
  target: number;
}

export interface TrainingSnapshot {
  today: string;
  status: TrainingStatus;
  statusText: string;
  daysSinceLast: number | null;
  /** Last 4 full weeks (oldest first) plus the current week so far. */
  weeks: WeekSummary[];
  adherence4wk: number | null; // 0..1 over the last 4 full weeks
  thisWeek: { sessions: number; setsPerMuscle: Record<Muscle, number>; cardioMinutes: number };
  lastWeek: { sessions: number; setsPerMuscle: Record<Muscle, number>; cardioMinutes: number };
  setTargets: Record<Muscle, number>;
  cardioTarget: number;
  /** Load cut and volume factor to apply this week (1 = normal). */
  adjustment: { loadCut: number; volumeFactor: number; reason: string | null };
}

export function snapshot(sessions: Session[], plan: BasePlan, custom: Exercise[] = [], now: Date = new Date()): TrainingSnapshot {
  const profile = plan.profile;
  // A daily routine (e.g. a morning mobility routine) isn't a training session.
  const routineNames = new Set(plan.days.filter((d) => (d.weekdays?.length ?? 0) >= 7).map((d) => d.name));
  const done = finished(sessions).filter((s) => !routineNames.has(s.name));
  const thisMon = weekStart(now);
  const weeks: WeekSummary[] = [];
  for (let i = 4; i >= 0; i--) {
    const from = addDays(thisMon, -7 * i);
    const list = sessionsBetween(done, from, addDays(from, 7));
    weeks.push({ weekOf: isoDate(from), sessions: list.length, target: profile.daysPerWeek });
  }
  const full = weeks.slice(0, 4);
  const trainedWeeks = full.filter((w) => w.sessions > 0).length;
  const adherence4wk = done.length
    ? Math.min(1, full.reduce((a, w) => a + w.sessions, 0) / (profile.daysPerWeek * 4))
    : null;

  const last = done.at(-1);
  const daysSinceLast = last
    ? Math.floor((startOfDay(now).getTime() - startOfDay(new Date(last.startedAt)).getTime()) / DAY_MS)
    : null;

  const thisWeekSessions = sessionsBetween(done, thisMon, addDays(thisMon, 7));
  const lastWeekSessions = sessionsBetween(done, addDays(thisMon, -7), thisMon);

  let status: TrainingStatus;
  let statusText: string;
  if (daysSinceLast === null) {
    status = 'new';
    statusText = 'No workouts logged yet — starting conservatively.';
  } else if (daysSinceLast >= 28) {
    status = 'detrained';
    statusText = `It's been ${daysSinceLast} days since your last workout.`;
  } else if (daysSinceLast >= 14) {
    status = 'returning';
    statusText = `It's been ${daysSinceLast} days since your last workout.`;
  } else if (trainedWeeks === 0 && lastWeekSessions.length === 0) {
    // Only this week has any training: just getting started, not "on track".
    status = 'new';
    statusText = `Getting started: ${thisWeekSessions.length} of ${profile.daysPerWeek} sessions so far this week.`;
  } else if (lastWeekSessions.length < Math.ceil(profile.daysPerWeek / 2) && trainedWeeks > 0) {
    status = 'missed-last-week';
    statusText =
      lastWeekSessions.length === 0
        ? 'You missed last week.'
        : `Last week you got ${lastWeekSessions.length} of ${profile.daysPerWeek} planned sessions.`;
  } else {
    status = 'on-track';
    statusText = `On track: ${lastWeekSessions.length} of ${profile.daysPerWeek} sessions last week.`;
  }

  const adj = RETURN_ADJUSTMENT.find((r) => daysSinceLast !== null && daysSinceLast >= r.minDaysOff);

  return {
    today: isoDate(now),
    status,
    statusText,
    daysSinceLast,
    weeks,
    adherence4wk,
    thisWeek: { sessions: thisWeekSessions.length, setsPerMuscle: setsPerMuscle(thisWeekSessions, custom), cardioMinutes: cardioMinutes(thisWeekSessions, custom) },
    lastWeek: { sessions: lastWeekSessions.length, setsPerMuscle: setsPerMuscle(lastWeekSessions, custom), cardioMinutes: cardioMinutes(lastWeekSessions, custom) },
    setTargets: plan.setTargets,
    cardioTarget: plan.cardioMinutes,
    adjustment: adj
      ? { loadCut: adj.loadCut, volumeFactor: adj.volumeFactor, reason: adj.label }
      : { loadCut: 0, volumeFactor: 1, reason: null },
  };
}

/** Epley estimated one-rep max. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export interface LoggedSet {
  weight: number;
  reps: number;
  rpe: number | null;
  durationSec: number;
  distance: number;
}

export interface ExerciseHistory {
  exerciseId: string;
  lastDate: string;
  /** Working sets from the most recent session with this exercise. */
  lastSets: LoggedSet[];
  bestE1rm: number;
  sessions: number;
}

function toLogged(x: SetLog): LoggedSet {
  return { weight: x.weight ?? 0, reps: x.reps ?? 0, rpe: x.rpe, durationSec: x.durationSec ?? 0, distance: x.distance ?? 0 };
}

export function exerciseHistory(sessions: Session[]): Map<string, ExerciseHistory> {
  const out = new Map<string, ExerciseHistory>();
  for (const s of finished(sessions)) {
    for (const log of s.exercises) {
      const sets = log.sets.filter(isWorkingSet).map(toLogged);
      if (!sets.length) continue;
      const prev = out.get(log.exerciseId);
      const best = Math.max(prev?.bestE1rm ?? 0, ...sets.map((x) => e1rm(x.weight, x.reps)));
      out.set(log.exerciseId, {
        exerciseId: log.exerciseId,
        lastDate: s.startedAt.slice(0, 10),
        lastSets: sets,
        bestE1rm: Math.round(best * 10) / 10,
        sessions: (prev?.sessions ?? 0) + 1,
      });
    }
  }
  return out;
}

export function roundLoad(w: number, unit: Unit): number {
  const step = unit === 'kg' ? 2.5 : 5;
  return Math.max(0, Math.round(w / step) * step);
}

export interface LoadSuggestion {
  weight: number | null;
  reason: string;
}

/**
 * Double progression: if every working set last time reached the top of the
 * rep range, add load; if sets fell short of the bottom, back off;
 * otherwise keep the weight and chase reps. Then apply any return-from-break cut.
 */
export function suggestLoad(
  hist: ExerciseHistory | undefined,
  ex: Exercise | undefined,
  repMin: number,
  repMax: number,
  unit: Unit,
  loadCut = 0,
): LoadSuggestion {
  if (!hist || !ex) return { weight: null, reason: 'No history — pick a weight you could lift for ~3 more reps.' };
  const working = hist.lastSets.filter((s) => s.weight > 0);
  if (!working.length) return { weight: null, reason: 'Bodyweight — add reps first.' };

  const top = Math.max(...working.map((s) => s.weight));
  const atTop = working.filter((s) => s.weight === top);
  const allHitTop = atTop.every((s) => s.reps >= repMax);
  const allBelowMin = atTop.every((s) => s.reps < repMin);
  const pct = ex.lowerBody ? 0.05 : 0.025;
  const minStep = unit === 'kg' ? (ex.lowerBody ? 5 : 2.5) : ex.lowerBody ? 10 : 5;

  let weight = top;
  let reason: string;
  if (allHitTop) {
    weight = top + Math.max(minStep, top * pct);
    reason = `Hit ${repMax}+ reps on every set at ${top} — add load.`;
  } else if (allBelowMin) {
    // Round down, and always drop at least one increment so the back-off is real.
    const step = unit === 'kg' ? 2.5 : 5;
    weight = Math.min(Math.floor((top * 0.95) / step) * step, top - step);
    reason = `Fell short of ${repMin} reps at ${top} — back off ~5% and build up.`;
  } else {
    reason = `Same weight as last time (${top}); aim for +1 rep per set.`;
  }
  if (loadCut > 0) {
    weight = weight * (1 - loadCut);
    reason += ` Reduced ${Math.round(loadCut * 100)}% after time off.`;
  }
  return { weight: roundLoad(weight, unit), reason };
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Which week of the plan's block `now` falls in, e.g. { week: 3, total: 6 }. */
export function blockWeek(plan: { startDate: string; reviewDate: string }, now: Date = new Date()): { week: number; total: number } {
  const start = new Date(plan.startDate + 'T00:00');
  const end = new Date(plan.reviewDate + 'T00:00');
  const total = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * DAY_MS)));
  const week = Math.floor((startOfDay(now).getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
  return { week: Math.min(total, Math.max(1, week)), total };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sessionVolume(s: Session): number {
  let v = 0;
  for (const e of s.exercises) for (const x of e.sets) if (isWorkingSet(x)) v += (x.weight ?? 0) * (x.reps ?? 0);
  return v;
}

export function workingSetCount(s: Session): number {
  return s.exercises.reduce((a, e) => a + e.sets.filter(isWorkingSet).length, 0);
}

// ---- Chart series ----

export interface Point {
  key: string;
  label: string;
  value: number;
}

/** One value per week for the last `n` weeks (oldest first), current week last. */
export function weeklySeries(sessions: Session[], n: number, fn: (inWeek: Session[]) => number, now = new Date()): Point[] {
  const mon = weekStart(now);
  const out: Point[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = addDays(mon, -7 * i);
    out.push({
      key: isoDate(from),
      label: i === 0 ? 'This wk' : from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: fn(sessionsBetween(sessions, from, addDays(from, 7))),
    });
  }
  return out;
}

export type ExerciseMeasure = 'e1rm' | 'top' | 'volume' | 'distance' | 'minutes';

export const MEASURES: Record<Metric, { id: ExerciseMeasure; label: string }[]> = {
  weight_reps: [
    { id: 'e1rm', label: 'Est. 1-rep max' },
    { id: 'top', label: 'Top set weight' },
    { id: 'volume', label: 'Volume (weight × reps)' },
  ],
  time_distance: [
    { id: 'distance', label: 'Distance' },
    { id: 'minutes', label: 'Minutes' },
  ],
};

/** One value per session that included the exercise (last `n` sessions). */
export function exerciseSeries(sessions: Session[], exerciseId: string, measure: ExerciseMeasure, n = 12): Point[] {
  const out: Point[] = [];
  for (const s of finished(sessions)) {
    const sets = s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter(isWorkingSet).map(toLogged));
    if (!sets.length) continue;
    let v = 0;
    if (measure === 'e1rm') v = Math.max(...sets.map((x) => e1rm(x.weight, x.reps)));
    else if (measure === 'top') v = Math.max(...sets.map((x) => x.weight));
    else if (measure === 'volume') v = sets.reduce((a, x) => a + x.weight * x.reps, 0);
    else if (measure === 'distance') v = sets.reduce((a, x) => a + x.distance, 0);
    else v = sets.reduce((a, x) => a + x.durationSec, 0) / 60;
    const d = new Date(s.startedAt);
    out.push({ key: s.id, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: Math.round(v * 10) / 10 });
  }
  return out.slice(-n);
}

/** Exercises that appear in the log, most recently used first. */
export function loggedExercises(sessions: Session[], custom: Exercise[] = []): { id: string; metric: Metric }[] {
  const seen = new Map<string, Metric>();
  for (const s of [...finished(sessions)].reverse())
    for (const e of s.exercises) if (!seen.has(e.exerciseId) && e.sets.some(isWorkingSet)) seen.set(e.exerciseId, metricOf(e, custom));
  return [...seen].map(([id, metric]) => ({ id, metric }));
}
