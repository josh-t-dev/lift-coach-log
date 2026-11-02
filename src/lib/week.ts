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
  status: 'done' | 'missed' | 'rest' | 'today' | 'upcoming';
}

/**
 * This calendar week (Mon–Sun) for the strip on Today. Past days show what
 * was logged (or what was missed); today and later show the plan with any
 * coach changes that still apply.
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
  const fresh = currentWeek(planWithRules({ plan, unit, sessions, customExercises: custom, now }).recommendation.weekPlan, rec, now);
  const byDate = new Map(fresh.map((d) => [d.date!, d]));
  const dailyNames = new Set(plan.days.filter(isDaily).map((d) => d.name));
  const cells: WeekCell[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(mon, i);
    const iso = isoDate(date);
    const wd = date.getDay();
    if (iso < today) {
      const logged = sessions
        .filter((s) => s.finishedAt && isoDate(new Date(s.startedAt)) === iso && !dailyNames.has(s.name))
        .map((s) => s.name);
      const planned = planDaysOn(plan.days.filter((d) => !isDaily(d)), date).map((d) => d.name);
      const acts = (plan.activities ?? []).filter((a) => a.weekdays.includes(wd));
      const actLabel = acts.map((a) => activityLabel(a, custom)).join(' + ') || undefined;
      const sportNames = acts.map((a) => (findExercise(a.exerciseId, custom)?.name ?? '').toLowerCase());
      const lifts = logged.filter((n) => !sportNames.includes(n.toLowerCase()));
      if (logged.length) cells.push({ date: iso, weekday: wd, focus: [...new Set(lifts.length ? lifts : logged)].join(' + '), activity: lifts.length ? actLabel : undefined, status: 'done' });
      else if (planned.length) cells.push({ date: iso, weekday: wd, focus: planned.join(' + '), activity: actLabel, status: 'missed' });
      else cells.push({ date: iso, weekday: wd, focus: actLabel ?? 'Rest', activity: actLabel, status: 'rest' });
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
    });
  }
  return cells;
}
