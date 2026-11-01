import { describe, expect, it, vi } from 'vitest';
import { findExercise } from '../data/exercises';
import type { LlmSettings, Profile, Session } from '../types';
import { e1rm, exerciseHistory, setsPerMuscle, snapshot, suggestLoad, weekStart } from './analytics';
import { extractJson, parseRecommendation, recommend } from './llm';
import { planWithRules } from './planner';

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
      sets: Array.from({ length: sets }, (_, j) => ({ id: `x${j}`, weight, reps, rir: 2, done: true })),
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
    expect(snapshot([], profile, [], NOW).status).toBe('new');
  });

  it('detects a missed week', () => {
    // Trained 2 and 3 weeks ago, nothing last week, nothing yet this week.
    const sessions = [session(9 + 7, 'A', [['back-squat', 3, 100, 8]]), session(10, 'B', [['back-squat', 3, 100, 8]])];
    const snap = snapshot(sessions, profile, [], NOW);
    expect(snap.lastWeek.sessions).toBe(0);
    expect(snap.status).toBe('missed-last-week');
    expect(snap.statusText).toBe('You missed last week.');
    expect(snap.adjustment.loadCut).toBe(0);
  });

  it('detects returning and detrained with load cuts', () => {
    const r = snapshot([session(16, 'A', [['back-squat', 3, 100, 8]])], profile, [], NOW);
    expect(r.status).toBe('returning');
    expect(r.adjustment.loadCut).toBeGreaterThan(0);
    const d = snapshot([session(40, 'A', [['back-squat', 3, 100, 8]])], profile, [], NOW);
    expect(d.status).toBe('detrained');
    expect(d.adjustment.loadCut).toBeGreaterThan(r.adjustment.loadCut);
  });

  it('is on track after a full week', () => {
    const sessions = [3, 5, 7].map((d) => session(d + 2, 'A', [['bench-press', 3, 80, 8]]));
    expect(snapshot(sessions, profile, [], NOW).status).toBe('on-track');
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
    const out = planWithRules({ profile, unit: 'kg', sessions: [], customExercises: [], now: NOW });
    expect(out.recommendation.source).toBe('rules');
    expect(out.recommendation.today.exercises.length).toBeGreaterThan(3);
    expect(out.recommendation.weekPlan).toHaveLength(7);
    expect(out.recommendation.weekPlan.filter((d) => !/Rest/.test(d.focus))).toHaveLength(3);
    // Every major muscle trained ~2x a week reaches the minimum weekly volume target.
    for (const m of ['chest', 'back', 'quads'] as const) expect(out.projected[m]).toBeGreaterThanOrEqual(6);
  });

  it('respects equipment', () => {
    const p = { ...profile, equipment: ['dumbbell', 'bodyweight'] as Profile['equipment'] };
    const out = planWithRules({ profile: p, unit: 'kg', sessions: [], customExercises: [], now: NOW });
    for (const d of out.allDays)
      for (const e of d.exercises) expect(['dumbbell', 'bodyweight']).toContain(findExercise(e.exerciseId)!.equipment);
  });

  it('tells you that you missed last week and uses your last loads', () => {
    const sessions = [session(16, 'Full Body A', [['back-squat', 3, 100, 8]]), session(10, 'Full Body B', [['rdl', 3, 90, 8]])];
    const out = planWithRules({ profile, unit: 'kg', sessions, customExercises: [], now: NOW });
    expect(out.recommendation.headline).toMatch(/missed last week/i);
    const squat = out.recommendation.today.exercises.find((e) => e.exerciseId === 'back-squat');
    expect(squat?.weight).toBe(100);
  });

  it('reduces volume after a long break', () => {
    const sessions = [session(45, 'Full Body A', [['back-squat', 3, 100, 8]])];
    const out = planWithRules({ profile, unit: 'kg', sessions, customExercises: [], now: NOW });
    expect(out.recommendation.headline).toMatch(/welcome back/i);
    const squat = out.recommendation.today.exercises.find((e) => e.exerciseId === 'back-squat');
    expect(squat!.weight!).toBeLessThan(100);
  });

  it('rotates to the next day not yet done this week', () => {
    const sessions = [session(1, 'Full Body A', [['back-squat', 3, 100, 8]])];
    const out = planWithRules({ profile, unit: 'kg', sessions, customExercises: [], now: NOW });
    expect(out.recommendation.today.name).toBe('Full Body B');
  });

  it('keeps sessions within the time budget', () => {
    const p = { ...profile, sessionMinutes: 30 };
    const out = planWithRules({ profile: p, unit: 'kg', sessions: [], customExercises: [], now: NOW });
    const sets = out.recommendation.today.exercises.reduce((a, e) => a + e.sets, 0);
    expect(sets).toBeLessThanOrEqual(8);
  });
});

describe('LLM output handling', () => {
  const input = { profile, unit: 'kg' as const, sessions: [], customExercises: [], now: NOW };
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
            { exerciseId: 'Barbell Bench Press', sets: 40, repMin: 8, repMax: 6, rir: 2, weight: '80' },
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
    expect(rec.today.exercises[0]).toMatchObject({ sets: 8, repMin: 8, repMax: 8, weight: 80 });
  });

  it('throws when no exercises are usable', () => {
    expect(() => parseRecommendation({ today: { exercises: [{ exerciseId: 'nope' }] } }, input, base, 'm')).toThrow();
  });

  it('falls back to rules with a warning when the server is down', async () => {
    const settings: LlmSettings = { enabled: true, baseUrl: 'http://localhost:1/v1', model: 'x', apiKey: '', jsonMode: true };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const rec = await recommend(input, settings);
    expect(rec.source).toBe('rules');
    expect(rec.warning).toMatch(/Couldn't reach/);
    vi.unstubAllGlobals();
  });

  it('uses the model reply when valid, and retries without json mode on 400', async () => {
    const reply = { headline: 'H', summary: 'S', rationale: ['r'], weekPlan: [], today: { name: 'T', exercises: [{ exerciseId: 'back-squat', sets: 3, repMin: 6, repMax: 10, rir: 2, weight: null }] } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('response_format not supported', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const rec = await recommend(input, { enabled: true, baseUrl: 'http://x/v1/', model: 'm', apiKey: 'k', jsonMode: true });
    expect(rec.source).toBe('llm');
    expect(rec.headline).toBe('H');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
