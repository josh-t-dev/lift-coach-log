import type { Equipment, Exercise, ExerciseLog, Metric, Muscle, TemplateExercise } from '../types';

function ex(
  id: string,
  name: string,
  primary: Muscle[],
  secondary: Muscle[],
  equipment: Equipment,
  compound: boolean,
  lowerBody = false,
): Exercise {
  return { id, name, primary, secondary, equipment, compound, lowerBody, metric: 'weight_reps' };
}

export function cardio(id: string, name: string, equipment: Equipment, primary: Muscle[] = []): Exercise {
  return { id, name, primary, secondary: [], equipment, compound: false, lowerBody: true, metric: 'time_distance', cardio: true };
}

export const EXERCISES: Exercise[] = [
  // Chest
  ex('bench-press', 'Barbell Bench Press', ['chest'], ['triceps', 'shoulders'], 'barbell', true),
  ex('incline-bench', 'Incline Barbell Bench Press', ['chest'], ['shoulders', 'triceps'], 'barbell', true),
  ex('db-bench', 'Dumbbell Bench Press', ['chest'], ['triceps', 'shoulders'], 'dumbbell', true),
  ex('incline-db-press', 'Incline Dumbbell Press', ['chest'], ['shoulders', 'triceps'], 'dumbbell', true),
  ex('machine-chest-press', 'Machine Chest Press', ['chest'], ['triceps', 'shoulders'], 'machine', true),
  ex('cable-fly', 'Cable Fly', ['chest'], [], 'cable', false),
  ex('pec-deck', 'Pec Deck', ['chest'], [], 'machine', false),
  ex('push-up', 'Push-Up', ['chest'], ['triceps', 'shoulders', 'core'], 'bodyweight', true),
  ex('dip', 'Dip', ['chest', 'triceps'], ['shoulders'], 'bodyweight', true),

  // Back
  ex('pull-up', 'Pull-Up', ['back'], ['biceps'], 'bodyweight', true),
  ex('chin-up', 'Chin-Up', ['back', 'biceps'], [], 'bodyweight', true),
  ex('lat-pulldown', 'Lat Pulldown', ['back'], ['biceps'], 'cable', true),
  ex('barbell-row', 'Barbell Row', ['back'], ['biceps', 'hamstrings'], 'barbell', true),
  ex('db-row', 'One-Arm Dumbbell Row', ['back'], ['biceps'], 'dumbbell', true),
  ex('seated-cable-row', 'Seated Cable Row', ['back'], ['biceps'], 'cable', true),
  ex('chest-supported-row', 'Chest-Supported Row', ['back'], ['biceps'], 'machine', true),
  ex('inverted-row', 'Inverted Row', ['back'], ['biceps', 'core'], 'bodyweight', true),

  // Shoulders
  ex('ohp', 'Overhead Press', ['shoulders'], ['triceps'], 'barbell', true),
  ex('db-shoulder-press', 'Dumbbell Shoulder Press', ['shoulders'], ['triceps'], 'dumbbell', true),
  ex('machine-shoulder-press', 'Machine Shoulder Press', ['shoulders'], ['triceps'], 'machine', true),
  ex('lateral-raise', 'Dumbbell Lateral Raise', ['shoulders'], [], 'dumbbell', false),
  ex('cable-lateral-raise', 'Cable Lateral Raise', ['shoulders'], [], 'cable', false),
  ex('face-pull', 'Face Pull', ['shoulders'], ['back'], 'cable', false),
  ex('rear-delt-fly', 'Rear Delt Fly', ['shoulders'], ['back'], 'dumbbell', false),

  // Arms
  ex('barbell-curl', 'Barbell Curl', ['biceps'], [], 'barbell', false),
  ex('db-curl', 'Dumbbell Curl', ['biceps'], [], 'dumbbell', false),
  ex('hammer-curl', 'Hammer Curl', ['biceps'], [], 'dumbbell', false),
  ex('cable-curl', 'Cable Curl', ['biceps'], [], 'cable', false),
  ex('triceps-pushdown', 'Triceps Pushdown', ['triceps'], [], 'cable', false),
  ex('overhead-triceps-ext', 'Overhead Triceps Extension', ['triceps'], [], 'cable', false),
  ex('skull-crusher', 'Skull Crusher', ['triceps'], [], 'barbell', false),
  ex('close-grip-bench', 'Close-Grip Bench Press', ['triceps', 'chest'], ['shoulders'], 'barbell', true),

  // Legs
  ex('back-squat', 'Back Squat', ['quads', 'glutes'], ['hamstrings', 'core'], 'barbell', true, true),
  ex('front-squat', 'Front Squat', ['quads'], ['glutes', 'core'], 'barbell', true, true),
  ex('leg-press', 'Leg Press', ['quads', 'glutes'], ['hamstrings'], 'machine', true, true),
  ex('hack-squat', 'Hack Squat', ['quads'], ['glutes'], 'machine', true, true),
  ex('goblet-squat', 'Goblet Squat', ['quads', 'glutes'], ['core'], 'dumbbell', true, true),
  ex('bulgarian-split-squat', 'Bulgarian Split Squat', ['quads', 'glutes'], ['hamstrings'], 'dumbbell', true, true),
  ex('walking-lunge', 'Walking Lunge', ['quads', 'glutes'], ['hamstrings'], 'dumbbell', true, true),
  ex('bodyweight-squat', 'Bodyweight Squat', ['quads', 'glutes'], [], 'bodyweight', true, true),
  ex('leg-extension', 'Leg Extension', ['quads'], [], 'machine', false, true),
  ex('deadlift', 'Deadlift', ['hamstrings', 'glutes', 'back'], ['quads', 'core'], 'barbell', true, true),
  ex('rdl', 'Romanian Deadlift', ['hamstrings', 'glutes'], ['back'], 'barbell', true, true),
  ex('db-rdl', 'Dumbbell Romanian Deadlift', ['hamstrings', 'glutes'], ['back'], 'dumbbell', true, true),
  ex('lying-leg-curl', 'Lying Leg Curl', ['hamstrings'], [], 'machine', false, true),
  ex('seated-leg-curl', 'Seated Leg Curl', ['hamstrings'], [], 'machine', false, true),
  ex('hip-thrust', 'Barbell Hip Thrust', ['glutes'], ['hamstrings'], 'barbell', true, true),
  ex('glute-bridge', 'Glute Bridge', ['glutes'], ['hamstrings'], 'bodyweight', false, true),
  ex('standing-calf-raise', 'Standing Calf Raise', ['calves'], [], 'machine', false, true),
  ex('seated-calf-raise', 'Seated Calf Raise', ['calves'], [], 'machine', false, true),
  ex('single-leg-calf-raise', 'Single-Leg Calf Raise', ['calves'], [], 'bodyweight', false, true),

  // Core
  ex('plank', 'Plank (reps = seconds)', ['core'], [], 'bodyweight', false),
  ex('hanging-leg-raise', 'Hanging Leg Raise', ['core'], [], 'bodyweight', false),
  ex('cable-crunch', 'Cable Crunch', ['core'], [], 'cable', false),
  ex('ab-wheel', 'Ab Wheel Rollout', ['core'], [], 'bodyweight', false),

  // Cardio (time & distance)
  cardio('run', 'Run', 'bodyweight'),
  cardio('walk', 'Walk / Hike', 'bodyweight'),
  cardio('bike', 'Cycling / Stationary Bike', 'machine'),
  cardio('rower', 'Rowing Machine', 'machine'),
  cardio('elliptical', 'Elliptical', 'machine'),
  cardio('stair-climber', 'Stair Climber', 'machine'),
  cardio('swim', 'Swim', 'bodyweight'),
  cardio('jump-rope', 'Jump Rope', 'bodyweight'),
  { ...cardio('farmer-carry', "Farmer's Carry", 'dumbbell', ['core']), cardio: false },

  // Power & athletic strength
  ex('trap-bar-deadlift', 'Trap Bar Deadlift', ['quads', 'glutes', 'hamstrings'], ['back', 'core'], 'barbell', true, true),
  ex('trap-bar-jump', 'Trap Bar Jump', ['quads', 'glutes'], ['calves'], 'barbell', true, true),
  ex('db-snatch', 'Dumbbell Snatch', ['glutes', 'shoulders'], ['hamstrings', 'core'], 'dumbbell', true, true),
  ex('nordic-curl', 'Nordic Hamstring Curl', ['hamstrings'], [], 'bodyweight', false, true),
  ex('copenhagen-plank', 'Copenhagen Adduction (reps/side)', ['core'], [], 'bodyweight', false, true),
  ex('pallof-press', 'Pallof Press (reps/side)', ['core'], [], 'cable', false),
  ex('med-ball-chest-pass', 'Med Ball Chest Pass', ['chest'], ['triceps', 'shoulders'], 'bodyweight', true),
  ex('explosive-push-up', 'Explosive Push-Up', ['chest'], ['triceps', 'shoulders'], 'bodyweight', true),
  ex('single-leg-hip-hinge', 'Single-Leg Hip Hinge', ['hamstrings', 'glutes'], ['core'], 'dumbbell', false, true),
  ex('resisted-static-lunge', 'Resisted Static Lunge (knee alignment)', ['quads', 'glutes'], [], 'cable', false, true),

  // Plyometrics (reps)
  ex('pogo-jumps', 'Pogo Jumps', ['calves'], [], 'bodyweight', false, true),
  ex('broad-jump', 'Broad Jump (stick)', ['quads', 'glutes'], ['hamstrings'], 'bodyweight', true, true),
  ex('lateral-bound', 'Lateral Bound (stick, reps/side)', ['glutes', 'quads'], [], 'bodyweight', true, true),
  ex('line-hops', 'Line Hops', ['calves'], [], 'bodyweight', false, true),
  ex('single-leg-hop', 'Single-Leg Hop (stick, reps/leg)', ['quads', 'calves'], ['glutes'], 'bodyweight', false, true),
  ex('hurdle-hops', 'Hurdle Hops', ['quads', 'calves'], ['glutes'], 'bodyweight', false, true),
  ex('drop-jump', 'Drop-to-Jump (30 cm)', ['quads', 'calves'], ['glutes'], 'bodyweight', false, true),

  // Sprints & bounding (seconds, metres)
  sprint('hill-sprint', 'Hill Sprint'),
  sprint('accel-sprint', 'Sprint (acceleration / hill)'),
  sprint('fly-sprint', 'Fly-In Sprint'),
  sprint('bounding', 'Bounding (alternate-leg)'),
  sprint('build-up', 'Build-Up / Stride'),
  sprint('sprint-test', 'Sprint Test (30/60/100 m)'),

  // Run sessions (minutes, distance)
  cardio('threshold-run', 'Threshold Run (interval)', 'bodyweight'),
  cardio('interval-1000', '1000 m Repeats', 'bodyweight'),
  cardio('interval-400', '400 m Repeats', 'bodyweight'),
  cardio('easy-run', 'Easy Run', 'bodyweight'),
  cardio('time-trial-5k', '5k Time Trial', 'bodyweight'),

  // Mobility, physio & breathing (reps or time)
  timed('diaphragmatic-breathing', 'Diaphragmatic Breathing (pelvic floor drop)'),
  timed('happy-baby', 'Happy Baby'),
  timed('deep-squat-hold', 'Deep Squat Hold'),
  timed('wide-child-pose', "Wide-Knee Child's Pose"),
  ex('hip-cars', 'Hip CARs (reps/side)', [], [], 'bodyweight', false, true),
  ex('90-90-pails', '90/90 Hip IR with PAILs/RAILs (rounds/side)', [], [], 'bodyweight', false, true),
  ex('short-foot', 'Short-Foot (5 s holds)', [], [], 'bodyweight', false, true),
  ex('banded-clamshell', 'Banded Clamshell', ['glutes'], [], 'bodyweight', false, true),
  ex('banded-march', 'Banded March (steps)', ['glutes'], [], 'bodyweight', false, true),
  timed('knee-to-wall', 'Knee-to-Wall Rocks'),
  timed('worlds-greatest', "World's Greatest Stretch"),
  timed('leg-swings', 'Leg Swings'),
  timed('eldoa-l5s1', 'ELDOA L5/S1'),

  // Sports & activities (time & distance; most count as cardio)
  sport('volleyball', 'Volleyball'),
  sport('basketball', 'Basketball'),
  sport('flag-football', 'Flag Football'),
  sport('soccer', 'Soccer'),
  sport('tennis', 'Tennis'),
  sport('pickleball', 'Pickleball'),
  sport('badminton', 'Badminton'),
  sport('hockey', 'Hockey'),
  sport('ultimate', 'Ultimate Frisbee'),
  sport('martial-arts', 'Martial Arts'),
  sport('climbing', 'Climbing', false),
  sport('golf', 'Golf (walking)'),
  sport('yoga', 'Yoga', false),
  sport('pilates', 'Pilates', false),
  sport('dance', 'Dance'),
];

function sprint(id: string, name: string): Exercise {
  return { ...cardio(id, name, 'bodyweight'), cardio: false, timeUnit: 'sec', distUnit: 'm' };
}

/** Mobility/breathing held for time (minutes), no muscles counted. */
function timed(id: string, name: string): Exercise {
  return { ...cardio(id, name, 'bodyweight'), cardio: false };
}

function sport(id: string, name: string, isCardio = true): Exercise {
  return { ...cardio(id, name, 'bodyweight'), cardio: isCardio, sport: true };
}

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

/** How a logged/planned exercise is tracked: the override if set, else the exercise default. */
export function metricOf(item: ExerciseLog | TemplateExercise, custom: Exercise[] = []): Metric {
  return item.metric ?? findExercise(item.exerciseId, custom)?.metric ?? 'weight_reps';
}

export function allExercises(custom: Exercise[]): Exercise[] {
  return [...EXERCISES, ...custom];
}

export function findExercise(id: string, custom: Exercise[] = []): Exercise | undefined {
  return BY_ID.get(id) ?? custom.find((e) => e.id === id);
}

export function exerciseName(id: string, custom: Exercise[] = []): string {
  return findExercise(id, custom)?.name ?? id;
}
