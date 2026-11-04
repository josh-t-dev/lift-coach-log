/**
 * "This week" as the user lives it: calendar dates, earlier coach changes
 * that still lie ahead, and what was actually logged on past days.
 */
import { findExercise } from '../data/exercises';
import type { BasePlan, Exercise, PlanChange, Recommendation, Session, Unit, WeekPlanDay } from '../types';
import { addDays, isoDate, weekStart } from './analytics';
import { activityLabel, isDaily, planDaysOn, planWithRules } from './planner';

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Weekday (0 = Sun) named by a label like "Today (Sun)", "Mon" or "Wednesday". */
export function weekdayOfLabel(label: string, ref: Date): number {
  const m = label.toLowerCase().match(/(sun|mon|tue|wed|thu|fri|sat)/);
  if (m) return WD.indexOf(m[1]);
  return /today/i.test(label) ? ref.getDay() : -1;
}

/** Each week-plan entry with its calendar date (entries run from the day the plan was made). */
export function datedDays(rec: Recommendation): (WeekPlanDay & { date: string })[] {
  const start = dayStart(new Date(rec.createdAt));
  return rec.weekPlan.map((d, i) => ({ ...d, date: d.date ?? isoDate(addDays(start, i)) }));
}

/** The calendar date a change refers to: its own date, else the first matching weekday on/after the plan's day. */
export function changeDate(rec: Recommendation, c: PlanChange): string | undefined {
  if (c.date) return c.date;
  const start = dayStart(new Date(rec.createdAt));
  const wd = weekdayOfLabel(c.day, start);
  if (wd < 0) return undefined;
  for (let i = 0; i < 7; i++) if (addDays(start, i).getDay() === wd) return isoDate(addDays(start, i));
  return undefined;
}

/** Days of a recommendation that are today or later and in this calendar week. */
export function upcomingDays(rec: Recommendation | null | undefined, now: Date): Map<string, WeekPlanDay & { date: string }> {
  const out = new Map<string, WeekPlanDay & { date: string }>();
  if (!rec) return out;
  const today = isoDate(now);
  const end = isoDate(addDays(weekStart(now), 7));
  for (const d of datedDays(rec)) if (d.date >= today && d.date < end) out.set(d.date, d);
  return out;
}

/** Earlier coach changes that are still ahead this week (today included). */
export function upcomingChanges(rec: Recommendation | null | undefined, now: Date): PlanChange[] {
  if (!rec?.changes) return [];
  const today = isoDate(now);
  const end = isoDate(addDays(weekStart(now), 7));
  return rec.changes
    .map((c) => ({ ...c, date: changeDate(rec, c) }))
    .filter((c) => c.date && c.date >= today && c.date < end);
}

/**
 * The next 7 days from today as the coach currently has them: the base plan's
 * days, with earlier coach changes for dates still ahead laid on top.
 */
export function currentWeek(baseWeek: WeekPlanDay[], previous: Recommendation | null | undefined, now: Date): WeekPlanDay[] {
  const ahead = upcomingDays(previous, now);
  return baseWeek.map((d, i) => {
    const date = d.date ?? isoDate(addDays(dayStart(now), i));
    const prev = ahead.get(date);
    return prev?.changed ? { ...prev, day: d.day, date } : { ...d, date };
  });
}

export interface WeekCell {
  date: string;
  weekday: number;
  focus: string;
  activity?: string;
  changed?: boolean;
  status: 'done' | 'missed' | 'moved' | 'rest' | 'today' | 'upcoming';
  /** Sessions logged on this day (today included). */
  logged?: string[];
  /** For 'moved': the weekday it was done on instead (0 = Sun). */
  movedTo?: number;
}

/**
 * This calendar week (Mon–Sun) for the strip on Today. Past days show what
 * was logged, what was done on another day instead ('moved'), what the coach
 * turned into a rest day, or what was missed. Today and later show the plan
 * with any coach changes that still apply; today is ticked once logged.
 */
export function weekView(
  plan: BasePlan,
  sessions: Session[],
  rec: Recommendation | null | undefined,
  unit: Unit,
  custom: Exercise[],
  now: Date = new Date(),
): WeekCell[] {
  const mon = weekStart(now);
  const today = isoDate(now);
  const end = isoDate(addDays(mon, 7));
  const fresh = currentWeek(planWithRules({ plan, unit, sessions, customExercises: custom, now }).recommendation.weekPlan, rec, now);
  const byDate = new Map(fresh.map((d) => [d.date!, d]));
  // What the coach had for past days of this week (from the last plan, if it covered them).
  const recByDate = new Map(rec ? datedDays(rec).map((d) => [d.date, d] as const) : []);
  const dailyNames = new Set(plan.days.filter(isDaily).map((d) => d.name));
  const lc = (x: string) => x.toLowerCase();

  // Training logged this week, by date (daily routines excluded).
  const loggedOn = new Map<string, string[]>();
  for (const s of sessions) {
    if (!s.finishedAt || dailyNames.has(s.name)) continue;
    const iso = isoDate(new Date(s.startedAt));
    if (iso < isoDate(mon) || iso >= end) continue;
    loggedOn.set(iso, [...(loggedOn.get(iso) ?? []), s.name]);
  }
  const doneElsewhere = (name: string, notOn: string): string | undefined => {
    for (const [iso, names] of loggedOn) if (iso !== notOn && names.some((n) => lc(n) === lc(name))) return iso;
    return undefined;
  };

  const cells: WeekCell[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(mon, i);
    const iso = isoDate(date);
    const wd = date.getDay();
    const logged = loggedOn.get(iso) ?? [];
    const acts = (plan.activities ?? []).filter((a) => a.weekdays.includes(wd));
    const actLabel = acts.map((a) => activityLabel(a, custom)).join(' + ') || undefined;
    const sportNames = acts.map((a) => lc(findExercise(a.exerciseId, custom)?.name ?? ''));
    const lifts = logged.filter((n) => !sportNames.includes(lc(n)));

    if (iso < today) {
      if (logged.length) {
        cells.push({ date: iso, weekday: wd, focus: [...new Set(lifts.length ? lifts : logged)].join(' + '), activity: lifts.length ? actLabel : undefined, status: 'done', logged });
        continue;
      }
      // The coach's version of this day if the last plan covered it, else the base plan.
      const coachDay = recByDate.get(iso);
      const planned = coachDay?.changed
        ? plan.days.filter((d) => !isDaily(d) && lc(coachDay.focus).includes(lc(d.name))).map((d) => d.name)
        : planDaysOn(plan.days.filter((d) => !isDaily(d)), date).map((d) => d.name);
      if (!planned.length) {
        // Past days only show a sport if it was logged.
        cells.push({ date: iso, weekday: wd, focus: 'Rest', changed: coachDay?.changed, status: 'rest' });
        continue;
      }
      // Done on another day this week (e.g. moved by the coach) → not missed.
      const elsewhere = planned.map((n) => doneElsewhere(n, iso));
      if (elsewhere.every(Boolean)) {
        const movedTo = new Date(elsewhere[0]! + 'T00:00').getDay();
        cells.push({ date: iso, weekday: wd, focus: planned.join(' + '), status: 'moved', movedTo });
      } else {
        cells.push({ date: iso, weekday: wd, focus: planned.join(' + '), status: 'missed' });
      }
      continue;
    }
    const d = byDate.get(iso);
    cells.push({
      date: iso,
      weekday: wd,
      focus: d?.focus ?? 'Rest / easy cardio',
      activity: d?.activity,
      changed: d?.changed,
      status: iso === today ? 'today' : 'upcoming',
      logged: iso === today && logged.length ? logged : undefined,
    });
  }
  return cells;
}
