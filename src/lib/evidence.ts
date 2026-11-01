/**
 * The evidence base the planner and the LLM both work from.
 *
 * The numbers here drive the rule-based planner directly, and the
 * `principles` text is sent to the LLM as its system prompt so its
 * reasoning is anchored to the same guidelines.
 */
import type { Experience, Goal, PlanPrinciple } from '../types';

export interface Principle {
  id: string;
  rule: string;
  source: string;
}

export const PRINCIPLES: Principle[] = [
  {
    id: 'volume',
    rule:
      'Weekly volume drives hypertrophy in a dose-response way: roughly 10+ hard sets per muscle per week beats fewer. Beginners grow well on ~10; trained lifters often use 12–20. More is not always better: add volume only if recovery allows.',
    source: 'Schoenfeld, Ogborn & Krieger 2017 (J Sports Sci); Pelland et al. 2024 meta-regression',
  },
  {
    id: 'frequency',
    rule:
      'Train each muscle at least 2× per week. When weekly volume is equal, frequency matters little, so splitting the volume across sessions keeps quality high and sessions shorter.',
    source: 'Schoenfeld, Ogborn & Krieger 2016 (Sports Med); Schoenfeld, Grgic & Krieger 2019 (J Sports Sci)',
  },
  {
    id: 'effort',
    rule:
      'Hard sets should end close to failure: about RPE 7–10 (0–3 reps left in the tank). Going all the way to failure (RPE 10) is not required and costs more fatigue, especially on heavy compound lifts.',
    source: 'Refalo et al. 2023 (Sports Med); Robinson et al. 2024 (Sports Med); RPE scale: Zourdos et al. 2016 (J Strength Cond Res), Helms et al. 2016',
  },
  {
    id: 'load',
    rule:
      'For hypertrophy, loads from ~6–30 reps work similarly when sets are hard. For maximal strength, heavier loads (~1–6 reps, >80% 1RM) on the target lifts are superior.',
    source: 'Schoenfeld, Grgic, Ogborn & Krieger 2017 (J Strength Cond Res); Lopez et al. 2021 (Med Sci Sports Exerc)',
  },
  {
    id: 'progression',
    rule:
      'Progressive overload by double progression: once every working set reaches the top of the rep range at the target effort, increase load (~2–5% upper body, ~5–10% lower body); otherwise keep the load and add reps.',
    source: 'ACSM Position Stand on progression models in resistance training, 2009 (Med Sci Sports Exerc)',
  },
  {
    id: 'rest',
    rule: 'Rest about 2–3 minutes between sets of multi-joint lifts and ~1–2 minutes for isolation lifts; short rests reduce volume and gains.',
    source: 'Schoenfeld et al. 2016 (J Strength Cond Res); Grgic et al. 2017 (Eur J Sport Sci)',
  },
  {
    id: 'detraining',
    rule:
      'Strength and muscle are largely retained through ~2–3 weeks off; losses grow after that, and are regained faster than they were first built. After a break, return with reduced volume, slightly reduced loads and a lower RPE for a week rather than making up missed sessions.',
    source: 'Bosquet et al. 2013 (Scand J Med Sci Sports); Ogasawara et al. 2013 (Eur J Appl Physiol)',
  },
  {
    id: 'cardio',
    rule:
      'Aim for 150–300 minutes of moderate aerobic activity per week (or 75–150 vigorous). Combining cardio with lifting does not meaningfully blunt muscle growth or maximal strength; keep hard leg cardio away from heavy leg sessions if it hurts performance.',
    source: 'WHO Guidelines on Physical Activity, 2020; Schumann et al. 2022 (Sports Med) concurrent-training meta-analysis',
  },
  {
    id: 'sports',
    rule:
      'Sports and recreational activities count toward weekly aerobic minutes. Plan lifting around them: avoid heavy or high-volume lower-body sessions the day before a hard game or practice so performance and injury risk are not compromised.',
    source: 'Concurrent-training guidance; Schumann et al. 2022 (Sports Med); WHO 2020',
  },
  {
    id: 'minimum',
    rule: 'Public-health minimum: muscle-strengthening activity involving all major muscle groups on 2 or more days per week.',
    source: 'WHO Guidelines on Physical Activity and Sedentary Behaviour, 2020',
  },
];

/** Hard sets per muscle per week, by training age. */
export const WEEKLY_SET_TARGET: Record<Experience, { min: number; max: number }> = {
  beginner: { min: 8, max: 12 },
  intermediate: { min: 10, max: 16 },
  advanced: { min: 12, max: 20 },
};

/** Rep ranges by goal, separately for compound and isolation lifts. */
export const REP_RANGES: Record<Goal, { compound: [number, number]; isolation: [number, number] }> = {
  hypertrophy: { compound: [6, 10], isolation: [10, 15] },
  strength: { compound: [3, 6], isolation: [8, 12] },
  general: { compound: [8, 12], isolation: [10, 15] },
};

/** Default target RPE (RPE = 10 − reps in reserve). */
export const TARGET_RPE: Record<Experience, number> = {
  beginner: 7,
  intermediate: 8,
  advanced: 9,
};

/** How much to cut load and volume when coming back from time off. */
export const RETURN_ADJUSTMENT = [
  { minDaysOff: 28, loadCut: 0.15, volumeFactor: 0.6, label: 'long break (4+ weeks)' },
  { minDaysOff: 14, loadCut: 0.075, volumeFactor: 0.75, label: 'short break (2–3 weeks)' },
] as const;

/** Default weekly cardio minutes for a new plan. */
export const CARDIO_MINUTES: Record<Goal, number> = { hypertrophy: 60, strength: 60, general: 150 };

export function defaultPrinciples(): PlanPrinciple[] {
  return PRINCIPLES.map((p) => ({ ...p, enabled: true }));
}

export function principlesText(principles: PlanPrinciple[] = defaultPrinciples()): string {
  return principles
    .filter((p) => p.enabled && p.rule.trim())
    .map((p, i) => `${i + 1}. ${p.custom ? "[user's own rule] " : `[${p.id}] `}${p.rule.trim()}${p.source ? ` (Source: ${p.source})` : ''}`)
    .join('\n');
}
