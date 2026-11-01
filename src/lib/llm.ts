/**
 * Talks to any OpenAI-compatible chat endpoint serving an open-weight model
 * (Ollama, LM Studio, llama.cpp server, vLLM, or a hosted provider).
 *
 * The model never sees raw guesswork: it gets the evidence principles as
 * its system prompt, plus a computed snapshot of the user's training and
 * a rule-based baseline plan, and must answer with JSON we validate.
 */
import { allExercises, findExercise, metricOf } from '../data/exercises';
import type { BasePlan, Exercise, LlmSettings, Recommendation, SetLog, TemplateExercise, WeekPlanDay } from '../types';
import { exerciseHistory, isWorkingSet } from './analytics';
import { principlesText } from './evidence';
import { availableExercises, planWithRules, type PlannerInput, type PlannerOutput } from './planner';

export const DEFAULT_LLM: LlmSettings = {
  enabled: true,
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  apiKey: '',
  jsonMode: true,
};

export const SUGGESTED_MODELS = [
  { id: 'qwen3:8b', note: 'Good default; runs on most laptops (~5 GB)' },
  { id: 'qwen3:14b', note: 'Better reasoning; needs ~10 GB' },
  { id: 'gpt-oss:20b', note: "OpenAI's open-weight model; ~14 GB" },
  { id: 'gemma3:12b', note: "Google's open-weight model; ~8 GB" },
  { id: 'llama3.1:8b', note: 'Fast and widely supported' },
];

export function buildSystemPrompt(plan: BasePlan): string {
  return `You are an evidence-based strength and conditioning coach inside a workout tracking app.

The user's training principles for this block. The research-backed ones come with sources; rules marked [user's own rule] are the user's personal preferences and must be respected unless they would clearly be unsafe:
${principlesText(plan.principles)}

Rules:
- The user's BASE_PLAN ("${plan.name}") is their chosen program for this training block. Build the week from its days in order, and base today's workout on one BASE_PLAN day.
- Keep the BASE_PLAN's exercises, sets and rep ranges unless the user's status (time off), their request, or one of their rules requires a change. Explain every change in the rationale.
- Start from BASELINE (the base plan day with this week's progressed loads already worked out). Use its weights unless you have a data-backed reason; use null when unknown.
- Base every recommendation on the user's actual data provided. Never invent history.
- Only use exercise ids from AVAILABLE_EXERCISES.
- Exercises with metric "time_distance" (cardio, carries) use "minutes" and "distance" (in the user's distance unit) instead of reps and weight. Count cardio minutes toward the weekly cardio target.
- Never prescribe "making up" missed sessions by cramming extra volume. After time off, reduce load and volume as the principles say.
- Be direct and encouraging. The headline speaks to the user (e.g. "You missed last week — here's this week").
- You are not a medical provider: if the user mentions pain or injury, keep it conservative and suggest seeing a professional.

Reply with ONLY a JSON object, no markdown, matching:
{
  "headline": string,                 // <= 70 chars
  "summary": string,                  // 1-3 sentences on this week and why
  "rationale": string[],              // 2-5 bullets, each tied to a principle or the user's data
  "weekPlan": [{"day": string, "focus": string}],  // the next 7 days starting today
  "today": {
    "name": string,
    "exercises": [{"exerciseId": string, "sets": number, "repMin": number, "repMax": number, "rir": number, "weight": number|null, "minutes": number|null, "distance": number|null, "note": string}]
  }
}`;
}

/** Exercises the model may use: anything matching the equipment, plus anything already in the plan. */
export function exercisePool(plan: BasePlan, custom: Exercise[]): Exercise[] {
  const planIds = new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)));
  const avail = new Set(availableExercises(plan.profile, custom).map((e) => e.id));
  return allExercises(custom).filter((e) => planIds.has(e.id) || avail.has(e.id));
}

function fmtSet(x: SetLog, metric: string): string {
  if (metric === 'time_distance') return `${Math.round((x.durationSec ?? 0) / 6) / 10}min${x.distance ? ` ${x.distance}dist` : ''}`;
  return `${x.weight ?? 0}x${x.reps}${x.rir != null ? `@RIR${x.rir}` : ''}`;
}

export function buildUserPrompt(input: PlannerInput & { distanceUnit?: string }, base: PlannerOutput, request = ''): string {
  const { plan, unit, sessions, customExercises } = input;
  const hist = exerciseHistory(sessions);
  const name = (id: string) => findExercise(id, customExercises)?.name ?? id;
  const planEx = (e: TemplateExercise) => {
    const m = metricOf(e, customExercises);
    return m === 'time_distance'
      ? { id: e.exerciseId, name: name(e.exerciseId), metric: m, minutes: e.minutes ?? null, distance: e.distance ?? null }
      : { id: e.exerciseId, name: name(e.exerciseId), sets: e.sets, reps: `${e.repMin}-${e.repMax}`, rir: e.rir ?? plan.rir };
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
      defaultRir: plan.rir,
      weeklyCardioMinutesTarget: plan.cardioMinutes,
      days: plan.days.map((d) => ({ name: d.name, exercises: d.exercises.map(planEx) })),
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
      rir: clamp(o.rir, 0, 5, 2),
      weight: w !== null && Number.isFinite(w) && w >= 0 ? w : null,
      note: str(o.note, 200) || undefined,
    });
  }
  if (!exercises.length) throw new Error('Model plan had no recognisable exercises');

  const weekPlan: WeekPlanDay[] = (Array.isArray(d.weekPlan) ? d.weekPlan : [])
    .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
    .map((p) => ({ day: str(p.day, 30), focus: str(p.focus, 80) }))
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
    weekPlan: weekPlan.length ? weekPlan : base.recommendation.weekPlan,
    today: { name: str(today.name, 60) || base.recommendation.today.name, exercises },
  };
}

export async function chat(settings: LlmSettings, messages: { role: string; content: string }[], signal?: AbortSignal, json = settings.jsonMode): Promise<string> {
  const url = settings.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const body: Record<string, unknown> = { model: settings.model, messages, temperature: 0.3, stream: false };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM server returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM returned an empty reply');
  return content;
}

export async function listModels(settings: LlmSettings): Promise<string[]> {
  const url = settings.baseUrl.replace(/\/+$/, '') + '/models';
  const headers: Record<string, string> = {};
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data.map((m: { id: string }) => m.id) : [];
}

/**
 * Get a recommendation. Always succeeds: if the LLM is disabled,
 * unreachable, or returns unusable output, the rule-based plan is returned
 * with a warning explaining why.
 */
export async function recommend(input: PlannerInput & { distanceUnit?: string }, settings: LlmSettings, request = '', signal?: AbortSignal): Promise<Recommendation> {
  const base = planWithRules(input);
  if (!settings.enabled || !settings.model) return base.recommendation;
  const messages = [
    { role: 'system', content: buildSystemPrompt(input.plan) },
    { role: 'user', content: buildUserPrompt(input, base, request) },
  ];
  try {
    let reply: string;
    try {
      reply = await chat(settings, messages, signal);
    } catch (e) {
      // Some servers reject response_format; retry once without it.
      if (settings.jsonMode && e instanceof Error && /\b(400|422)\b/.test(e.message)) reply = await chat(settings, messages, signal, false);
      else throw e;
    }
    return parseRecommendation(extractJson(reply), input, base, settings.model);
  } catch (e) {
    if (signal?.aborted) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /Failed to fetch|NetworkError|Load failed/i.test(msg)
      ? `Couldn't reach ${settings.baseUrl}. Is the model server running?`
      : msg;
    return { ...base.recommendation, warning: `AI coach unavailable (${hint}) — showing the built-in evidence-based plan.` };
  }
}
