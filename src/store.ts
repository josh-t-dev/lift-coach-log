import { useSyncExternalStore } from 'react';
import { findExercise } from './data/exercises';
import { DEFAULT_LLM, PRESETS } from './lib/providers';
import { generateBasePlan } from './lib/planner';
import type { AppState, BasePlan, Exercise, ExerciseLog, Profile, Session, SetLog, Template, TemplateExercise } from './types';

const KEY = 'workout-tracker:v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const DEFAULT_PROFILE: Profile = {
  goal: 'hypertrophy',
  experience: 'intermediate',
  daysPerWeek: 3,
  sessionMinutes: 60,
  equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'cardio'],
  notes: '',
};

export function initialState(): AppState {
  return {
    version: 3,
    unit: 'kg',
    distanceUnit: 'km',
    defaultRestSec: 90,
    plan: generateBasePlan(DEFAULT_PROFILE),
    planHistory: [],
    llm: { ...DEFAULT_LLM },
    templates: [],
    sessions: [],
    active: null,
    customExercises: [],
    recommendation: null,
    coachNotes: [],
  };
}

/**
 * Merge stored/imported data over defaults so new fields get sane values.
 * Version 1 kept a bare `profile`; it becomes the first Base Plan.
 */
export function hydrate(raw: unknown): AppState {
  const base = initialState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppState> & { profile?: Partial<Profile> };
  const custom: Exercise[] = (Array.isArray(r.customExercises) ? r.customExercises : []).map((e) => ({ ...e, metric: e.metric ?? 'weight_reps' }));
  migrateRirToRpe(r);
  const sessions = Array.isArray(r.sessions) ? r.sessions : [];
  let plan: BasePlan;
  if (r.plan && typeof r.plan === 'object') {
    plan = { ...base.plan, ...r.plan, profile: { ...DEFAULT_PROFILE, ...r.plan.profile }, activities: r.plan.activities ?? [] };
  } else {
    plan = generateBasePlan({ ...DEFAULT_PROFILE, ...(r.profile ?? {}) }, { sessions, custom });
  }
  // Version 3 split cardio machines (bike, rower…) out of 'machine'. Turn them on
  // once for existing data so cardio options don't silently disappear.
  if (((r as { version?: number }).version ?? 1) < 3) plan = withCardioEquipment(plan);
  return {
    ...base,
    unit: r.unit === 'lb' ? 'lb' : 'kg',
    distanceUnit: r.distanceUnit === 'mi' ? 'mi' : r.distanceUnit === 'km' ? 'km' : r.unit === 'lb' ? 'mi' : 'km',
    plan,
    planHistory: Array.isArray(r.planHistory) ? r.planHistory : [],
    defaultRestSec: typeof r.defaultRestSec === 'number' && r.defaultRestSec >= 0 ? r.defaultRestSec : 90,
    llm: migrateLlm({ ...base.llm, ...(r.llm ?? {}) }),
    templates: Array.isArray(r.templates) ? r.templates : [],
    sessions,
    customExercises: custom,
    active: r.active ?? null,
    recommendation: r.recommendation ?? null,
    coachNotes: Array.isArray(r.coachNotes) ? r.coachNotes.filter((n) => n && typeof n.text === 'string' && typeof n.at === 'string').slice(-50) : [],
  };
}

/** Older settings had no provider fields: infer them from the URL. */
function migrateLlm(l: AppState['llm']): AppState['llm'] {
  if (l.api && l.preset) return l;
  const match = PRESETS.find((p) => p.baseUrl === l.baseUrl);
  return { ...l, api: match?.api ?? 'openai', preset: match?.id ?? 'custom' };
}

/**
 * Version 2.0 stored reps in reserve (RIR); effort is now RPE.
 * RIR-based RPE: RPE = 10 − RIR (Zourdos et al. 2016).
 */
type Loose = Record<string, unknown>;
function migrateRirToRpe(r: Loose) {
  const conv = (o: Loose | undefined | null) => {
    if (!o || typeof o !== 'object' || !('rir' in o)) return;
    if (o.rpe === undefined) o.rpe = typeof o.rir === 'number' ? Math.max(1, 10 - o.rir) : o.rir;
    delete o.rir;
  };
  const sessionsOf = (x: unknown) => (Array.isArray(x) ? (x as Loose[]) : []);
  const fixSession = (s: Loose | null | undefined) => {
    for (const e of sessionsOf(s?.exercises)) {
      for (const set of sessionsOf(e.sets)) conv(set);
      conv(e.target as Loose);
    }
  };
  sessionsOf(r.sessions).forEach(fixSession);
  fixSession(r.active as Loose);
  for (const t of sessionsOf(r.templates)) sessionsOf(t.exercises).forEach(conv);
  const plans = [r.plan as Loose, ...sessionsOf(r.planHistory)].filter(Boolean);
  for (const p of plans) {
    conv(p);
    for (const d of sessionsOf(p.days)) sessionsOf(d.exercises).forEach(conv);
  }
  const rec = r.recommendation as Loose | null;
  if (rec) sessionsOf((rec.today as Loose)?.exercises).forEach(conv);
}

function load(): AppState {
  try {
    const s = localStorage.getItem(KEY);
    return s ? hydrate(JSON.parse(s)) : initialState();
  } catch {
    return initialState();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

/** Apply a change to a draft copy of the state and persist it. */
export function update(fn: (draft: AppState) => void): void {
  const draft = structuredClone(state);
  fn(draft);
  state = draft;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked: keep working in memory
  }
  listeners.forEach((l) => l());
}

export function replaceState(next: AppState): void {
  update((d) => Object.assign(d, next));
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// ---- Session helpers ----

export function newSet(weight: number | null = null, reps: number | null = null): SetLog {
  return { id: uid(), weight, reps, rpe: null, done: false };
}

export function exerciseLogFrom(t: TemplateExercise): ExerciseLog {
  return {
    id: uid(),
    exerciseId: t.exerciseId,
    metric: t.metric,
    restSec: t.restSec,
    sets: Array.from({ length: Math.max(1, t.sets) }, () => newSet(t.weight ?? null, null)),
    target: { repMin: t.repMin, repMax: t.repMax, rpe: t.rpe, minutes: t.minutes, distance: t.distance },
    note: t.note,
  };
}

export function startSession(name: string, exercises: TemplateExercise[], source: Session['source'], templateId?: string): void {
  update((d) => {
    d.active = {
      id: uid(),
      name,
      source,
      templateId,
      startedAt: new Date().toISOString(),
      exercises: exercises.map(exerciseLogFrom),
    };
  });
}

/** Turn a finished session into a reusable template. */
export function templateFromSession(s: Session, custom: Exercise[] = []): Template {
  return {
    id: uid(),
    name: s.name,
    updatedAt: new Date().toISOString(),
    exercises: s.exercises.map((e): TemplateExercise => {
      const done = e.sets.filter((x) => x.done);
      if ((e.metric ?? findExercise(e.exerciseId, custom)?.metric) === 'time_distance') {
        const sec = done.reduce((a, x) => a + (x.durationSec ?? 0), 0);
        const dist = done.reduce((a, x) => a + (x.distance ?? 0), 0);
        return { exerciseId: e.exerciseId, metric: e.metric, sets: Math.max(1, done.length), repMin: 0, repMax: 0, minutes: sec ? Math.round(sec / 60) : null, distance: dist || null };
      }
      const reps = done.map((x) => x.reps ?? 0).filter((r) => r > 0);
      const weights = done.map((x) => x.weight ?? 0);
      return {
        exerciseId: e.exerciseId,
        metric: e.metric,
        sets: Math.max(1, done.length || e.sets.length),
        repMin: e.target?.repMin ?? (reps.length ? Math.min(...reps) : 8),
        repMax: e.target?.repMax ?? (reps.length ? Math.max(...reps) : 12),
        rpe: e.target?.rpe,
        restSec: e.restSec,
        weight: weights.length ? Math.max(...weights) || null : null,
      };
    }),
  };
}

export function exportJson(): string {
  return JSON.stringify({ ...state, llm: { ...state.llm, apiKey: '' } }, null, 2);
}

/** Validate a plan file ({ kind: 'lift-log-plan', plan, customExercises }). */
function withCardioEquipment(plan: BasePlan): BasePlan {
  const eq = plan.profile.equipment;
  return eq.includes('cardio') ? plan : { ...plan, profile: { ...plan.profile, equipment: [...eq, 'cardio'] } };
}

export function importPlan(raw: unknown): { plan: BasePlan; customExercises: Exercise[] } {
  const r = raw as { kind?: string; version?: number; plan?: Partial<BasePlan>; customExercises?: Exercise[] };
  if (!r || r.kind !== 'lift-log-plan' || !r.plan || typeof r.plan !== 'object') throw new Error('missing "lift-log-plan" header');
  if (!Array.isArray(r.plan.days) || !r.plan.days.length) throw new Error('plan has no days');
  const base = generateBasePlan(DEFAULT_PROFILE);
  const p = r.plan;
  migrateRirToRpe({ plan: p } as Record<string, unknown>);
  const plan: BasePlan = {
    ...base,
    ...p,
    id: uid(),
    profile: { ...DEFAULT_PROFILE, ...(p.profile ?? {}) },
    setTargets: { ...base.setTargets, ...(p.setTargets ?? {}) },
    principles: Array.isArray(p.principles) ? p.principles : base.principles,
    activities: Array.isArray(p.activities) ? p.activities : [],
    days: p.days!.map((d) => ({ ...d, id: d.id || uid(), exercises: Array.isArray(d.exercises) ? d.exercises : [] })),
    updatedAt: new Date().toISOString(),
    endDate: undefined,
  };
  const finalPlan = (r.version ?? 1) < 2 ? withCardioEquipment(plan) : plan;
  const customExercises = (Array.isArray(r.customExercises) ? r.customExercises : [])
    .filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string')
    .map((e) => ({ ...e, metric: e.metric ?? 'weight_reps', primary: e.primary ?? [], secondary: e.secondary ?? [], custom: true }));
  return { plan: finalPlan, customExercises };
}
