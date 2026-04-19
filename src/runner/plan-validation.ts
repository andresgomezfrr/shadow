/**
 * Empty-plan detection (audit R-05).
 *
 * A guard against LLM plans like "No changes needed. The code is good." —
 * non-empty strings that carry no actionable planning structure. Treated as
 * empty so downstream execute doesn't hallucinate changes.
 *
 * A plan is "empty in disguise" when it has BOTH:
 *   - no structural markers (no markdown heading, no `file:` reference, no
 *     numbered `step N:` / `1.` item, no bullet list), AND
 *   - <200 chars of real content (after stripping headings/blanks)
 *
 * AND (not OR) — a long unstructured explanation is still valid content; a
 * short structured checklist is still a real plan.
 */

const STRUCTURE_RX =
  /(^|\n)\s*-\s+|(^|\n)\s*\*\s+|(^|\n)\s*\d+\.\s+|file:|step\s*\d+[:.]/i;

const MIN_REAL_CHARS = 200;

export function isEmptyPlanInDisguise(plan: string): boolean {
  if (!plan.trim()) return true;

  const realContent = plan
    .replace(/^\s*(#+.*|<!--.*?-->)\s*$/gm, '')
    .replace(/^\s*$/gm, '')
    .trim();

  if (realContent.length === 0) return true;

  const hasStructure = STRUCTURE_RX.test(plan);
  return !hasStructure && realContent.length < MIN_REAL_CHARS;
}
