// Clock-time based job scheduling — timezone-aware

export type ClockSchedule = {
  hour: number;       // 0-23
  minute: number;     // 0-59
  dayOfWeek?: number; // 0=Sun, 1=Mon, ... 6=Sat. undefined = every day
  label: string;      // human-readable, e.g. "daily 23:30"
};

export const DIGEST_SCHEDULES: Record<string, ClockSchedule> = {
  'digest-daily':  { hour: 23, minute: 30, label: 'daily 23:30' },
  'digest-weekly': { hour: 23, minute: 30, dayOfWeek: 0, label: 'Sun 23:30' },
  'digest-brag':   { hour: 8,  minute: 0,  dayOfWeek: 1, label: 'Mon 08:00' },
};

/** Extract date/time parts in a given timezone using Intl (DST-safe). */
function tzParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour), minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

function dateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Check if a clock-scheduled job should run now */
export function isScheduleReady(schedule: ClockSchedule, tz: string, lastStartedAt?: string): boolean {
  const u = tzParts(new Date(), tz);

  // Day of week gate
  if (schedule.dayOfWeek !== undefined && u.weekday !== schedule.dayOfWeek) return false;

  // Must be past scheduled time
  if (u.hour * 60 + u.minute < schedule.hour * 60 + schedule.minute) return false;

  // Already ran at/after scheduled time today?
  if (lastStartedAt) {
    const lastU = tzParts(new Date(lastStartedAt), tz);
    if (dateKey(u) === dateKey(lastU)) {
      const lastMin = lastU.hour * 60 + lastU.minute;
      if (lastMin >= schedule.hour * 60 + schedule.minute) return false;
    }
  }

  return true;
}

/** Next occurrence of a schedule as UTC ISO string (for countdown display) */
export function nextScheduledAt(schedule: ClockSchedule, tz: string): string {
  const now = new Date();
  const u = tzParts(now, tz);

  const currentMin = u.hour * 60 + u.minute;
  const schedMin = schedule.hour * 60 + schedule.minute;

  let daysAhead = 0;
  if (schedule.dayOfWeek !== undefined) {
    daysAhead = (schedule.dayOfWeek - u.weekday + 7) % 7;
    if (daysAhead === 0 && currentMin >= schedMin) daysAhead = 7;
  } else if (currentMin >= schedMin) {
    daysAhead = 1;
  }

  // Build target in user-tz space then convert to UTC via offset
  const userNowMs = new Date(`${u.year}-${String(u.month).padStart(2, '0')}-${String(u.day).padStart(2, '0')}T${String(u.hour).padStart(2, '0')}:${String(u.minute).padStart(2, '0')}:00`).getTime();
  const tzOffsetMs = userNowMs - now.getTime();
  const targetUserMs = userNowMs + daysAhead * 86_400_000 + (schedMin - currentMin) * 60_000;
  return new Date(targetUserMs - tzOffsetMs).toISOString();
}
