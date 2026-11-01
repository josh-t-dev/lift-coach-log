import { describe, expect, it, vi } from 'vitest';
import { findExercise } from '../data/exercises';
import { hydrate, importPlan } from '../store';
import { projectedCardioMinutes, weekPlanFrom } from './planner';
import type { BasePlan, LlmSettings, Profile, Session } from '../types';
import { cardioMinutes, e1rm, exerciseHistory, exerciseSeries, isWorkingSet, setsPerMuscle, snapshot, suggestLoad, weekStart, weeklySeries } from './analytics';
import { buildSystemPrompt, buildUserPrompt, extractJson, parseRecommendation, recommend } from './llm';
import { generateBasePlan, planWithRules, projectedWeeklySets } from './planner';

const profile: Profile = {
  goal: 'hypertrophy',
  experience: 'intermediate',
  daysPerWeek: 3,
  sessionMinutes: 60,
  equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'],
  notes: '',
};

// Wednesday 2026-10-28, noon
const NOW = new Date(2026, 9, 28, 12);
const planFor = (p: Profile = profile): BasePlan => generateBasePlan(p, { now: NOW });
const plan = planFor();
const input = { plan, unit: 'kg' as const, sessions: [] as Session[], customExercises: [], now: NOW };

let n = 0;
function session(daysAgo: number, name: string, lifts: [string, number, number, number][]): Session {
  const start = new Date(NOW);
  start.setDate(start.getDate() - daysAgo);
  start.setHours(18);
  return {
    id: `s${n++}`,
    name,
    source: 'blank',
    startedAt: start.toISOString(),
    finishedAt: new Date(start.getTime() + 3600_000).toISOString(),
    exercises: lifts.map(([exerciseId, sets, weight, reps], i) => ({
      id: `e${n}-${i}`,
      exerciseId,
      sets: Array.from({ length: sets }, (_, j) => ({ id: `x${j}`, weight, reps, rpe: 8, done: true })),
    })),
  };
}

describe('analytics', () => {
  it('weeks start on Monday', () => {
    expect(weekStart(NOW).getDay()).toBe(1);
    expect(weekStart(NOW).getDate()).toBe(26);
  });

  it('counts primary sets fully and secondary sets as half', () => {
    const s = session(0, 'A', [['bench-press', 3, 80, 8]]);
    const v = setsPerMuscle([s]);
    expect(v.chest).toBe(3);
    expect(v.triceps).toBe(1.5);
    expect(v.quads).toBe(0);
  });

  it('ignores sets that were not ticked off', () => {
    const s = session(0, 'A', [['bench-press', 3, 80, 8]]);
    s.exercises[0].sets[0].done = false;
    expect(setsPerMuscle([s]).chest).toBe(2);
  });

  it('epley e1rm', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 10)).toBeCloseTo(133.3, 1);
  });

  it('detects a new user', () => {
    expect(snapshot([], plan, [], NOW).status).toBe('new');
  });

  it('detects a missed week', () => {
    // Trained 2 and 3 weeks ago, nothing last week, nothing yet this week.
    const sessions = [session(9 + 7, 'A', [['back-squat', 3, 100, 8]]), session(10, 'B', [['back-squat', 3, 100, 8]])];
    const snap = snapshot(sessions, plan, [], NOW);
    expect(snap.lastWeek.sessions).toBe(0);
    expect(snap.status).toBe('missed-last-week');
    expect(snap.statusText).toBe('You missed last week.');
    expect(snap.adjustment.loadCut).toBe(0);
  });

  it('detects returning and detrained with load cuts', () => {
    const r = snapshot([session(16, 'A', [['back-squat', 3, 100, 8]])], plan, [], NOW);
    expect(r.status).toBe('returning');
    expect(r.adjustment.loadCut).toBeGreaterThan(0);
    const d = snapshot([session(40, 'A', [['back-squat', 3, 100, 8]])], plan, [], NOW);
    expect(d.status).toBe('detrained');
    expect(d.adjustment.loadCut).toBeGreaterThan(r.adjustment.loadCut);
  });

  it('is on track after a full week', () => {
    const sessions = [3, 5, 7].map((d) => session(d + 2, 'A', [['bench-press', 3, 80, 8]]));
    expect(snapshot(sessions, plan, [], NOW).status).toBe('on-track');
  });
});

describe('double progression', () => {
  const squat = findExercise('back-squat');
  const curl = findExercise('db-curl');

  it('adds load when every set hits the top of the range', () => {
    const h = exerciseHistory([session(2, 'A', [['back-squat', 3, 100, 10]])]).get('back-squat');
    expect(suggestLoad(h, squat, 6, 10, 'kg').weight).toBe(105);
  });

  it('holds load while chasing reps', () => {
    const h = exerciseHistory([session(2, 'A', [['back-squat', 3, 100, 8]])]).get('back-squat');
    expect(suggestLoad(h, squat, 6, 10, 'kg').weight).toBe(100);
  });

  it('backs off when below the range', () => {
    const h = exerciseHistory([session(2, 'A', [['db-curl', 3, 20, 6]])]).get('db-curl');
    expect(suggestLoad(h, curl, 10, 15, 'kg').weight).toBe(17.5);
  });

  it('cuts load after a break and rounds to plates', () => {
    const h = exerciseHistory([session(2, 'A', [['back-squat', 3, 225, 8]])]).get('back-squat');
    const s = suggestLoad(h, squat, 6, 10, 'lb', 0.15);
    expect(s.weight! % 5).toBe(0);
    expect(s.weight).toBeLessThan(225);
  });
});

describe('rule planner', () => {
  it('builds a full plan for a new user', () => {
    const out = planWithRules({ plan, unit: 'kg', sessions: [], customExercises: [], now: NOW });
    expect(out.recommendation.source).toBe('rules');
    expect(out.recommendation.today.exercises.length).toBeGreaterThan(3);
    expect(out.recommendation.weekPlan).toHaveLength(7);
    expect(out.recommendation.weekPlan.filter((d) => !/Rest/.test(d.focus))).toHaveLength(3);
    for (const m of ['chest', 'back', 'quads'] as const) expect(out.projected[m]).toBeGreaterThanOrEqual(6);
  });

  it('respects equipment', () => {
    const p = planFor({ ...profile, equipment: ['dumbbell', 'bodyweight'] });
    for (const d of p.days)
      for (const e of d.exercises) expect(['dumbbell', 'bodyweight']).toContain(findExercise(e.exerciseId)!.equipment);
  });

  it('tells you that you missed last week and uses your last loads', () => {
    const sessions = [session(16, 'Full Body A', [['back-squat', 3, 100, 8]]), session(10, 'Full Body B', [['rdl', 3, 90, 8]])];
    const out = planWithRules({ plan, unit: 'kg', sessions, customExercises: [], now: NOW });
    expect(out.recommendation.headline).toMatch(/missed last week/i);
    const squat = out.recommendation.today.exercises.find((e) => e.exerciseId === 'back-squat');
    expect(squat?.weight).toBe(100);
  });

  it('reduces volume after a long break', () => {
    const sessions = [session(45, 'Full Body A', [['back-squat', 3, 100, 8]])];
    const out = planWithRules({ plan, unit: 'kg', sessions, customExercises: [], now: NOW });
    expect(out.recommendation.headline).toMatch(/welcome back/i);
    const squat = out.recommendation.today.exercises.find((e) => e.exerciseId === 'back-squat');
    expect(squat!.weight!).toBeLessThan(100);
  });

  it('rotates to the next day not yet done this week', () => {
    const sessions = [session(1, 'Full Body A', [['back-squat', 3, 100, 8]])];
    const out = planWithRules({ plan, unit: 'kg', sessions, customExercises: [], now: NOW });
    expect(out.recommendation.today.name).toBe('Full Body B');
  });

  it('keeps sessions within the time budget', () => {
    const p = planFor({ ...profile, sessionMinutes: 30 });
    const sets = p.days[0].exercises.filter((e) => e.metric !== 'time_distance').reduce((a, e) => a + e.sets, 0);
    expect(sets).toBeLessThanOrEqual(8);
  });
});

describe('LLM output handling', () => {
  const base = planWithRules(input);

  it('extracts JSON from think blocks and fences', () => {
    expect(extractJson('<think>hmm {not json}</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a": {"b": 2}} hope that helps')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('validates, maps names to ids, clamps numbers and drops unknown exercises', () => {
    const rec = parseRecommendation(
      {
        headline: 'You missed last week',
        summary: 'Ease back in.',
        rationale: ['a', 'b'],
        weekPlan: [{ day: 'Mon', focus: 'Upper' }],
        today: {
          name: 'Upper',
          exercises: [
            { exerciseId: 'Barbell Bench Press', sets: 40, repMin: 8, repMax: 6, rpe: 8.3, weight: '80' },
            { exerciseId: 'made-up-lift', sets: 3, repMin: 8, repMax: 12 },
            { exerciseId: 'lat-pulldown', sets: 3, repMin: 10, repMax: 12, weight: null },
          ],
        },
      },
      input,
      base,
      'qwen3:8b',
    );
    expect(rec.source).toBe('llm');
    expect(rec.today.exercises.map((e) => e.exerciseId)).toEqual(['bench-press', 'lat-pulldown']);
    expect(rec.today.exercises[0]).toMatchObject({ sets: 8, repMin: 8, repMax: 8, weight: 80, rpe: 8.5 });
  });

  it('throws when no exercises are usable', () => {
    expect(() => parseRecommendation({ today: { exercises: [{ exerciseId: 'nope' }] } }, input, base, 'm')).toThrow();
  });

  it('falls back to rules with a warning when the server is down', async () => {
    const settings: LlmSettings = { enabled: true, api: 'openai', preset: 'custom', baseUrl: 'http://localhost:1/v1', model: 'x', apiKey: '', jsonMode: true };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const rec = await recommend(input, settings);
    expect(rec.source).toBe('rules');
    expect(rec.warning).toMatch(/Couldn't reach http:\/\/localhost:1\/v1/);
    vi.unstubAllGlobals();
  });

  it('uses the model reply when valid, and retries without json mode on 400', async () => {
    const reply = { headline: 'H', summary: 'S', rationale: ['r'], weekPlan: [], today: { name: 'T', exercises: [{ exerciseId: 'back-squat', sets: 3, repMin: 6, repMax: 10, rir: 2, weight: null }] } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('response_format not supported', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const rec = await recommend(input, { enabled: true, api: 'openai', preset: 'custom', baseUrl: 'http://x/v1/', model: 'm', apiKey: 'k', jsonMode: true });
    expect(rec.source).toBe('llm');
    expect(rec.headline).toBe('H');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('base plan', () => {
  it('generates a dated block with evidence targets, principles and cardio', () => {
    expect(plan.startDate).toBe('2026-10-28');
    expect(plan.reviewDate).toBe('2027-01-28');
    expect(plan.days).toHaveLength(3);
    expect(plan.setTargets.chest).toBe(10);
    expect(plan.principles.every((p) => p.enabled)).toBe(true);
    // Lifting goals keep cardio for rest days; general fitness puts it in sessions.
    expect(plan.days.flatMap((d) => d.exercises).some((e) => e.metric === 'time_distance')).toBe(false);
    const general = planFor({ ...profile, goal: 'general' });
    expect(general.days[0].exercises.at(-1)).toMatchObject({ exerciseId: 'bike', metric: 'time_distance', minutes: 20 });
  });

  it('sizes the default plan to reach ~90%+ of weekly set targets for major muscles', () => {
    const proj = projectedWeeklySets(plan.days);
    for (const m of ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes'] as const)
      expect(proj[m]).toBeGreaterThanOrEqual(plan.setTargets[m] * 0.9);
    for (const d of plan.days) expect(d.exercises.reduce((a, e) => a + e.sets, 0)).toBeLessThanOrEqual(17);
  });

  it("builds today's workout from the user's edited plan days", () => {
    const mine: BasePlan = { ...plan, days: [{ id: 'd1', name: 'My Push', exercises: [{ exerciseId: 'dip', sets: 5, repMin: 5, repMax: 8 }] }, { id: 'd2', name: 'My Pull', exercises: [{ exerciseId: 'chin-up', sets: 4, repMin: 6, repMax: 10 }] }] };
    const sessions = [session(1, 'My Push', [['dip', 5, 20, 8]])];
    const out = planWithRules({ plan: mine, unit: 'kg', sessions, customExercises: [], now: NOW });
    expect(out.recommendation.today.name).toBe('My Pull');
    expect(out.recommendation.today.exercises).toMatchObject([{ exerciseId: 'chin-up', sets: 4, repMin: 6, repMax: 10 }]);
    expect(out.recommendation.planName).toBe(plan.name);
  });

  it('sends enabled research rules and the user\'s own rules to the model, not disabled ones', () => {
    const mine: BasePlan = {
      ...plan,
      principles: [
        ...plan.principles.map((p) => (p.id === 'rest' ? { ...p, enabled: false } : p)),
        { id: 'custom-1', rule: 'No barbell back squats', source: '', enabled: true, custom: true },
      ],
    };
    const sys = buildSystemPrompt(mine);
    expect(sys).toContain("[user's own rule] No barbell back squats");
    expect(sys).toContain('[volume]');
    expect(sys).not.toContain('[rest]');
    const user = buildUserPrompt({ ...input, plan: mine }, planWithRules({ ...input, plan: mine }));
    expect(user).toContain('"BASE_PLAN"');
    expect(user).toContain('Full Body A');
  });
});

describe('time & distance', () => {
  const run = (daysAgo: number, min: number, km: number): Session => ({
    id: `run${daysAgo}`, name: 'Run', source: 'blank',
    startedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    finishedAt: new Date(NOW.getTime() - daysAgo * 86_400_000 + 3_600_000).toISOString(),
    exercises: [{ id: 'e', exerciseId: 'run', sets: [{ id: 's', weight: null, reps: null, rpe: null, durationSec: min * 60, distance: km, done: true }] }],
  });

  it('counts a timed set as done work and sums cardio minutes', () => {
    expect(isWorkingSet({ id: 'x', weight: null, reps: null, rpe: null, durationSec: 600, done: true })).toBe(true);
    expect(cardioMinutes([run(0, 30, 5), run(1, 25, 4)])).toBe(55);
    expect(setsPerMuscle([run(0, 30, 5)]).quads).toBe(0);
    expect(snapshot([run(0, 30, 5)], plan, [], NOW).thisWeek.cardioMinutes).toBe(30);
  });

  it('builds chart series', () => {
    const s = [run(14, 20, 3), run(1, 30, 5)];
    expect(exerciseSeries(s, 'run', 'distance').map((p) => p.value)).toEqual([3, 5]);
    expect(exerciseSeries(s, 'run', 'minutes').map((p) => p.value)).toEqual([20, 30]);
    const wk = weeklySeries(s, 4, (x) => cardioMinutes(x), NOW);
    expect(wk.map((p) => p.value)).toEqual([0, 20, 0, 30]);
  });

  it('parses minutes and distance from the model', () => {
    const base = planWithRules(input);
    const rec = parseRecommendation({ today: { exercises: [{ exerciseId: 'run', minutes: 25, distance: '4.5', sets: 1 }] } }, input, base, 'm');
    expect(rec.today.exercises[0]).toMatchObject({ exerciseId: 'run', metric: 'time_distance', minutes: 25, distance: 4.5 });
  });
});

describe('storage migration', () => {
  it('turns a v1 profile into the first base plan and keeps workouts', () => {
    const v1 = { version: 1, unit: 'lb', profile: { ...profile, daysPerWeek: 4, goal: 'strength' }, sessions: [session(2, 'A', [['bench-press', 3, 185, 5]])], templates: [] };
    const st = hydrate(v1);
    expect(st.version).toBe(2);
    expect(st.plan.profile.daysPerWeek).toBe(4);
    expect(st.plan.days.map((d) => d.name)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    expect(st.plan.repRanges.compound).toEqual([3, 6]);
    expect(st.distanceUnit).toBe('mi');
    expect(st.sessions).toHaveLength(1);
  });
});

describe('RPE', () => {
  it('converts stored RIR to RPE (RPE = 10 − RIR) everywhere', () => {
    const old = {
      version: 2,
      plan: { ...plan, rpe: undefined, rir: 2, days: [{ id: 'd', name: 'A', exercises: [{ exerciseId: 'bench-press', sets: 3, repMin: 6, repMax: 10, rir: 1 }] }] },
      sessions: [{ ...session(1, 'A', [['bench-press', 3, 80, 8]]), exercises: [{ id: 'e', exerciseId: 'bench-press', target: { repMin: 6, repMax: 10, rir: 3 }, sets: [{ id: 's', weight: 80, reps: 8, rir: 2, done: true }, { id: 't', weight: 80, reps: 8, rir: null, done: true }] }] }],
    };
    const st = hydrate(structuredClone(old));
    expect(st.plan.rpe).toBe(8);
    expect(st.plan.days[0].exercises[0].rpe).toBe(9);
    const ex = st.sessions[0].exercises[0];
    expect(ex.target?.rpe).toBe(7);
    expect(ex.sets.map((x) => x.rpe)).toEqual([8, null]);
    expect(JSON.stringify(st)).not.toContain('"rir"');
    expect(st.defaultRestSec).toBe(90);
  });

  it('eases target RPE by one when returning from a break', () => {
    const out = planWithRules({ ...input, sessions: [session(40, 'Full Body A', [['back-squat', 3, 100, 8]])] });
    expect(out.recommendation.today.exercises.find((e) => e.exerciseId === 'back-squat')?.rpe).toBe(7);
  });
});

describe('weekly activities', () => {
  // NOW is Wednesday. Volleyball Wed + Fri.
  const vb = { id: 'a', exerciseId: 'volleyball', weekdays: [3, 5], minutes: 60, intensity: 'hard' as const };
  const days = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

  it('moves lifting off activity days and shows the activity', () => {
    const wk = weekPlanFrom(days, 0, NOW, [vb]);
    expect(wk[0]).toMatchObject({ focus: 'Volleyball 60 min', activity: 'Volleyball 60 min' });
    expect(wk[2].activity).toBe('Volleyball 60 min');
    const liftingDays = wk.filter((d) => ['A', 'B', 'C'].includes(d.focus));
    expect(liftingDays).toHaveLength(3);
    expect(liftingDays.every((d) => !d.activity)).toBe(true);
  });

  it('counts activity minutes toward planned cardio and mentions them in the plan', () => {
    expect(projectedCardioMinutes([], [], [vb])).toBe(120);
    const out = planWithRules({ ...input, plan: { ...plan, activities: [vb] } });
    expect(out.recommendation.summary).toMatch(/Today: Volleyball 60 min\. Next session: Full Body A \(Sat\)/);
    expect(out.recommendation.rationale.join(' ')).toMatch(/around Volleyball \(Wed\/Fri\)/);
  });
});

describe('Claude provider', () => {
  it('calls the Messages API from the browser with the refusal fallback and parses the plan', async () => {
    const reply = { headline: 'H', summary: 'S', rationale: ['r'], weekPlan: [], today: { name: 'T', exercises: [{ exerciseId: 'back-squat', sets: 3, repMin: 6, repMax: 10, rpe: 8, weight: null }] } };
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(reply) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const rec = await recommend(input, { enabled: true, api: 'anthropic', preset: 'claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', apiKey: 'sk-test', jsonMode: false });
    vi.unstubAllGlobals();
    expect(rec.warning).toBeUndefined();
    expect(rec.source).toBe('llm');
    expect(rec.model).toBe('claude-opus-5-5');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium' } });
    expect(body.system).toContain("BASE_PLAN");
    expect(body.temperature).toBeUndefined();
  });

  it('explains a bad key and falls back to rules', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const rec = await recommend(input, { enabled: true, api: 'anthropic', preset: 'claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', apiKey: 'bad', jsonMode: false });
    vi.unstubAllGlobals();
    expect(rec.source).toBe('rules');
    expect(rec.warning).toMatch(/rejected the API key/);
  });
});

describe('scheduling around hard games', () => {
  it('avoids lifting the day before a hard activity when there is room', () => {
    // NOW is Wednesday. Hard game Saturday only: Friday should stay free of lifting.
    const game = { id: 'g', exerciseId: 'basketball', weekdays: [6], minutes: 90, intensity: 'hard' as const };
    const wk = weekPlanFrom([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 0, NOW, [game]);
    const fri = wk.find((d) => d.day === 'Fri')!;
    expect(fri.focus).toBe('Rest / easy cardio');
    expect(wk.filter((d) => ['A', 'B', 'C'].includes(d.focus))).toHaveLength(3);
  });
});

describe('fixed-weekday plans', () => {
  // Thursday 2026-10-29, block started Mon 2026-10-12 → week 3 of 6
  const THU = new Date(2026, 9, 29, 7);
  const fixed: BasePlan = {
    ...plan,
    startDate: '2026-10-12',
    reviewDate: '2026-11-23',
    weekNotes: ['w1', 'w2', '82–85%', 'w4', 'w5', 'deload'],
    days: [
      { id: 'r', name: 'Morning Routine', weekdays: [0, 1, 2, 3, 4, 5, 6], exercises: [{ exerciseId: 'hip-cars', sets: 2, repMin: 3, repMax: 3 }] },
      { id: 'm', name: 'Sprints', weekdays: [1], exercises: [{ exerciseId: 'accel-sprint', metric: 'time_distance', sets: 6, repMin: 0, repMax: 0, distance: 20, weekly: ['hills 6×20', 'hills 8×25', 'flat 6×20 + 2×30', '', '', 'test'] }] },
      { id: 'w', name: 'Lower A', weekdays: [3], exercises: [{ exerciseId: 'trap-bar-deadlift', sets: 4, repMin: 3, repMax: 5, weekly: ['4×5 @75%', '', '4×3–5 @ 82–85%', '', '', ''] }] },
      { id: 't', name: 'Upper', weekdays: [4], exercises: [{ exerciseId: 'bench-press', sets: 4, repMin: 4, repMax: 6, rpe: 7.5 }] },
    ],
  };
  const did = (date: Date, name: string): Session => ({ id: name, name, source: 'template', startedAt: date.toISOString(), finishedAt: date.toISOString(), exercises: [] });

  it("picks today's fixed session, flags missed days and shows the block week", () => {
    const mon = new Date(2026, 9, 26, 18);
    const out = planWithRules({ ...input, plan: fixed, sessions: [did(mon, 'Sprints')], now: THU });
    expect(out.block).toEqual({ week: 3, total: 6 });
    expect(out.recommendation.today.name).toBe('Upper');
    expect(out.missed).toEqual(['Lower A']);
    expect(out.recommendation.rationale[0]).toBe('Week 3 of 6 of "' + plan.name + '": 82–85%.');
    expect(out.recommendation.rationale.join(' ')).toMatch(/Missed so far this week: Lower A/);
    expect(out.recommendation.weekPlan.map((d) => d.focus)).toEqual(['Upper', 'Rest / easy cardio', 'Rest / easy cardio', 'Rest / easy cardio', 'Sprints', 'Rest / easy cardio', 'Lower A']);
  });

  it("applies this week's prescription to each exercise", () => {
    const out = planWithRules({ ...input, plan: fixed, now: new Date(2026, 9, 28, 7) });
    expect(out.recommendation.today.name).toBe('Lower A');
    expect(out.recommendation.today.exercises[0].note).toBe('W3: 4×3–5 @ 82–85%');
  });

  it("moves to the next fixed session when today's is done or there is none", () => {
    const out = planWithRules({ ...input, plan: fixed, sessions: [did(THU, 'Upper')], now: THU });
    expect(out.recommendation.today.name).toBe('Sprints');
    expect(out.recommendation.summary).toMatch(/Next session: Sprints \(Mon\)/);
  });

  it("doesn't count sprints or timed work as lifting sets", () => {
    const proj = projectedWeeklySets(fixed.days);
    expect(proj.quads).toBe(4 + 0); // trap bar DL only
    expect(proj.chest).toBe(4);
  });

  it('imports a plan file and rejects other JSON', () => {
    const { plan: p } = importPlan({ kind: 'lift-log-plan', version: 1, plan: fixed });
    expect(p.days.map((d) => d.name)).toEqual(['Morning Routine', 'Sprints', 'Lower A', 'Upper']);
    expect(p.id).not.toBe(fixed.id);
    expect(() => importPlan({ sessions: [] })).toThrow(/lift-log-plan/);
  });
});
