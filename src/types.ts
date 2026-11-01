export type Unit = 'kg' | 'lb';

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
  custom?: boolean;
}

export interface SetLog {
  id: string;
  weight: number | null;
  reps: number | null;
  /** Reps in reserve (how many more reps you could have done). Optional. */
  rir: number | null;
  done: boolean;
}

export interface ExerciseLog {
  id: string;
  exerciseId: string;
  sets: SetLog[];
  /** Target carried over from a template/plan, shown as a hint. */
  target?: { repMin: number; repMax: number; rir?: number };
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
  sets: number;
  repMin: number;
  repMax: number;
  rir?: number;
  /** Suggested working weight in the user's unit. */
  weight?: number | null;
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

export interface LlmSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Ask the server for JSON output (`response_format: json_object`). */
  jsonMode: boolean;
}

export interface PlanDay {
  day: string;
  focus: string;
}

export interface Recommendation {
  createdAt: string;
  source: 'llm' | 'rules';
  /** The model name when source is 'llm'. */
  model?: string;
  headline: string;
  summary: string;
  rationale: string[];
  weekPlan: PlanDay[];
  today: { name: string; exercises: TemplateExercise[] };
  /** Set when the LLM was tried but we fell back to rules. */
  warning?: string;
}

export interface AppState {
  version: 1;
  unit: Unit;
  profile: Profile;
  llm: LlmSettings;
  templates: Template[];
  sessions: Session[];
  active: Session | null;
  customExercises: Exercise[];
  recommendation: Recommendation | null;
}
