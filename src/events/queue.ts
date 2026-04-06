import type { ShadowDatabase } from '../storage/database.js';
import type { EventRecord, UserProfileRecord } from '../storage/models.js';
import { isFocusModeActive } from '../profile/user-profile.js';

export type DeliveryDecision = {
  eventId: string;
  deliver: boolean;
  reason: string;
};

/**
 * Returns the minimum event priority that should be delivered for a given
 * proactivity level (1-10).
 *
 * 1-3:  priority >= 8  (critical only)
 * 4-5:  priority >= 5
 * 6-7:  priority >= 3
 * 8-10: all events (priority >= 1)
 */
export function getMinPriorityForProactivity(proactivityLevel: number): number {
  if (proactivityLevel <= 3) return 8;
  if (proactivityLevel <= 5) return 5;
  if (proactivityLevel <= 7) return 3;
  return 1;
}

/**
 * Check which events should be delivered based on the user profile settings.
 *
 * - If focus mode is active (focusMode is truthy and focusUntil is in the
 *   future), only events with priority >= 9 are delivered.
 * - Otherwise, proactivity-level-based filtering applies.
 */
export function checkDelivery(
  events: EventRecord[],
  profile: UserProfileRecord,
): DeliveryDecision[] {
  const inFocusMode = isFocusModeActive(profile);

  const minPriority = inFocusMode
    ? 9
    : getMinPriorityForProactivity(profile.proactivityLevel);

  return events.map((event) => {
    if (event.priority >= minPriority) {
      return {
        eventId: event.id,
        deliver: true,
        reason: inFocusMode
          ? `priority ${event.priority} meets focus-mode threshold (>= 9)`
          : `priority ${event.priority} meets proactivity threshold (>= ${minPriority})`,
      };
    }

    return {
      eventId: event.id,
      deliver: false,
      reason: inFocusMode
        ? `priority ${event.priority} below focus-mode threshold (>= 9)`
        : `priority ${event.priority} below proactivity threshold (>= ${minPriority})`,
    };
  });
}

/**
 * Retrieve pending events, evaluate delivery decisions, mark approved events
 * as delivered, and return the count of events that were delivered.
 */
export function deliverEvents(db: ShadowDatabase, profile: UserProfileRecord): number {
  const pending = db.listPendingEvents();
  if (pending.length === 0) return 0;

  const decisions = checkDelivery(pending, profile);
  let deliveredCount = 0;

  for (const decision of decisions) {
    if (decision.deliver) {
      db.deliverEvent(decision.eventId);
      deliveredCount++;
    }
  }

  return deliveredCount;
}
