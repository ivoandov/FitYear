import { addDaysToDateKey } from "@/lib/date";

/**
 * Laying a routine out across the duration somebody chose.
 *
 * Until now a routine scheduled exactly ONE pass: each entry landed at
 * `startDate + dayIndex - 1`, once. Starting a 3-day routine "for 8 weeks"
 * produced three sessions, not eight weeks of training, and the duration was
 * only ever used to filter entries out. Ivo, 2026-09-18, on wanting a
 * configurable "+5 lb every 2 weeks": that rule had nowhere to live, because a
 * manual routine had no second week to progress into.
 *
 * FitBot programs are the exception and must NOT be repeated. Its builder emits
 * a FLAT list where week five's session is its own entry with an absolute
 * dayIndex around 29, each already carrying its own computed `targetLoadLbs`.
 * Repeating those would duplicate the whole program. So repetition is decided
 * by whether the entries reach past ONE ROTATION, not by a flag somebody has to
 * remember to set and not by comparing against the duration - see the note on
 * that check below, which a first draft got exactly backwards.
 */

export type ScheduleEntry = {
  dayIndex: number;
  /** Anything else the caller needs carried through to the row it creates. */
  [key: string]: unknown;
};

export type ScheduledOccurrence<T> = {
  entry: T;
  /** "YYYY-MM-DD", zone-free by contract. */
  dateKey: string;
  /** 1-indexed week of the program, for progression. Week 1 is the first cycle. */
  week: number;
  /** 1-indexed repeat of the cycle. 1 on a non-repeating program. */
  cycle: number;
};

/**
 * The cycle period in days.
 *
 * `cycleLength` is authoritative when set - only `ai/save-program` writes it,
 * from the assembled program's own rotation. Otherwise the period is the span
 * of the entries, floored at 7: a routine with training days at dayIndex 1, 3
 * and 5 is a weekly routine with rest gaps, not a 5-day one, and collapsing it
 * to 5 would drift the training days earlier every repeat.
 */
export function cyclePeriodFor(
  entries: ScheduleEntry[],
  cycleLength?: number | null,
): number {
  if (cycleLength && cycleLength > 0) return cycleLength;
  const span = entries.reduce((m, e) => Math.max(m, e.dayIndex), 0);
  return Math.max(span, 7);
}

/**
 * Expand a routine into the sessions it should create.
 *
 * Repeats the cycle until `durationDays` is used up, and never schedules past
 * it: a program that says eight weeks produces eight weeks, so the progress
 * denominator and the end date agree with what is on the calendar.
 *
 * A routine whose entries already reach past one rotation is returned as a
 * single pass, which is what keeps FitBot programs intact.
 */
export function expandRoutineSchedule<T extends ScheduleEntry>(
  entries: T[],
  opts: { startKey: string; durationDays: number; cycleLength?: number | null },
): ScheduledOccurrence<T>[] {
  const { startKey, durationDays } = opts;
  const usable = entries
    .filter((e) => Number.isFinite(e.dayIndex) && e.dayIndex >= 1)
    .sort((a, b) => a.dayIndex - b.dayIndex);
  if (usable.length === 0 || durationDays < 1) return [];

  const span = usable[usable.length - 1].dayIndex;
  const period = cyclePeriodFor(usable, opts.cycleLength);

  // Already a full-length program: one pass, untouched.
  //
  // The discriminator is span against the CYCLE PERIOD, not against the
  // duration. A first draft compared it to the duration and got this exactly
  // wrong: a 35-day FitBot program whose last session falls on day 31 has a
  // span under the duration, so it would have been repeated and the whole
  // program duplicated on top of itself. Entries reaching past one rotation
  // mean the program is already expanded.
  if (span > period) {
    return usable
      .filter((e) => e.dayIndex <= durationDays)
      .map((entry) => ({
        entry,
        dateKey: addDaysToDateKey(startKey, entry.dayIndex - 1),
        week: Math.floor((entry.dayIndex - 1) / 7) + 1,
        cycle: 1,
      }));
  }

  const out: ScheduledOccurrence<T>[] = [];
  for (let cycle = 0; ; cycle++) {
    const offset = cycle * period;
    if (offset >= durationDays) break;
    for (const entry of usable) {
      const dayNumber = offset + entry.dayIndex; // 1-indexed day of the program
      if (dayNumber > durationDays) continue;
      out.push({
        entry,
        dateKey: addDaysToDateKey(startKey, dayNumber - 1),
        // Weeks are calendar weeks from the start, which is what a "+5 lb every
        // 2 weeks" rule means to a person. Deliberately NOT the cycle number:
        // a 10-day cycle and a week are different things and progression is
        // expressed in weeks.
        week: Math.floor((dayNumber - 1) / 7) + 1,
        cycle: cycle + 1,
      });
    }
    // A period of zero would loop forever; cyclePeriodFor floors at 7, but this
    // is the guard that makes that guarantee local rather than remote.
    if (period < 1) break;
  }
  return out;
}
