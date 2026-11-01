export type Unit = 'kg' | 'lb';
export type DistanceUnit = 'km' | 'mi';

export const MUSCLES = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** How an exercise is logged. */
export type Metric = 'weight_reps' | 'time_distance';
export const METRIC_LABEL: Record<Metric, string> = {
  weight_reps: 'Weight & reps',
  time_distance: 'Time & distance',
};

export interface Exercise {
  id: string;
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  /** Multi-joint lift: longer rest, bigger load jumps. */
  compound: boolean;
  /** Lower-body lifts progress in bigger increments. */
  lowerBody: boolean;
  metric: Metric;
  /** Aerobic work, counted toward weekly cardio minutes. */
  cardio?: boolean;
  /** A sport or recreational activity (volleyball, yoga…). */
  sport?: boolean;
  custom?: boolean;
}

export interface SetLog {
  id: string;
  weight: number | null;
  reps: number | null;
  /** Rate of perceived exertion, 1–10 (10 = max effort, no reps left). Optional. */
  rpe: number | null;
  durationSec?: number | null;
  /** In the user's distance unit. */
  distance?: number | null;
  done: boolean;
}

export interface ExerciseLog {
  id: string;
  exerciseId: string;
  /** Overrides the exercise's default way of logging. */
  metric?: Metric;
  /** Rest between sets in seconds; falls back to the app default. */
  restSec?: number;
  sets: SetLog[];
  /** Target carried over from a template/plan, shown as a hint. */
  target?: { repMin: number; repMax: number; rpe?: number; minutes?: number | null; distance?: number | null };
  note?: string;
}

export interface Session {
  id: string;
  name: string;
  templateId?: string;
  source: 'blank' | 'template' | 'coach';
  startedAt: string;
  finishedAt?: string;
  exercises: ExerciseLog[];
}

export interface TemplateExercise {
  exerciseId: string;
  metric?: Metric;
  sets: number;
  repMin: number;
  repMax: number;
  /** Target RPE (1–10). */
  rpe?: number;
  restSec?: number;
  /** Suggested working weight in the user's unit. */
  weight?: number | null;
  /** Time & distance targets. */
  minutes?: number | null;
  distance?: number | null;
  note?: string;
}

export interface Template {
  id: string;
  name: string;
  exercises: TemplateExercise[];
  updatedAt: string;
}

export type Goal = 'hypertrophy' | 'strength' | 'general';
export type Experience = 'beginner' | 'intermediate' | 'advanced';

export interface Profile {
  goal: Goal;
  experience: Experience;
  daysPerWeek: number;
  sessionMinutes: number;
  equipment: Equipment[];
  notes: string;
}

export interface PlanPrinciple {
  id: string;
  rule: string;
  source: string;
  enabled: boolean;
  /** Written by the user rather than taken from the evidence base. */
  custom?: boolean;
}

export interface PlanDay {
  id: string;
  name: string;
  exercises: TemplateExercise[];
}

/**
 * The user's program for a training block (e.g. a quarter or a year).
 * Every coach request starts from this.
 */
export interface BasePlan {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  reviewDate: string; // YYYY-MM-DD
  /** Set when the block is archived. */
  endDate?: string;
  updatedAt: string;
  profile: Profile;
  /** Weekly hard-set target per muscle. */
  setTargets: Record<Muscle, number>;
  repRanges: { compound: [number, number]; isolation: [number, number] };
  /** Default target RPE for working sets. */
  rpe: number;
  cardioMinutes: number;
  principles: PlanPrinciple[];
  days: PlanDay[];
  /** Sports and other activities on fixed weekdays. */
  activities: Activity[];
}

export type Intensity = 'light' | 'moderate' | 'hard';

export interface Activity {
  id: string;
  exerciseId: string;
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[];
  minutes: number;
  intensity: Intensity;
}

export interface WeekPlanDay {
  day: string;
  focus: string;
  /** Sport/activity planned that day, e.g. "Volleyball 60 min". */
  activity?: string;
}

export interface Recommendation {
  createdAt: string;
  source: 'llm' | 'rules';
  /** The model name when source is 'llm'. */
  model?: string;
  planName?: string;
  headline: string;
  summary: string;
  rationale: string[];
  weekPlan: WeekPlanDay[];
  today: { name: string; exercises: TemplateExercise[] };
  /** Set when the LLM was tried but we fell back to rules. */
  warning?: string;
}

/** Wire format: OpenAI-style chat completions, or Anthropic's Messages API. */
export type LlmApi = 'openai' | 'anthropic';

export interface LlmSettings {
  enabled: boolean;
  api: LlmApi;
  /** Which preset the settings came from (for the UI). */
  preset: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Ask the server for JSON output (`response_format: json_object`). */
  jsonMode: boolean;
}

export interface AppState {
  version: 2;
  unit: Unit;
  distanceUnit: DistanceUnit;
  /** Default rest between sets, seconds. */
  defaultRestSec: number;
  plan: BasePlan;
  planHistory: BasePlan[];
  llm: LlmSettings;
  templates: Template[];
  sessions: Session[];
  active: Session | null;
  customExercises: Exercise[];
  recommendation: Recommendation | null;
}
