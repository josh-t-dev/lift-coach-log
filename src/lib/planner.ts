/**
 * Rule-based, evidence-driven planner. It produces a complete
 * recommendation on its own (used when no LLM is configured or the LLM
 * fails) and is also handed to the LLM as the baseline to refine.
 */
import { allExercises, findExercise } from '../data/exercises';
import type { Exercise, Muscle, PlanDay, Profile, Recommendation, Session, TemplateExercise, Unit } from '../types';
import { MUSCLES } from '../types';
import { exerciseHistory, snapshot, suggestLoad, weekStart, addDays, sessionsBetween, type TrainingSnapshot } from './analytics';
import { REP_RANGES, TARGET_RIR } from './evidence';

interface Slot {
  kind: 'compound' | 'isolation';
  /** Preferred exercises in order; the first available one is used. */
  options: string[];
}

interface DayTemplate {
  name: string;
  slots: Slot[];
}

const C = (...options: string[]): Slot => ({ kind: 'compound', options });
const I = (...options: string[]): Slot => ({ kind: 'isolation', options });

const SQUAT = C('back-squat', 'leg-press', 'hack-squat', 'goblet-squat', 'bulgarian-split-squat', 'bodyweight-squat');
const SQUAT_ALT = C('leg-press', 'front-squat', 'hack-squat', 'bulgarian-split-squat', 'goblet-squat', 'bodyweight-squat');
const LUNGE = C('bulgarian-split-squat', 'walking-lunge', 'leg-press', 'goblet-squat', 'bodyweight-squat');
const HINGE = C('rdl', 'db-rdl', 'deadlift', 'hip-thrust', 'glute-bridge');
const HINGE_HEAVY = C('deadlift', 'rdl', 'db-rdl', 'hip-thrust', 'glute-bridge');
const HAM_CURL = I('lying-leg-curl', 'seated-leg-curl', 'db-rdl', 'glute-bridge');
const GLUTE = C('hip-thrust', 'glute-bridge', 'bulgarian-split-squat');
const QUAD_ISO = I('leg-extension', 'goblet-squat', 'bodyweight-squat');
const CALF = I('standing-calf-raise', 'seated-calf-raise', 'single-leg-calf-raise');
const BENCH = C('bench-press', 'db-bench', 'machine-chest-press', 'push-up');
const INCLINE = C('incline-db-press', 'incline-bench', 'machine-chest-press', 'push-up');
const CHEST_ISO = I('cable-fly', 'pec-deck', 'push-up');
const ROW = C('barbell-row', 'chest-supported-row', 'seated-cable-row', 'db-row', 'inverted-row');
const ROW_ALT = C('seated-cable-row', 'db-row', 'chest-supported-row', 'inverted-row');
const VPULL = C('pull-up', 'lat-pulldown', 'chin-up', 'inverted-row');
const VPULL_ALT = C('lat-pulldown', 'chin-up', 'pull-up', 'inverted-row');
const OHP = C('ohp', 'db-shoulder-press', 'machine-shoulder-press', 'push-up');
const LATERAL = I('lateral-raise', 'cable-lateral-raise');
const REAR = I('face-pull', 'rear-delt-fly');
const CURL = I('db-curl', 'cable-curl', 'barbell-curl', 'hammer-curl', 'chin-up');
const HAMMER = I('hammer-curl', 'db-curl', 'cable-curl');
const TRI = I('triceps-pushdown', 'overhead-triceps-ext', 'skull-crusher', 'dip', 'push-up');
const TRI_OH = I('overhead-triceps-ext', 'skull-crusher', 'triceps-pushdown', 'dip');
const CORE = I('hanging-leg-raise', 'cable-crunch', 'ab-wheel', 'plank');

const DAYS: Record<string, DayTemplate> = {
  fullA: { name: 'Full Body A', slots: [SQUAT, BENCH, ROW, HAM_CURL, LATERAL, CURL] },
  fullB: { name: 'Full Body B', slots: [HINGE, OHP, VPULL, LUNGE, CHEST_ISO, TRI] },
  fullC: { name: 'Full Body C', slots: [SQUAT_ALT, INCLINE, ROW_ALT, GLUTE, REAR, CALF, CORE] },
  upperA: { name: 'Upper A', slots: [BENCH, ROW, OHP, VPULL_ALT, CURL, TRI] },
  upperB: { name: 'Upper B', slots: [INCLINE, VPULL, ROW_ALT, LATERAL, HAMMER, TRI_OH] },
  lowerA: { name: 'Lower A', slots: [SQUAT, HINGE, HAM_CURL, QUAD_ISO, CALF, CORE] },
  lowerB: { name: 'Lower B', slots: [HINGE_HEAVY, SQUAT_ALT, GLUTE, HAM_CURL, CALF] },
  push: { name: 'Push', slots: [BENCH, OHP, INCLINE, LATERAL, TRI_OH] },
  pull: { name: 'Pull', slots: [VPULL, ROW, ROW_ALT, REAR, CURL, HAMMER] },
  legs: { name: 'Legs', slots: [SQUAT, HINGE, LUNGE, HAM_CURL, CALF, CORE] },
};

export function splitFor(daysPerWeek: number): DayTemplate[] {
  const d = DAYS;
  switch (Math.max(1, Math.min(6, Math.round(daysPerWeek)))) {
    case 1: return [d.fullA];
    case 2: return [d.fullA, d.fullB];
    case 3: return [d.fullA, d.fullB, d.fullC];
    case 4: return [d.upperA, d.lowerA, d.upperB, d.lowerB];
    case 5: return [d.upperA, d.lowerA, d.push, d.pull, d.legs];
    default: return [d.push, d.pull, d.legs, { ...d.push, name: 'Push B' }, { ...d.pull, name: 'Pull B' }, { ...d.legs, name: 'Legs B' }];
  }
}

function pickExercise(slot: Slot, profile: Profile, custom: Exercise[], known: Set<string>, used: Set<string>): Exercise | undefined {
  const avail = slot.options
    .map((id) => findExercise(id, custom))
    .filter((e): e is Exercise => !!e && profile.equipment.includes(e.equipment) && !used.has(e.id));
  // Prefer something already in the log so progression has history to build on.
  return avail.find((e) => known.has(e.id)) ?? avail[0];
}

export interface BuiltDay {
  name: string;
  exercises: (TemplateExercise & { loadReason: string })[];
}

export function buildDay(
  day: DayTemplate,
  profile: Profile,
  unit: Unit,
  sessions: Session[],
  snap: TrainingSnapshot,
  custom: Exercise[] = [],
): BuiltDay {
  const hist = exerciseHistory(sessions);
  const known = new Set(hist.keys());
  const used = new Set<string>();
  const easing = snap.status === 'new' || snap.status === 'returning' || snap.status === 'detrained';
  const rir = Math.min(4, TARGET_RIR[profile.experience] + (easing ? 1 : 0));
  // Keep sessions near the requested length: ~4 min per set incl. rest and warm-up.
  const maxSets = Math.max(8, Math.floor(profile.sessionMinutes / 4));

  const exercises: BuiltDay['exercises'] = [];
  let total = 0;
  for (const slot of day.slots) {
    const ex = pickExercise(slot, profile, custom, known, used);
    if (!ex) continue;
    used.add(ex.id);
    const [repMin, repMax] = REP_RANGES[profile.goal][slot.kind];
    let sets = profile.experience === 'beginner' ? 2 : 3;
    if (slot.kind === 'compound' && profile.experience === 'advanced') sets = 4;
    sets = Math.max(2, Math.round(sets * snap.adjustment.volumeFactor));
    if (total + sets > maxSets) {
      if (maxSets - total >= 2) sets = maxSets - total;
      else break;
    }
    total += sets;
    const load = suggestLoad(hist.get(ex.id), ex, repMin, repMax, unit, snap.adjustment.loadCut);
    exercises.push({ exerciseId: ex.id, sets, repMin, repMax, rir, weight: load.weight, loadReason: load.reason });
  }
  return { name: day.name, exercises };
}

/** Choose the next split day: the first one not yet done this week. */
export function nextDayIndex(split: DayTemplate[], sessions: Session[], now: Date): number {
  const mon = weekStart(now);
  const doneNames = new Set(sessionsBetween(sessions, mon, addDays(mon, 7)).map((s) => s.name));
  const idx = split.findIndex((d) => !doneNames.has(d.name));
  return idx === -1 ? 0 : idx;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Spread the sessions over the next 7 days, starting today. */
export function weekPlanFrom(split: DayTemplate[], startIdx: number, now: Date): PlanDay[] {
  const n = split.length;
  const trainingOffsets = new Set(Array.from({ length: n }, (_, i) => Math.floor((i * 7) / n)));
  const out: PlanDay[] = [];
  let k = 0;
  for (let off = 0; off < 7; off++) {
    const d = addDays(now, off);
    const label = off === 0 ? `Today (${WEEKDAYS[d.getDay()]})` : WEEKDAYS[d.getDay()];
    if (trainingOffsets.has(off)) {
      out.push({ day: label, focus: split[(startIdx + k) % n].name });
      k++;
    } else {
      out.push({ day: label, focus: 'Rest / walk' });
    }
  }
  return out;
}

/** Weekly hard sets per muscle if the whole split is done as planned. */
export function projectedWeeklySets(days: BuiltDay[], custom: Exercise[] = []): Record<Muscle, number> {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const d of days)
    for (const e of d.exercises) {
      const ex = findExercise(e.exerciseId, custom);
      if (!ex) continue;
      for (const m of ex.primary) out[m] += e.sets;
      for (const m of ex.secondary) out[m] += e.sets * 0.5;
    }
  return out;
}

const HEADLINES: Record<TrainingSnapshot['status'], string> = {
  new: "Let's get started",
  'on-track': 'On track — keep progressing',
  'missed-last-week': "You missed last week — here's this week",
  returning: 'Welcome back — a lighter week to rebuild',
  detrained: 'Welcome back — easing in this week',
};

export interface PlannerInput {
  profile: Profile;
  unit: Unit;
  sessions: Session[];
  customExercises: Exercise[];
  now?: Date;
}

export interface PlannerOutput {
  recommendation: Recommendation;
  snapshot: TrainingSnapshot;
  todayDetail: BuiltDay;
  allDays: BuiltDay[];
  projected: Record<Muscle, number>;
}

export function planWithRules({ profile, unit, sessions, customExercises, now = new Date() }: PlannerInput): PlannerOutput {
  const snap = snapshot(sessions, profile, customExercises, now);
  const split = splitFor(profile.daysPerWeek);
  const idx = nextDayIndex(split, sessions, now);
  const allDays = split.map((d) => buildDay(d, profile, unit, sessions, snap, customExercises));
  const today = allDays[idx];
  const projected = projectedWeeklySets(allDays, customExercises);

  const rationale: string[] = [];
  switch (snap.status) {
    case 'new':
      rationale.push('First weeks: 2–3 sets per exercise, stopping ~3 reps short of failure, while you learn the lifts and find working weights.');
      break;
    case 'missed-last-week':
      rationale.push("One missed week doesn't cost measurable strength or muscle (Bosquet et al. 2013), so pick up where you left off.");
      rationale.push("Don't cram missed sessions into this week — extra fatigue won't make up the volume. Just get this week's sessions in.");
      break;
    case 'returning':
    case 'detrained':
      rationale.push(
        `After a ${snap.adjustment.reason}, loads are cut ~${Math.round(snap.adjustment.loadCut * 100)}% and volume to ~${Math.round(snap.adjustment.volumeFactor * 100)}% for this week; strength comes back faster than it was first built.`,
      );
      rationale.push('Stop sets with an extra rep or two in reserve this week to limit soreness, then return to normal next week.');
      break;
    case 'on-track':
      rationale.push('Keep double progression going: add reps at the same weight until every set hits the top of the range, then add load.');
  }
  const focusMuscles = (['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes'] as Muscle[])
    .map((m) => `${m} ${fmt(projected[m])}`)
    .join(', ');
  rationale.push(
    `${split.length}-day ${split.length >= 4 ? 'split' : 'full-body'} plan hits each major muscle ~2×/week. Planned weekly hard sets: ${focusMuscles} (target ${snap.setTarget.min}–${snap.setTarget.max}).`,
  );
  const [cMin, cMax] = REP_RANGES[profile.goal].compound;
  rationale.push(`Goal: ${profile.goal}. Compounds ${cMin}–${cMax} reps, rest 2–3 min; isolation work rest 1–2 min.`);

  const recommendation: Recommendation = {
    createdAt: new Date().toISOString(),
    source: 'rules',
    headline: HEADLINES[snap.status],
    summary: `${snap.statusText} Today: ${today.name}.`,
    rationale,
    weekPlan: weekPlanFrom(split, idx, now),
    today: { name: today.name, exercises: today.exercises.map(({ loadReason: _r, ...e }) => e) },
  };
  return { recommendation, snapshot: snap, todayDetail: today, allDays, projected };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function availableExercises(profile: Profile, custom: Exercise[]): Exercise[] {
  return allExercises(custom).filter((e) => profile.equipment.includes(e.equipment));
}
