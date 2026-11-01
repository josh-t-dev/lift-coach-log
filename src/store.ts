import { useSyncExternalStore } from 'react';
import { DEFAULT_LLM } from './lib/llm';
import type { AppState, ExerciseLog, Session, SetLog, Template, TemplateExercise } from './types';

const KEY = 'workout-tracker:v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function initialState(): AppState {
  return {
    version: 1,
    unit: 'kg',
    profile: {
      goal: 'hypertrophy',
      experience: 'intermediate',
      daysPerWeek: 3,
      sessionMinutes: 60,
      equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'],
      notes: '',
    },
    llm: { ...DEFAULT_LLM },
    templates: [],
    sessions: [],
    active: null,
    customExercises: [],
    recommendation: null,
  };
}

/** Merge stored/imported data over defaults so new fields get sane values. */
export function hydrate(raw: unknown): AppState {
  const base = initialState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppState>;
  return {
    ...base,
    ...r,
    version: 1,
    profile: { ...base.profile, ...(r.profile ?? {}) },
    llm: { ...base.llm, ...(r.llm ?? {}) },
    templates: Array.isArray(r.templates) ? r.templates : [],
    sessions: Array.isArray(r.sessions) ? r.sessions : [],
    customExercises: Array.isArray(r.customExercises) ? r.customExercises : [],
    active: r.active ?? null,
    recommendation: r.recommendation ?? null,
  };
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
  return { id: uid(), weight, reps, rir: null, done: false };
}

export function exerciseLogFrom(t: TemplateExercise): ExerciseLog {
  return {
    id: uid(),
    exerciseId: t.exerciseId,
    sets: Array.from({ length: Math.max(1, t.sets) }, () => newSet(t.weight ?? null, null)),
    target: { repMin: t.repMin, repMax: t.repMax, rir: t.rir },
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
export function templateFromSession(s: Session): Template {
  return {
    id: uid(),
    name: s.name,
    updatedAt: new Date().toISOString(),
    exercises: s.exercises.map((e) => {
      const done = e.sets.filter((x) => x.done);
      const reps = done.map((x) => x.reps ?? 0).filter((r) => r > 0);
      const weights = done.map((x) => x.weight ?? 0);
      return {
        exerciseId: e.exerciseId,
        sets: Math.max(1, done.length || e.sets.length),
        repMin: e.target?.repMin ?? (reps.length ? Math.min(...reps) : 8),
        repMax: e.target?.repMax ?? (reps.length ? Math.max(...reps) : 12),
        rir: e.target?.rir,
        weight: weights.length ? Math.max(...weights) || null : null,
      };
    }),
  };
}

export function exportJson(): string {
  return JSON.stringify({ ...state, llm: { ...state.llm, apiKey: '' } }, null, 2);
}
