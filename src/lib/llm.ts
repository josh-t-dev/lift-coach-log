/**
 * Builds the coach's prompts and validates its answers. The transport (Ollama,
 * Hugging Face, Claude, …) lives in providers.ts.
 *
 * The model never sees raw guesswork: it gets the evidence principles as
 * its system prompt, plus a computed snapshot of the user's training and
 * a rule-based baseline plan, and must answer with JSON we validate.
 */
import { allExercises, findExercise, metricOf } from '../data/exercises';
import type { BasePlan, EvidenceLevel, Exercise, LlmSettings, Recommendation, SetLog, TemplateExercise, WeekPlanDay } from '../types';
import { exerciseHistory, isWorkingSet } from './analytics';
import { principlesText } from './evidence';
import { activityLabel, availableExercises, isDaily, isPinned, planWithRules, type PlannerInput, type PlannerOutput } from './planner';
import { chat } from './providers';

export { DEFAULT_LLM } from './providers';

export function buildSystemPrompt(plan: BasePlan): string {
  return `You are an evidence-based strength and conditioning coach inside a workout tracking app.

Everything you recommend must be grounded in scientific evidence: peer-reviewed research, systematic reviews and meta-analyses, or recognized position stands and consensus statements. Where the evidence is mixed or weak, say so rather than overstating it. Never invent studies or citations. Tie each rationale point to one of the principles below or to the user's own data.

The user's training principles for this block. The research-backed ones come with sources; rules marked [user's own rule] are the user's personal preferences and must be respected unless they would clearly be unsafe:
${principlesText(plan.principles)}

Rules:
- The user's BASE_PLAN ("${plan.name}") is their chosen program for this training block. Build the week from its days in order, and base today's workout on one BASE_PLAN day.
- Keep the BASE_PLAN's exercises, sets and rep ranges unless the user's status (time off), their request, or one of their rules requires a change. Explain every change in the rationale.
- Start from BASELINE (the base plan day with this week's progressed loads already worked out). Use its weights unless you have a data-backed reason; use null when unknown.
- Base every recommendation on the user's actual data provided. Never invent history.
- Only use exercise ids from AVAILABLE_EXERCISES.
- "today" is the main session in BASELINE.today. Never return a "daily" routine (e.g. a morning routine) as today's workout; the app shows routines separately.
- weekPlan has exactly 7 entries starting with TODAY, using short day names (Sun, Mon, Tue…). The app keeps fixed-weekday days on their weekdays regardless.
- BASE_PLAN days with fixed weekdays stay on those weekdays. "daily" days are routines done every day. Each exercise's "thisWeek" is the prescription for the current week of the block and overrides its default sets/reps; put it in the exercise note.
- If STATUS.missedThisWeek lists sessions, don't schedule make-up sessions on top of the week; apply the user's own rules (e.g. a drop order or minimum viable week) and say what to skip or merge.
- Effort is RPE on a 1–10 scale (10 = no reps left, 8 = about 2 reps left). Prescribe "rpe" per exercise.
- BASE_PLAN.weeklyActivities are fixed sports/activities. Keep them in the weekPlan on their days, schedule lifting around them, avoid heavy lower-body lifting the day before a hard activity, and count their minutes toward cardio.
- Exercises with metric "time_distance" (cardio, carries) use "minutes" and "distance" (in the user's distance unit) instead of reps and weight. Count cardio minutes toward the weekly cardio target.
- Never prescribe "making up" missed sessions by cramming extra volume. After time off, reduce load and volume as the principles say.
- Be direct and encouraging. The headline speaks to the user (e.g. "You missed last week — here's this week").
- You are not a medical provider: if the user mentions pain or injury, keep it conservative and suggest seeing a professional.

Reply with ONLY a JSON object, no markdown, matching:
{
  "headline": string,                 // <= 70 chars
  "summary": string,                  // 1-3 sentences on this week and why
  "rationale": string[],              // 2-5 bullets, each tied to a principle or the user's data
  "weekPlan": [{"day": string, "focus": string, "activity": string|null}],  // the next 7 days starting today; activity = sport that day
  "today": {
    "name": string,
    "exercises": [{"exerciseId": string, "sets": number, "repMin": number, "repMax": number, "rpe": number, "weight": number|null, "minutes": number|null, "distance": number|null, "note": string}]
  }
}`;
}

/** Exercises the model may use: anything matching the equipment, plus anything already in the plan. */
export function exercisePool(plan: BasePlan, custom: Exercise[]): Exercise[] {
  const planIds = new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)));
  const avail = new Set(availableExercises(plan.profile, custom).map((e) => e.id));
  return allExercises(custom).filter((e) => planIds.has(e.id) || avail.has(e.id));
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtSet(x: SetLog, metric: string): string {
  if (metric === 'time_distance') return `${Math.round((x.durationSec ?? 0) / 6) / 10}min${x.distance ? ` ${x.distance}dist` : ''}`;
  return `${x.weight ?? 0}x${x.reps}${x.rpe != null ? `@RPE${x.rpe}` : ''}`;
}

export function buildUserPrompt(input: PlannerInput & { distanceUnit?: string }, base: PlannerOutput, request = ''): string {
  const { plan, unit, sessions, customExercises } = input;
  const hist = exerciseHistory(sessions);
  const name = (id: string) => findExercise(id, customExercises)?.name ?? id;
  const planEx = (e: TemplateExercise) => {
    const m = metricOf(e, customExercises);
    return m === 'time_distance'
      ? { id: e.exerciseId, name: name(e.exerciseId), metric: m, minutes: e.minutes ?? null, distance: e.distance ?? null }
      : { id: e.exerciseId, name: name(e.exerciseId), sets: e.sets, reps: `${e.repMin}-${e.repMax}`, rpe: e.rpe ?? plan.rpe };
  };

  const recent = [...sessions]
    .filter((s) => s.finishedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 8)
    .map((s) => ({
      date: s.startedAt.slice(0, 10),
      name: s.name,
      exercises: s.exercises
        .map((e) => ({ exercise: name(e.exerciseId), sets: e.sets.filter(isWorkingSet).map((x) => fmtSet(x, metricOf(e, customExercises))) }))
        .filter((e) => e.sets.length),
    }));

  const lifts = [...hist.values()]
    .filter((h) => h.lastSets.some((s) => s.reps > 0))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
    .slice(0, 20)
    .map((h) => ({ exercise: name(h.exerciseId), id: h.exerciseId, last: h.lastDate, lastSets: h.lastSets.map((s) => `${s.weight}x${s.reps}`), bestE1rm: h.bestE1rm }));

  const pool = exercisePool(plan, customExercises);

  const ctx = {
    TODAY: base.snapshot.today,
    UNITS: { weight: unit, distance: input.distanceUnit ?? 'km' },
    BASE_PLAN: {
      name: plan.name,
      block: `${plan.startDate} to ${plan.reviewDate}`,
      profile: plan.profile,
      weeklySetTargetsPerMuscle: plan.setTargets,
      repRanges: plan.repRanges,
      defaultRpe: plan.rpe,
      weeklyActivities: (plan.activities ?? []).map((a) => ({ activity: activityLabel(a, customExercises), days: a.weekdays.map((w) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w]), intensity: a.intensity })),
      weeklyCardioMinutesTarget: plan.cardioMinutes,
      currentBlockWeek: `${base.block.week} of ${base.block.total}`,
      thisWeekNote: plan.weekNotes?.[base.block.week - 1] ?? null,
      days: plan.days.map((d) => ({
        name: d.name,
        weekdays: d.weekdays?.length ? (d.weekdays.length >= 7 ? 'daily' : d.weekdays.map((w) => WD[w])) : 'rotating',
        note: d.note ?? undefined,
        exercises: d.exercises.map((e) => ({ ...planEx(e), thisWeek: e.weekly?.[base.block.week - 1] ?? undefined })),
      })),
    },
    STATUS: {
      status: base.snapshot.status,
      text: base.snapshot.statusText,
      daysSinceLastWorkout: base.snapshot.daysSinceLast,
      sessionsPerWeek_last4WeeksThenCurrent: base.snapshot.weeks.map((w) => `${w.weekOf}: ${w.sessions}/${w.target}`),
      adherence4wk: base.snapshot.adherence4wk,
      thisWeekSetsPerMuscle: base.snapshot.thisWeek.setsPerMuscle,
      lastWeekSetsPerMuscle: base.snapshot.lastWeek.setsPerMuscle,
      cardioMinutes: { thisWeek: base.snapshot.thisWeek.cardioMinutes, lastWeek: base.snapshot.lastWeek.cardioMinutes },
      returnAdjustment: base.snapshot.adjustment,
      missedThisWeek: base.missed,
    },
    RECENT_SESSIONS: recent,
    LIFT_HISTORY: lifts,
    BASELINE: {
      headline: base.recommendation.headline,
      weekPlan: base.recommendation.weekPlan,
      projectedWeeklySets: base.projected,
      today: {
        name: base.todayDetail.name,
        exercises: base.todayDetail.exercises.map((e) => ({ ...e, name: name(e.exerciseId), metric: metricOf(e, customExercises) })),
      },
    },
    AVAILABLE_EXERCISES: pool.map((e) => `${e.id} (${e.name}; ${e.metric === 'time_distance' ? 'time_distance' : e.primary.join('/')})`),
  };

  const ask = request.trim() ? `\n\nMy request for today (follow it if it's consistent with the principles): ${request.trim()}` : '';
  return `Here is my base plan and training data. Plan my week and today's workout.${ask}\n\n${JSON.stringify(ctx, null, 1)}`;
}

/** Pull a JSON object out of a model reply (handles <think> blocks and ``` fences). */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model reply');
  return JSON.parse(t.slice(start, end + 1));
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;
};
const optNum = (v: unknown, lo: number, hi: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
/** RPE in half-point steps. */
const clampHalf = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 2) / 2)) : dflt;
};
const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Map an id or name the model produced back to a real exercise. */
export function resolveExercise(raw: unknown, pool: Exercise[]): Exercise | undefined {
  const s = str(raw, 100).toLowerCase();
  if (!s) return undefined;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  return pool.find((e) => e.id === s) ?? pool.find((e) => norm(e.name) === norm(s)) ?? pool.find((e) => norm(e.id) === norm(s));
}

/**
 * Validate the model's JSON into a Recommendation. Unknown exercises are
 * dropped; numbers are clamped to sane ranges. Throws if nothing usable is left.
 */
export function parseRecommendation(data: unknown, input: PlannerInput, base: PlannerOutput, model: string): Recommendation {
  if (!data || typeof data !== 'object') throw new Error('Model reply is not an object');
  const d = data as Record<string, unknown>;
  const pool = exercisePool(input.plan, input.customExercises);
  const fullPool = allExercises(input.customExercises);
  const today = (d.today ?? {}) as Record<string, unknown>;
  const rawEx = Array.isArray(today.exercises) ? today.exercises : [];

  const exercises: TemplateExercise[] = [];
  const seen = new Set<string>();
  for (const r of rawEx) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const ex = resolveExercise(o.exerciseId ?? o.id ?? o.name, pool) ?? resolveExercise(o.exerciseId ?? o.name, fullPool);
    if (!ex || seen.has(ex.id)) continue;
    seen.add(ex.id);
    const repMin = clamp(o.repMin, 1, 50, 8);
    const repMax = Math.max(repMin, clamp(o.repMax, 1, 60, repMin + 4));
    const w = o.weight === null || o.weight === undefined || o.weight === '' ? null : Number(o.weight);
    if (ex.metric === 'time_distance' || o.metric === 'time_distance') {
      exercises.push({
        exerciseId: ex.id,
        metric: 'time_distance',
        sets: clamp(o.sets, 1, 10, 1),
        repMin: 0,
        repMax: 0,
        minutes: optNum(o.minutes, 0, 600),
        distance: optNum(o.distance, 0, 1000),
        note: str(o.note, 200) || undefined,
      });
      continue;
    }
    exercises.push({
      exerciseId: ex.id,
      sets: clamp(o.sets, 1, 8, 3),
      repMin,
      repMax,
      // Effort only for loaded lifts the model actually rated; never for mobility drills.
      rpe: o.rpe == null || o.rpe === '' || (ex.equipment === 'bodyweight' && !ex.primary.length) ? undefined : clampHalf(o.rpe, 5, 10, 8),
      weight: w !== null && Number.isFinite(w) && w >= 0 ? w : null,
      note: str(o.note, 200) || undefined,
    });
  }
  // Fixed-weekday plans: the schedule is the user's, not the model's. Keep the
  // planner's week, and keep today's session unless the model is adjusting a
  // real (non-daily) plan day.
  const hasFixed = input.plan.days.some(isPinned);
  const aiName = str(today.name, 60);
  const matchedDay = input.plan.days.find((d) => aiName && aiName.toLowerCase().includes(d.name.toLowerCase()));
  const useBaseToday = hasFixed && (!matchedDay || isDaily(matchedDay) || !exercises.length);
  if (!useBaseToday && !exercises.length) throw new Error('Model plan had no recognisable exercises');

  const aiWeek: WeekPlanDay[] = (Array.isArray(d.weekPlan) ? d.weekPlan : [])
    .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
    .map((p) => ({ day: str(p.day, 30), focus: str(p.focus, 80), activity: str(p.activity, 80) || undefined }))
    .filter((p) => p.day && p.focus)
    .slice(0, 7);

  const rationale = (Array.isArray(d.rationale) ? d.rationale : []).map((x) => str(x)).filter(Boolean).slice(0, 6);

  return {
    createdAt: new Date().toISOString(),
    source: 'llm',
    model,
    planName: input.plan.name,
    headline: str(d.headline, 90) || base.recommendation.headline,
    summary: str(d.summary, 600) || base.recommendation.summary,
    rationale: rationale.length ? rationale : base.recommendation.rationale,
    weekPlan: hasFixed || aiWeek.length !== 7 ? base.recommendation.weekPlan : aiWeek,
    today: useBaseToday ? base.recommendation.today : { name: aiName || base.recommendation.today.name, exercises },
  };
}

/**
 * Get a recommendation. Always succeeds: if the LLM is disabled,
 * unreachable, or returns unusable output, the rule-based plan is returned
 * with a warning explaining why.
 */
export async function recommend(input: PlannerInput & { distanceUnit?: string }, settings: LlmSettings, request = '', signal?: AbortSignal): Promise<Recommendation> {
  const base = planWithRules(input);
  if (!settings.enabled || !settings.model) return base.recommendation;
  try {
    const reply = await chat(settings, buildSystemPrompt(input.plan), buildUserPrompt(input, base, request), signal);
    return parseRecommendation(extractJson(reply), input, base, settings.model);
  } catch (e) {
    if (signal?.aborted) throw e;
    const hint = e instanceof Error ? e.message : String(e);
    return { ...base.recommendation, warning: `AI coach unavailable (${hint}) — showing the built-in evidence-based plan.` };
  }
}

// ---------------------------------------------------------------------------
// Rule suggestions: the user describes what they want, the model proposes
// evidence-based rules with sources, and the user decides which to add.

export interface SuggestedRule {
  rule: string;
  source: string;
  evidence: EvidenceLevel;
  note: string;
}

export function buildRuleSystemPrompt(): string {
  return `You are an evidence-based strength & conditioning and sports-science advisor inside a workout tracking app. The user wants to add rules to their training plan. Propose 1 to 3 short, actionable training rules.

Every rule must be science/evidence-based:
- Ground each rule in scientific evidence: peer-reviewed research, systematic reviews or meta-analyses, or recognized position stands and consensus statements (e.g. ACSM, NSCA, WHO).
- "source": cite that evidence as authors + year (+ journal), or organization + statement + year. Only cite sources you are confident exist. If you are not sure of an exact paper, describe the evidence instead (e.g. "meta-analyses of RCTs on plyometric training") — never invent a citation.
- "evidence": "strong" (consistent meta-analyses/RCTs), "moderate" (several good studies, some inconsistency) or "limited" (small, indirect or mixed studies).
- If what the user asks for is not supported by evidence, do not present it as evidence-based: say so in "note", rate it "limited", and offer the closest evidence-based alternative as the rule.
- Fit the user's goals, schedule and existing rules. Do not repeat a rule they already have.
- This is general fitness guidance, not medical advice. For pain, injury or medical conditions, keep rules conservative and recommend seeing a qualified professional.

Reply with ONLY a JSON object, no markdown:
{"rules": [{"rule": string (max 240 chars), "source": string, "evidence": "strong" | "moderate" | "limited", "note": string (one sentence: why it fits this user, or caveats)}]}`;
}

export function buildRuleUserPrompt(plan: BasePlan, request: string, custom: Exercise[] = []): string {
  const ctx = {
    GOALS_AND_PROFILE: plan.profile,
    PLAN: plan.name,
    DAYS: plan.days.map((d) => d.name),
    WEEKLY_ACTIVITIES: (plan.activities ?? []).map((a) => activityLabel(a, custom)),
    EXISTING_RULES: plan.principles.filter((p) => p.enabled).map((p) => p.rule),
  };
  return `I want an evidence-based rule for: ${request.trim()}\n\nMy plan for context:\n${JSON.stringify(ctx, null, 1)}`;
}

const LEVELS: EvidenceLevel[] = ['strong', 'moderate', 'limited'];

export function parseRuleSuggestions(data: unknown): SuggestedRule[] {
  const list = (data as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) throw new Error('The model did not return any rules');
  const out = list
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .map((r) => ({
      rule: str(r.rule, 300),
      source: str(r.source, 200),
      evidence: (LEVELS.includes(r.evidence as EvidenceLevel) ? r.evidence : 'limited') as EvidenceLevel,
      note: str(r.note, 300),
    }))
    .filter((r) => r.rule)
    .slice(0, 3);
  if (!out.length) throw new Error('The model did not return any rules');
  return out;
}

/** Ask the configured model for evidence-based rule suggestions. Throws with a readable message on failure. */
export async function suggestRules(plan: BasePlan, settings: LlmSettings, request: string, custom: Exercise[] = [], signal?: AbortSignal): Promise<SuggestedRule[]> {
  if (!settings.enabled || !settings.model) throw new Error('The AI coach is turned off in Settings');
  const reply = await chat(settings, buildRuleSystemPrompt(), buildRuleUserPrompt(plan, request, custom), signal);
  return parseRuleSuggestions(extractJson(reply));
}
