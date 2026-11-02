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

export const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'cardio'] as const;
/** How equipment is shown to the user. 'machine' = strength machines; 'cardio' = bike, rower, etc. */
export const EQUIPMENT_LABEL: Record<(typeof EQUIPMENT)[number], string> = {
  barbell: 'barbell',
  dumbbell: 'dumbbells',
  machine: 'strength machines',
  cable: 'cables',
  bodyweight: 'bodyweight',
  cardio: 'cardio machines (bike, rower…)',
};
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
  /** Time & distance units for this exercise: sprints use seconds and metres. */
  timeUnit?: 'sec' | 'min';
  distUnit?: 'm' | 'default';
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
  /** Week-by-week prescription for the block, e.g. ["6×20 m hills", "8×25 m hills", …]. */
  weekly?: string[];
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

export type Goal = 'hypertrophy' | 'strength' | 'athletic' | 'general';
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
  /** Suggested by the AI coach and accepted by the user. */
  aiSuggested?: boolean;
  /** Strength of the supporting evidence, when known. */
  evidence?: EvidenceLevel;
}

export type EvidenceLevel = 'strong' | 'moderate' | 'limited';

export interface PlanDay {
  id: string;
  name: string;
  /** Fixed weekdays (0 = Sun … 6 = Sat). Empty/absent = rotates into free days. All 7 = daily routine. */
  weekdays?: number[];
  /** Shown with the day, e.g. "Sprint first, lift after. 75 min." */
  note?: string;
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
  /** Plan-wide notes per week of the block, e.g. ["75–80% RPE 7", "80%", …]. */
  weekNotes?: string[];
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
  /** The coach changed this day from the base plan this week. */
  changed?: boolean;
  /** Calendar date (YYYY-MM-DD) this entry is for. */
  date?: string;
}

/** One change the coach made to this week, with its evidence-based reason. */
export interface PlanChange {
  day: string;
  change: string;
  reason: string;
  /** The principle or user rule it follows. */
  principle?: string;
  /** Calendar date (YYYY-MM-DD) of the changed day. */
  date?: string;
  /** Whether the change is for today only or affects the rest of the week. */
  scope?: 'today' | 'week';
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
  /** Changes from the base plan, each with its reason. */
  changes?: PlanChange[];
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
  version: 3;
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
  /** Notes the user sent the coach ("no space for broad jumps"), newest last. */
  coachNotes: CoachNote[];
}

export interface CoachNote {
  at: string; // ISO timestamp
  text: string;
}
