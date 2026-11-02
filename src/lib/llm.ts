/**
 * Builds the coach's prompts and validates its answers. The transport (Ollama,
 * Hugging Face, Claude, …) lives in providers.ts.
 *
 * The model never sees raw guesswork: it gets the evidence principles as
 * its system prompt, plus a computed snapshot of the user's training and
 * a rule-based baseline plan, and must answer with JSON we validate.
 */
import { allExercises, findExercise, metricOf } from '../data/exercises';
import type { BasePlan, CoachNote, EvidenceLevel, Exercise, LlmSettings, PlanChange, Recommendation, SetLog, TemplateExercise, WeekPlanDay } from '../types';
import { addDays, exerciseHistory, isoDate, isWorkingSet, weekStart } from './analytics';
import { currentWeek, upcomingChanges, weekdayOfLabel } from './week';
import { principlesText } from './evidence';
import { activityLabel, availableExercises, isDaily, isPinned, planWithRules, startablePlanDay, type PlannerInput, type PlannerOutput } from './planner';
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
- weekPlan has exactly 7 entries starting with TODAY, using short day names (Sun, Mon, Tue…). Start from CURRENT_WEEK: it is this week as it stands now, i.e. the base plan plus changes you already made earlier this week (changedEarlier: true, listed in EARLIER_CHANGES_THIS_WEEK). Keep earlier changes unless there is a reason to undo them; to undo one, put the base-plan session back and list it as a change.
- EARLIER_NOTES_FROM_USER are things the user told you earlier this week or in the last few days (e.g. "no space for broad jumps", "knee sore"). Keep honoring them in today's workout and the week unless they clearly applied to a single past day only, or the user's new request says otherwise.
- TODAYS_CURRENT_WORKOUT is the workout you already gave for today. Start from it and change only what the new request requires; never bring back exercises that were removed for a reason (space, pain, illness) unless the user asks.
- Decide the scope of every change: does the user's request or the situation affect only today ("scope": "today"), or should the rest of the planned week change too ("scope": "week", e.g. moving a skipped lift, spacing hard days around it, or easing the following days after poor sleep)? Don't change later days without a reason, and check that later days still follow the rules after today's change (e.g. 48 h between heavy lower-body lifts, no sprints on tired legs).
- A sport/activity can be skipped for a day only when the user asks or there's a clear reason (e.g. pain): leave it out of that day's focus and name it in the change (e.g. "Skipped yoga"). Never move or add sports.
- You may adjust THIS WEEK ONLY, and only for a reason (missed sessions, the user's drop order, fatigue or poor sleep, a hard game, pain, limited time, or the user's request). Allowed changes:
  • skip a session (focus "Rest") or move it to another day;
  • shorten a session (fewer sets or exercises; keep the key lifts/sprints) — label it with the plan day name, e.g. "Upper (short)";
  • swap exercises for evidence-based alternatives (e.g. goblet squat instead of back squat when the knee flares);
  • replace a session with a different one (e.g. "Recovery: mobility + easy bike 20 min").
- Every change must follow the principles and the user's own rules above (e.g. no make-up volume, 48 h between heavy lower-body lifts, never sprint on tired legs, respect session length). List each one in "changes" with the day, what changed, the reason, and the principle or rule it follows. Changes without a reason are ignored by the app.
- Leave all other days exactly as in CURRENT_WEEK, and make the summary match the weekPlan you return.
- If you change a day that already has earlier changes, restate every change for that day in "changes" as it now stands — they replace the earlier notes for that day.
- "today" is the session on today's weekPlan entry, named the same way, with its full exercise list (shortened or swapped if you changed it). If today is a rest day, return the next scheduled session and say so. Never return a "daily" routine (e.g. a morning routine) as today's workout; the app shows routines separately.
- BASE_PLAN days with fixed weekdays are the default schedule. "daily" days are routines done every day. Each exercise's "thisWeek" is the prescription for the current week of the block and overrides its default sets/reps; put it in the exercise note.
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
  "changes": [{"day": string, "change": string, "reason": string, "principle": string, "scope": "today" | "week"}],  // every NEW difference from CURRENT_WEEK, with the principle/rule it follows; [] if none
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
    EARLIER_NOTES_FROM_USER: recentNotes(input.notes, input.now ?? new Date()),
    TODAYS_CURRENT_WORKOUT: todaysWorkout(input, customExercises),
    CURRENT_WEEK: currentWeek(base.recommendation.weekPlan, input.previous, input.now ?? new Date()).map((d) => ({ day: d.day, date: d.date, focus: d.focus, activity: d.activity ?? null, changedEarlier: !!d.changed })),
    EARLIER_CHANGES_THIS_WEEK: upcomingChanges(input.previous, input.now ?? new Date()).map((c) => ({ day: c.day, date: c.date, change: c.change, reason: c.reason, scope: c.scope ?? null })),
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
  const aiName = str(today.name, 60);
  const aiWeek: WeekPlanDay[] = (Array.isArray(d.weekPlan) ? d.weekPlan : [])
    .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
    .map((p) => ({ day: str(p.day, 30), focus: str(p.focus, 80), activity: str(p.activity, 80) || undefined }))
    .filter((p) => p.day && p.focus)
    .slice(0, 7);

  const changes: PlanChange[] = (Array.isArray(d.changes) ? d.changes : [])
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
    .map((c): PlanChange => ({
      day: str(c.day, 30),
      change: str(c.change, 160),
      reason: str(c.reason, 300),
      principle: str(c.principle, 120) || undefined,
      scope: c.scope === 'week' ? 'week' : c.scope === 'today' ? 'today' : undefined,
    }))
    .filter((c) => c.day && c.change && c.reason)
    .slice(0, 10);
  {
    // Date each new change, and carry forward earlier changes for days the model didn't change again.
    const now0 = input.now ?? new Date();
    for (const c of changes) {
      const wd = weekdayOfLabel(c.day, now0);
      for (let i = 0; i < 7 && wd >= 0 && !c.date; i++) if (addDays(now0, i).getDay() === wd) c.date = isoDate(addDays(now0, i));
    }
    const newDates = new Set(changes.map((c) => c.date));
    changes.unshift(...upcomingChanges(input.previous, now0).filter((c) => !newDates.has(c.date)));
  }

  let weekPlan: WeekPlanDay[];
  let todayOut: Recommendation['today'];
  if (input.plan.days.some(isPinned)) {
    // Fixed-weekday plan: the base plan is the default; the model may adjust
    // this week (skip, move, shorten, swap, replace). New sessions need a
    // stated reason. Sports stay put.
    const now0 = input.now ?? new Date();
    const startWeek = currentWeek(base.recommendation.weekPlan, input.previous, now0);
    const merged = mergeWeek(input, startWeek, aiWeek, changes);
    weekPlan = merged.map((m) => m.day);
    const now = input.now ?? new Date();
    const off = merged.findIndex((m) => m.kind !== 'rest');
    const entry = off === -1 ? undefined : merged[off];
    const planDay = entry?.planDay;
    const label = entry?.day.focus ?? '';
    const lc = (x: string) => x.toLowerCase();
    const dailyNames = input.plan.days.filter(isDaily).map((x) => lc(x.name));
    const aiIsRoutine = !!aiName && dailyNames.some((n) => lc(aiName).includes(n));
    const aiMatches =
      exercises.length > 0 &&
      !!aiName &&
      (lc(label).includes(lc(aiName)) || lc(aiName).includes(lc(label)) || (!!planDay && lc(aiName).includes(lc(planDay.name))));
    // The previous refresh's workout, if it was made today for this same day.
    const prev = input.previous;
    const prevToday =
      prev && isoDate(new Date(prev.createdAt)) === isoDate(now) && entry && (lc(prev.today.name) === lc(label) || lc(label).includes(lc(prev.today.name)))
        ? prev.today
        : undefined;
    if (entry && aiMatches) todayOut = { name: aiName, exercises };
    else if (off === 0 && entry && exercises.length && !aiIsRoutine && (entry.kind === 'new' || entry.day.changed)) {
      // Today holds a session the coach changed: its workout is the one the model sent, named like the strip.
      todayOut = { name: label, exercises };
    } else if (off === 0 && entry && entry.kind === 'new' && prevToday) {
      todayOut = { ...prevToday, name: label };
    } else if (planDay) {
      const built = startablePlanDay(planDay, input.plan, input.unit, input.sessions, input.customExercises, addDays(now, off));
      todayOut = { name: built.name, exercises: built.exercises };
    } else if (entry && prevToday) {
      todayOut = { ...prevToday, name: label };
    } else todayOut = base.recommendation.today;
  } else {
    if (!exercises.length) throw new Error('Model plan had no recognisable exercises');
    weekPlan = aiWeek.length === 7 ? aiWeek : base.recommendation.weekPlan;
    todayOut = { name: aiName || base.recommendation.today.name, exercises };
  }

  const rationale = (Array.isArray(d.rationale) ? d.rationale : []).map((x) => str(x)).filter(Boolean).slice(0, 6);

  return {
    createdAt: new Date().toISOString(),
    source: 'llm',
    model,
    planName: input.plan.name,
    headline: str(d.headline, 90) || base.recommendation.headline,
    summary: str(d.summary, 600) || base.recommendation.summary,
    rationale: rationale.length ? rationale : base.recommendation.rationale,
    weekPlan,
    changes: changes.length ? changes : undefined,
    today: todayOut,
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



/** Real (non-daily) plan sessions named in a schedule entry, longest names first. */
function sessionsIn(plan: BasePlan, focus: string): string[] {
  let rest = focus.toLowerCase();
  const found: string[] = [];
  for (const d of plan.days.filter((x) => !isDaily(x)).sort((a, b) => b.name.length - a.name.length)) {
    const n = d.name.toLowerCase();
    if (rest.includes(n)) {
      found.push(d.name);
      rest = rest.replace(n, ' ');
    }
  }
  return found;
}

type Merged = { day: WeekPlanDay; kind: 'plan' | 'new' | 'rest'; planDay?: BasePlan['days'][number] };

/** Remove sport names, "+" joins and minute counts, e.g. "Lower A + Basketball 60 min" → "Lower A". */
function stripSports(focus: string, sportNames: string[]): string {
  let f = focus;
  for (const n of sportNames) f = f.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( \\d+ ?min)?', 'ig'), '');
  return f.replace(/\s*\+\s*(\+\s*)*/g, ' + ').replace(/^\s*\+\s*|\s*\+\s*$/g, '').trim();
}

const REST_RE = /^(rest|off|rest day|day off|recovery day|rest \/ easy cardio|easy cardio|rest \(.*\))$/i;

/**
 * This week's schedule for a fixed-weekday plan, starting from the planner's
 * week. Per day, the model may: rest/skip, put a real plan session there
 * (moved, or a labelled variant like "Upper (short)"), or — only with a
 * reason in `changes` — put a new session there. Anything else keeps the
 * planned day. Sports always stay on their days.
 */
function mergeWeek(input: PlannerInput, startWeek: WeekPlanDay[], aiWeek: WeekPlanDay[], changes: PlanChange[]): Merged[] {
  const now = input.now ?? new Date();
  const plan = input.plan;
  const sessionDays = plan.days.filter((x) => !isDaily(x));
  const kindOf = (focus: string): Merged['kind'] => (sessionsIn(plan, focus).length ? 'plan' : REST_RE.test(focus) || !focus ? 'rest' : 'new');
  const SKIP_RE = /\b(skip|skipped|remove|removed|drop|dropped|cancel|cancelled|no|without|miss|missing|off)\b/i;
  return startWeek.map((planned, off) => {
    const wd = (now.getDay() + off) % 7;
    const dayChanges = changes.filter((c) => weekdayOfLabel(c.day, now) === wd);
    // Sports scheduled that day and still in the current week (an earlier change may have skipped one).
    const acts = (plan.activities ?? []).filter((a) => a.weekdays.includes(wd));
    const nameOf = (a: (typeof acts)[number]) => findExercise(a.exerciseId, input.customExercises)?.name ?? a.exerciseId;
    const present = acts.filter((a) => (planned.activity ?? '').toLowerCase().includes(nameOf(a).toLowerCase()));
    // A sport can be skipped (never moved or added) when a change for that day names it.
    // Only the change itself counts ("Skipped yoga"), not the reason ("…fresh for basketball").
    const skipped = present.filter((a) => dayChanges.some((c) => c.change.toLowerCase().includes(nameOf(a).toLowerCase()) && SKIP_RE.test(c.change)));
    const remaining = present.filter((a) => !skipped.includes(a));
    const actLabel = remaining.map((a) => activityLabel(a, input.customExercises)).join(' + ') || undefined;
    const sportNames = acts.map(nameOf);
    const plannedFocus = stripSports(planned.focus, sportNames);
    const plannedNames = sessionsIn(plan, plannedFocus);
    const sportChanged = skipped.length > 0;
    const keepDay: WeekPlanDay = sportChanged
      ? { ...planned, focus: plannedFocus || actLabel || 'Rest / easy cardio', activity: actLabel, changed: true }
      : planned;
    const keep: Merged = {
      day: keepDay,
      kind: plannedNames.length ? 'plan' : plannedFocus && kindOf(plannedFocus) === 'new' ? 'new' : 'rest',
      planDay: sessionDays.find((x) => x.name === plannedNames[0]),
    };
    const ai = aiWeek.find((x) => weekdayOfLabel(x.day, now) === wd);
    if (!ai) return keep;
    const focus = stripSports(ai.focus, sportNames).slice(0, 60);
    if (focus.toLowerCase() === plannedFocus.toLowerCase() || (!focus && !plannedNames.length)) return keep;
    const kind = kindOf(focus);
    if (kind === 'rest' && !plannedNames.length && keep.kind === 'rest') return keep; // already a rest day
    const names = sessionsIn(plan, focus);
    if (kind === 'new' && !dayChanges.length) return keep;
    const shown = kind === 'rest' ? actLabel ?? 'Rest / easy cardio' : focus;
    return {
      day: { day: planned.day, date: planned.date, focus: shown, activity: actLabel, changed: true },
      kind,
      planDay: sessionDays.find((x) => x.name === names[0]),
    };
  });
}

/** The user's notes from this week or the last 3 days (whichever reaches further back), with when they were sent. */
export function recentNotes(notes: CoachNote[] | undefined, now: Date): { when: string; note: string }[] {
  if (!notes?.length) return [];
  const since = Math.min(weekStart(now).getTime(), now.getTime() - 3 * 86_400_000);
  return notes
    .filter((n) => {
      const t = new Date(n.at).getTime();
      return t >= since && t <= now.getTime();
    })
    .slice(-12)
    .map((n) => {
      const d = new Date(n.at);
      const sameDay = isoDate(d) === isoDate(now);
      return {
        when: `${sameDay ? 'today' : d.toLocaleDateString('en', { weekday: 'long' })} ${d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
        note: n.text,
      };
    });
}

/** The workout the coach gave earlier today, if any, in a compact form. */
function todaysWorkout(input: PlannerInput, custom: Exercise[]) {
  const prev = input.previous;
  const now = input.now ?? new Date();
  if (!prev || isoDate(new Date(prev.createdAt)) !== isoDate(now)) return null;
  return {
    name: prev.today.name,
    exercises: prev.today.exercises.map((e) => ({
      id: e.exerciseId,
      name: findExercise(e.exerciseId, custom)?.name ?? e.exerciseId,
      ...(e.minutes || e.distance ? { minutes: e.minutes ?? null, distance: e.distance ?? null } : { sets: e.sets, reps: `${e.repMin}-${e.repMax}`, rpe: e.rpe ?? null }),
      note: e.note ?? undefined,
    })),
  };
}
