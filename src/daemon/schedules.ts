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

/** Current time in a given timezone (local methods return tz-adjusted values) */
function userNow(tz: string): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Check if a clock-scheduled job should run now */
export function isScheduleReady(schedule: ClockSchedule, tz: string, lastStartedAt?: string): boolean {
  const u = userNow(tz);

  // Day of week gate
  if (schedule.dayOfWeek !== undefined && u.getDay() !== schedule.dayOfWeek) return false;

  // Must be past scheduled time
  if (u.getHours() * 60 + u.getMinutes() < schedule.hour * 60 + schedule.minute) return false;

  // Already ran today?
  if (lastStartedAt) {
    const lastU = new Date(new Date(lastStartedAt).toLocaleString('en-US', { timeZone: tz }));
    if (dateKey(u) === dateKey(lastU)) return false;
  }

  return true;
}

/** Next occurrence of a schedule as UTC ISO string (for countdown display) */
export function nextScheduledAt(schedule: ClockSchedule, tz: string): string {
  const now = new Date();
  const u = userNow(tz);

  const currentMin = u.getHours() * 60 + u.getMinutes();
  const schedMin = schedule.hour * 60 + schedule.minute;

  let daysAhead = 0;
  if (schedule.dayOfWeek !== undefined) {
    daysAhead = (schedule.dayOfWeek - u.getDay() + 7) % 7;
    if (daysAhead === 0 && currentMin >= schedMin) daysAhead = 7;
  } else if (currentMin >= schedMin) {
    daysAhead = 1;
  }

  // Build target in user-tz space then convert to UTC
  const target = new Date(u);
  target.setDate(target.getDate() + daysAhead);
  target.setHours(schedule.hour, schedule.minute, 0, 0);

  const tzOffsetMs = u.getTime() - now.getTime();
  return new Date(target.getTime() - tzOffsetMs).toISOString();
}
