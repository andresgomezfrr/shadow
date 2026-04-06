import type { ShadowDatabase } from '../storage/database.js';
import type { UserProfileRecord } from '../storage/models.js';

/** Canonical focus mode check — use this everywhere instead of inline checks. */
export function isFocusModeActive(profile: UserProfileRecord): boolean {
  if (profile.focusMode !== 'focus') return false;
  if (profile.focusUntil) return new Date(profile.focusUntil) > new Date();
  return true; // focus with no expiry = always active
}

// --- Types ---

export type ProfileUpdate = {
  source: 'observation' | 'interaction' | 'suggestion-feedback' | 'explicit';
  field: string;
  value: unknown;
  confidence: number;
};

// --- Profile update ---

/**
 * Apply a profile update. For JSON object fields (workHours, commitPatterns,
 * preferences), merge the new value into the existing object rather than
 * overwriting. Only update if the new confidence exceeds the existing
 * confidence stored in the profile's preferences metadata.
 */
export function applyProfileUpdate(db: ShadowDatabase, update: ProfileUpdate): void {
  const profile = db.ensureProfile('default');

  // Check confidence gate: stored per-field in preferences._fieldConfidence
  const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
  const fieldConfidence = (prefs._fieldConfidence ?? {}) as Record<string, number>;
  const existingConfidence = fieldConfidence[update.field] ?? 0;

  if (update.confidence <= existingConfidence) {
    return; // new confidence is not higher -- skip
  }

  // Determine if the field is a JSON-merge field
  const jsonFields = new Set(['workHours', 'commitPatterns', 'preferences']);
  const isJsonField = jsonFields.has(update.field);

  let newValue: unknown;

  if (isJsonField) {
    // Merge: existing object + new partial
    const existing = (profile as Record<string, unknown>)[update.field];
    if (typeof existing === 'object' && existing !== null && typeof update.value === 'object' && update.value !== null) {
      newValue = { ...existing as Record<string, unknown>, ...update.value as Record<string, unknown> };
    } else {
      newValue = update.value;
    }
  } else {
    newValue = update.value;
  }

  // Build the database column name for the field.
  // JSON fields are stored with a _json suffix in the database, but the
  // updateProfile helper on ShadowDatabase handles snakeCase conversion and
  // the _json suffix detection internally.
  const updates: Record<string, unknown> = {
    [update.field]: newValue,
  };

  // Update confidence metadata inside preferences
  const newFieldConfidence = { ...fieldConfidence, [update.field]: update.confidence };
  const newPrefs = { ...prefs, _fieldConfidence: newFieldConfidence };

  // If we are updating preferences itself, merge our confidence metadata in
  if (update.field === 'preferences') {
    const merged = (typeof newValue === 'object' && newValue !== null)
      ? { ...newValue as Record<string, unknown>, _fieldConfidence: newFieldConfidence }
      : newPrefs;
    updates['preferences'] = merged;
  } else {
    updates['preferences'] = newPrefs;
  }

  db.updateProfile(profile.id, updates);
}

// --- Work hours detection ---

export type WorkHoursResult = {
  weekday: { start: string; end: string };
  weekend: { active: boolean };
};

/**
 * Analyze commit timestamps from observations over the last 14 days to
 * detect typical working hours.
 *
 * Returns the detected weekday start/end times and weekend activity, or
 * null if there is insufficient data (fewer than 5 observations).
 */
export function detectWorkHours(db: ShadowDatabase): WorkHoursResult | null {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const observations = db.listObservations({ sourceKind: 'repo', limit: 500 });

  // Filter to the last 14 days
  const recent = observations.filter((o) => o.createdAt >= fourteenDaysAgo);

  if (recent.length < 5) return null;

  const weekdayHours: number[] = [];
  const weekendCount = { total: 0 };

  for (const obs of recent) {
    const date = new Date(obs.createdAt);
    const day = date.getDay(); // 0=Sun, 6=Sat
    const hour = date.getHours();

    if (day === 0 || day === 6) {
      weekendCount.total++;
    } else {
      weekdayHours.push(hour);
    }
  }

  if (weekdayHours.length === 0) {
    return null;
  }

  // Sort hours and find the typical range (10th to 90th percentile)
  weekdayHours.sort((a, b) => a - b);
  const p10Index = Math.floor(weekdayHours.length * 0.1);
  const p90Index = Math.min(Math.floor(weekdayHours.length * 0.9), weekdayHours.length - 1);

  const startHour = weekdayHours[p10Index];
  const endHour = weekdayHours[p90Index];

  const pad = (n: number): string => String(n).padStart(2, '0');

  return {
    weekday: {
      start: `${pad(startHour)}:00`,
      end: `${pad(endHour)}:00`,
    },
    weekend: {
      active: weekendCount.total >= 3, // at least 3 weekend observations
    },
  };
}

// --- Commit patterns detection ---

export type CommitPatternsResult = {
  avgPerDay: number;
  style: string;
  avgSize: string;
};

/**
 * Analyze recent observations to detect commit patterns.
 *
 * Returns average commits per day, style characterization, and average
 * commit size. Returns null if insufficient data.
 */
export function detectCommitPatterns(db: ShadowDatabase): CommitPatternsResult | null {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const observations = db.listObservations({ sourceKind: 'repo', limit: 500 });

  const recent = observations.filter((o) => o.createdAt >= fourteenDaysAgo);

  if (recent.length < 3) return null;

  // Group by date to count commits per day
  const perDay = new Map<string, number>();
  for (const obs of recent) {
    const dateKey = obs.createdAt.slice(0, 10); // YYYY-MM-DD
    perDay.set(dateKey, (perDay.get(dateKey) ?? 0) + 1);
  }

  const days = perDay.size;
  const avgPerDay = Math.round((recent.length / Math.max(days, 1)) * 10) / 10;

  // Determine style from frequency
  let style: string;
  if (avgPerDay >= 10) {
    style = 'micro-commits';
  } else if (avgPerDay >= 4) {
    style = 'frequent';
  } else if (avgPerDay >= 1) {
    style = 'regular';
  } else {
    style = 'batched';
  }

  // Estimate average commit size from observation details
  let totalFilesChanged = 0;
  let fileCountEntries = 0;
  for (const obs of recent) {
    const detail = obs.detail as Record<string, unknown>;
    const files = Number(detail?.filesChanged ?? 0);
    if (files > 0) {
      totalFilesChanged += files;
      fileCountEntries++;
    }
  }

  let avgSize: string;
  if (fileCountEntries === 0) {
    avgSize = 'unknown';
  } else {
    const avgFiles = totalFilesChanged / fileCountEntries;
    if (avgFiles <= 2) {
      avgSize = 'small';
    } else if (avgFiles <= 8) {
      avgSize = 'medium';
    } else {
      avgSize = 'large';
    }
  }

  return { avgPerDay, style, avgSize };
}

// --- Effective proactivity ---

/**
 * Return the effective proactivity level for the user.
 *
 * If focusMode is 'focus' and focusUntil has not expired, return 1
 * (minimal proactivity). Otherwise return the profile's proactivityLevel.
 */
export function getEffectiveProactivity(profile: UserProfileRecord): number {
  if (isFocusModeActive(profile)) return 1;

  return profile.proactivityLevel;
}
