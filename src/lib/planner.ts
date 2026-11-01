/**
 * Two jobs:
 *  1. generateBasePlan(): build a starting program from the evidence base
 *     (the user then personalises it on the Plan tab).
 *  2. planWithRules(): turn the user's Base Plan + their log into this
 *     week's schedule and today's workout with progressed loads. This is the
 *     fallback when no LLM is available, and the baseline the LLM refines.
 */
import { allExercises, findExercise, metricOf } from '../data/exercises';
import type { BasePlan, Exercise, Muscle, PlanDay, Profile, Recommendation, Session, TemplateExercise, Unit, WeekPlanDay } from '../types';
import { MUSCLES } from '../types';
import { addDays, exerciseHistory, isoDate, sessionsBetween, snapshot, suggestLoad, weekStart, type TrainingSnapshot } from './analytics';
import { CARDIO_MINUTES, defaultPrinciples, REP_RANGES, TARGET_RIR, WEEKLY_SET_TARGET } from './evidence';

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

const rid = () => Math.random().toString(36).slice(2, 10);

function pickExercise(slot: Slot, profile: Profile, custom: Exercise[], known: Set<string>, used: Set<string>): Exercise | undefined {
  const avail = slot.options
    .map((id) => findExercise(id, custom))
    .filter((e): e is Exercise => !!e && profile.equipment.includes(e.equipment) && !used.has(e.id));
  // Prefer something already in the log so progression has history to build on.
  return avail.find((e) => known.has(e.id)) ?? avail[0];
}

function evidenceTargets(profile: Profile): Pick<BasePlan, 'setTargets' | 'repRanges' | 'rir' | 'cardioMinutes'> {
  // Start at the bottom of the evidence range — enough for most people to
  // grow, and achievable in a normal schedule. Raise priorities on the Plan tab.
  const t = WEEKLY_SET_TARGET[profile.experience];
  const small: Muscle[] = ['core', 'calves', 'biceps', 'triceps'];
  const setTargets = Object.fromEntries(MUSCLES.map((m) => [m, small.includes(m) ? Math.max(4, t.min - 4) : t.min])) as Record<Muscle, number>;
  return {
    setTargets,
    repRanges: { compound: [...REP_RANGES[profile.goal].compound], isolation: [...REP_RANGES[profile.goal].isolation] },
    rir: TARGET_RIR[profile.experience],
    cardioMinutes: CARDIO_MINUTES[profile.goal],
  };
}

/** Minutes per working set including rest (2–3 min) and the set itself. */
const MIN_PER_SET = 3.25;

/** Build the weekly days from the evidence-based split for a profile. */
export function generateDays(
  profile: Profile,
  targets: Pick<BasePlan, 'repRanges' | 'rir' | 'cardioMinutes'> & { setTargets?: Record<Muscle, number> },
  sessions: Session[] = [],
  custom: Exercise[] = [],
): PlanDay[] {
  const known = new Set(exerciseHistory(sessions).keys());
  // Cardio goes inside sessions only for general fitness; otherwise it's for rest days.
  const cardioPerDay = profile.goal === 'general' && targets.cardioMinutes > 0
    ? Math.min(20, Math.max(10, Math.round(targets.cardioMinutes / profile.daysPerWeek / 5) * 5))
    : 0;
  const maxSets = Math.max(8, Math.floor((profile.sessionMinutes - 5 - cardioPerDay) / MIN_PER_SET));
  const days = splitFor(profile.daysPerWeek).map((day) => {
    const used = new Set<string>();
    const exercises: TemplateExercise[] = [];
    let total = 0;
    for (const slot of day.slots) {
      const ex = pickExercise(slot, profile, custom, known, used);
      if (!ex) continue;
      used.add(ex.id);
      const [repMin, repMax] = targets.repRanges[slot.kind];
      // Start lean; the top-up below spends the rest of the time budget on
      // whichever muscles are furthest from target.
      // Main lifts (the first compounds of the day) start at 3 sets.
      const sets = slot.kind === 'compound' && exercises.length < 3 && profile.experience !== 'beginner' ? 3 : 2;
      if (total + sets > maxSets) break;
      total += sets;
      exercises.push({ exerciseId: ex.id, sets, repMin, repMax, rir: targets.rir });
    }
    return { id: rid(), name: day.name, exercises };
  });

  const cap = profile.experience === 'beginner' ? 3 : profile.experience === 'intermediate' ? 4 : 5;
  if (targets.setTargets) topUpToTargets(days, targets.setTargets, maxSets, cap, custom);
  else for (const d of days) for (const e of d.exercises) e.sets = Math.min(cap, 3);

  if (cardioPerDay) {
    const cardioId = profile.equipment.includes('machine') ? 'bike' : 'walk';
    for (const d of days)
      d.exercises.push({ exerciseId: cardioId, metric: 'time_distance', sets: 1, repMin: 0, repMax: 0, minutes: cardioPerDay, note: 'Easy pace — you can still hold a conversation' });
  }
  return days;
}

/**
 * Add sets to exercises for the muscles furthest below their weekly target,
 * up to `cap` sets per exercise and the session's set budget.
 */
function topUpToTargets(days: PlanDay[], targets: Record<Muscle, number>, maxSets: number, cap: number, custom: Exercise[]) {
  const dayTotal = (d: PlanDay) => d.exercises.reduce((a, e) => a + e.sets, 0);
  const stuck = new Set<Muscle>();
  for (let guard = 0; guard < 200; guard++) {
    const proj = projectedWeeklySets(days, custom);
    const worst = MUSCLES.filter((m) => !stuck.has(m) && targets[m] - proj[m] >= 1)
      .sort((a, b) => targets[b] - proj[b] - (targets[a] - proj[a]))[0];
    if (!worst) return;
    const candidates = days
      .filter((d) => dayTotal(d) < maxSets)
      .flatMap((d) => d.exercises.filter((e) => e.sets < cap && findExercise(e.exerciseId, custom)?.primary.includes(worst)).map((e) => ({ d, e })))
      .sort((a, b) => a.e.sets - b.e.sets || dayTotal(a.d) - dayTotal(b.d));
    if (!candidates.length) stuck.add(worst);
    else candidates[0].e.sets++;
  }
}

/** A complete evidence-based Base Plan for a training block. */
export function generateBasePlan(profile: Profile, opts: { sessions?: Session[]; custom?: Exercise[]; months?: number; name?: string; now?: Date } = {}): BasePlan {
  const now = opts.now ?? new Date();
  const months = opts.months ?? 3;
  const review = new Date(now);
  review.setMonth(review.getMonth() + months);
  const targets = evidenceTargets(profile);
  const q = Math.floor(now.getMonth() / 3) + 1;
  return {
    id: rid(),
    name: opts.name ?? `Q${q} ${now.getFullYear()} plan`,
    startDate: isoDate(now),
    reviewDate: isoDate(review),
    updatedAt: now.toISOString(),
    profile: structuredClone(profile),
    ...targets,
    principles: defaultPrinciples(),
    days: generateDays(profile, targets, opts.sessions, opts.custom),
  };
}

export function resetTargets(plan: BasePlan): Pick<BasePlan, 'setTargets' | 'repRanges' | 'rir' | 'cardioMinutes'> {
  return evidenceTargets(plan.profile);
}

// ---------------------------------------------------------------------------

export interface BuiltDay {
  name: string;
  exercises: (TemplateExercise & { loadReason?: string })[];
}

/** A Base Plan day with this week's loads, volume and effort applied. */
export function progressDay(day: PlanDay, plan: BasePlan, unit: Unit, sessions: Session[], snap: TrainingSnapshot, custom: Exercise[] = []): BuiltDay {
  const hist = exerciseHistory(sessions);
  const easing = snap.status === 'new' || snap.status === 'returning' || snap.status === 'detrained';
  const exercises = day.exercises.map((e) => {
    const ex = findExercise(e.exerciseId, custom);
    if (metricOf(e, custom) === 'time_distance') {
      const minutes = e.minutes ? Math.max(5, Math.round((e.minutes * snap.adjustment.volumeFactor) / 5) * 5) : e.minutes;
      return { ...e, sets: Math.max(1, e.sets), minutes };
    }
    const sets = Math.max(1, Math.round(e.sets * snap.adjustment.volumeFactor));
    const rir = Math.min(4, (e.rir ?? plan.rir) + (easing ? 1 : 0));
    const load = suggestLoad(hist.get(e.exerciseId), ex, e.repMin, e.repMax, unit, snap.adjustment.loadCut);
    return { ...e, sets, rir, weight: load.weight ?? e.weight ?? null, loadReason: load.reason };
  });
  return { name: day.name, exercises };
}

/** Choose the next plan day: the first one not yet done this week. */
export function nextDayIndex(days: { name: string }[], sessions: Session[], now: Date): number {
  const mon = weekStart(now);
  const doneNames = new Set(sessionsBetween(sessions, mon, addDays(mon, 7)).map((s) => s.name));
  const idx = days.findIndex((d) => !doneNames.has(d.name));
  return idx === -1 ? 0 : idx;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Spread the sessions over the next 7 days, starting today. */
export function weekPlanFrom(days: { name: string }[], startIdx: number, now: Date): WeekPlanDay[] {
  const n = days.length;
  const trainingOffsets = new Set(Array.from({ length: n }, (_, i) => Math.floor((i * 7) / n)));
  const out: WeekPlanDay[] = [];
  let k = 0;
  for (let off = 0; off < 7; off++) {
    const d = addDays(now, off);
    const label = off === 0 ? `Today (${WEEKDAYS[d.getDay()]})` : WEEKDAYS[d.getDay()];
    if (n && trainingOffsets.has(off)) {
      out.push({ day: label, focus: days[(startIdx + k) % n].name });
      k++;
    } else {
      out.push({ day: label, focus: 'Rest / easy cardio' });
    }
  }
  return out;
}

/** Weekly hard sets per muscle if every plan day is done once. */
export function projectedWeeklySets(days: { exercises: TemplateExercise[] }[], custom: Exercise[] = []): Record<Muscle, number> {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const d of days)
    for (const e of d.exercises) {
      const ex = findExercise(e.exerciseId, custom);
      if (!ex || ex.cardio) continue;
      for (const m of ex.primary) out[m] += e.sets;
      for (const m of ex.secondary) out[m] += e.sets * 0.5;
    }
  return out;
}

export function projectedCardioMinutes(days: { exercises: TemplateExercise[] }[], custom: Exercise[] = []): number {
  return days.reduce((a, d) => a + d.exercises.reduce((b, e) => b + (findExercise(e.exerciseId, custom)?.cardio ? (e.minutes ?? 0) : 0), 0), 0);
}

const HEADLINES: Record<TrainingSnapshot['status'], string> = {
  new: "Let's get started",
  'on-track': 'On track — keep progressing',
  'missed-last-week': "You missed last week — here's this week",
  returning: 'Welcome back — a lighter week to rebuild',
  detrained: 'Welcome back — easing in this week',
};

export interface PlannerInput {
  plan: BasePlan;
  unit: Unit;
  sessions: Session[];
  customExercises: Exercise[];
  now?: Date;
}

export interface PlannerOutput {
  recommendation: Recommendation;
  snapshot: TrainingSnapshot;
  todayDetail: BuiltDay;
  projected: Record<Muscle, number>;
}

export function planWithRules({ plan, unit, sessions, customExercises, now = new Date() }: PlannerInput): PlannerOutput {
  const snap = snapshot(sessions, plan, customExercises, now);
  const days = plan.days.length ? plan.days : generateDays(plan.profile, plan, sessions, customExercises);
  const idx = nextDayIndex(days, sessions, now);
  const today = progressDay(days[idx], plan, unit, sessions, snap, customExercises);
  const projected = projectedWeeklySets(days, customExercises);

  const rationale: string[] = [];
  switch (snap.status) {
    case 'new':
      rationale.push('First weeks: stop each set ~3 reps short of failure while you learn the lifts and find working weights.');
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
      rationale.push('Stop sets with an extra rep or two in reserve this week to limit soreness, then return to the full plan next week.');
      break;
    case 'on-track':
      rationale.push('Keep double progression going: add reps at the same weight until every set hits the top of the range, then add load.');
  }
  const under = MUSCLES.filter((m) => plan.setTargets[m] > 0 && projected[m] < plan.setTargets[m] * 0.8);
  rationale.push(
    under.length
      ? `Your plan's days give fewer weekly sets than your targets for: ${under.join(', ')}. That's usually session time — add a day or a few minutes, or lower those targets on the Plan tab.`
      : `Following "${plan.name}" as written meets your weekly set targets for every muscle.`,
  );
  if (plan.cardioMinutes > 0) {
    const left = Math.max(0, plan.cardioMinutes - snap.thisWeek.cardioMinutes);
    rationale.push(`Cardio: ${snap.thisWeek.cardioMinutes} of ${plan.cardioMinutes} min done this week${left ? ` — ${left} min to go` : ' — target met'}.`);
  }

  const recommendation: Recommendation = {
    createdAt: new Date().toISOString(),
    source: 'rules',
    planName: plan.name,
    headline: HEADLINES[snap.status],
    summary: `${snap.statusText} Today: ${today.name} from your plan "${plan.name}".`,
    rationale,
    weekPlan: weekPlanFrom(days, idx, now),
    today: { name: today.name, exercises: today.exercises.map(({ loadReason: _r, ...e }) => e) },
  };
  return { recommendation, snapshot: snap, todayDetail: today, projected };
}

export function availableExercises(profile: Profile, custom: Exercise[]): Exercise[] {
  return allExercises(custom).filter((e) => profile.equipment.includes(e.equipment) || e.custom);
}
