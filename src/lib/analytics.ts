/**
 * Deterministic analysis of the training log. Everything the coach knows
 * about "you" comes from here: weekly volume per muscle, adherence, time
 * off, and per-exercise performance with a suggested next load.
 */
import { findExercise } from '../data/exercises';
import type { Exercise, Muscle, Profile, Session, SetLog, Unit } from '../types';
import { MUSCLES } from '../types';
import { RETURN_ADJUSTMENT, WEEKLY_SET_TARGET } from './evidence';

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

/** A completed working set: ticked off with reps logged. */
export function isWorkingSet(s: SetLog): boolean {
  return s.done && (s.reps ?? 0) > 0;
}

export function sessionsBetween(sessions: Session[], from: Date, to: Date): Session[] {
  return finished(sessions).filter((s) => {
    const t = new Date(s.startedAt).getTime();
    return t >= from.getTime() && t < to.getTime();
  });
}

/**
 * Hard sets per muscle. A set counts 1 for each primary muscle and 0.5 for
 * each secondary muscle — the common "fractional set" convention.
 */
export function setsPerMuscle(sessions: Session[], custom: Exercise[] = []): Record<Muscle, number> {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const s of sessions) {
    for (const log of s.exercises) {
      const ex = findExercise(log.exerciseId, custom);
      if (!ex) continue;
      const n = log.sets.filter(isWorkingSet).length;
      for (const m of ex.primary) out[m] += n;
      for (const m of ex.secondary) out[m] += n * 0.5;
    }
  }
  return out;
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
  thisWeek: { sessions: number; setsPerMuscle: Record<Muscle, number> };
  lastWeek: { sessions: number; setsPerMuscle: Record<Muscle, number> };
  setTarget: { min: number; max: number };
  /** Load cut and volume factor to apply this week (1 = normal). */
  adjustment: { loadCut: number; volumeFactor: number; reason: string | null };
}

export function snapshot(
  sessions: Session[],
  profile: Profile,
  custom: Exercise[] = [],
  now: Date = new Date(),
): TrainingSnapshot {
  const done = finished(sessions);
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
    thisWeek: { sessions: thisWeekSessions.length, setsPerMuscle: setsPerMuscle(thisWeekSessions, custom) },
    lastWeek: { sessions: lastWeekSessions.length, setsPerMuscle: setsPerMuscle(lastWeekSessions, custom) },
    setTarget: WEEKLY_SET_TARGET[profile.experience],
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

export interface ExerciseHistory {
  exerciseId: string;
  lastDate: string;
  /** Working sets from the most recent session with this exercise. */
  lastSets: { weight: number; reps: number; rir: number | null }[];
  bestE1rm: number;
  sessions: number;
}

export function exerciseHistory(sessions: Session[]): Map<string, ExerciseHistory> {
  const out = new Map<string, ExerciseHistory>();
  for (const s of finished(sessions)) {
    for (const log of s.exercises) {
      const sets = log.sets
        .filter(isWorkingSet)
        .map((x) => ({ weight: x.weight ?? 0, reps: x.reps ?? 0, rir: x.rir }));
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
 * rep range, add load; if sets fell short of the bottom, hold or back off;
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
