import type { ZodType } from 'zod';
import { log } from '../log.js';

// --- Extract JSON from LLM output ---

/**
 * Strip markdown fences and preamble, find the JSON object.
 *
 * Strategies in order:
 *   1. Markdown fence (```json ... ``` or ``` ... ```)
 *   2. Schema-specific beacon patterns — used when the LLM explored with tools
 *      and peppered the response with TypeScript-looking code blocks that
 *      mislead the first-{-to-last-} heuristic. Currently: {"verdict": ...}
 *      (revalidate-suggestion response shape — see audit A-02).
 *   3. First `{` to last `}` heuristic.
 */
export function extractJson(output: string): string {
  let s = output.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Schema beacon: look for a JSON object that starts with a key the caller expects.
  // Balances braces to extract the full object rather than relying on first-{-to-last-}
  // which may span multiple unrelated code blocks.
  const verdictStart = s.search(/\{\s*"verdict"\s*:/);
  if (verdictStart !== -1) {
    const extracted = extractBalancedObject(s, verdictStart);
    if (extracted) return extracted;
  }

  if (!s.startsWith('{')) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1) return s.slice(start, end + 1);
    // No closing brace found — return from first { to end (for repair)
    if (start !== -1) return s.slice(start);
  }
  return s;
}

/** Walk from startAt balancing braces, return substring through the matching `}`. */
function extractBalancedObject(s: string, startAt: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startAt; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(startAt, i + 1);
    }
  }
  return null;
}

// --- JSON Repair ---

/** Attempt to repair truncated JSON by closing unclosed structures */
export function repairJson(input: string): { json: string; repaired: boolean } {
  // Fast path: already valid
  try {
    JSON.parse(input);
    return { json: input, repaired: false };
  } catch { /* needs repair */ }

  let s = input;

  // Strategy 1: Track open structures and close them
  const repaired = closeStructures(s);
  if (repaired !== null) {
    try {
      JSON.parse(repaired);
      return { json: repaired, repaired: true };
    } catch { /* try next strategy */ }
  }

  // Strategy 2: Trim back to last complete array item, then close
  const trimmed = trimToLastCompleteItem(s);
  if (trimmed !== null && trimmed !== s) {
    const repairedTrimmed = closeStructures(trimmed);
    if (repairedTrimmed !== null) {
      try {
        JSON.parse(repairedTrimmed);
        return { json: repairedTrimmed, repaired: true };
      } catch { /* give up */ }
    }
  }

  return { json: input, repaired: false };
}

/** Scan string tracking open structures, close them at the end */
function closeStructures(input: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let i = 0;

  for (; i < input.length; i++) {
    const ch = input[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  if (stack.length === 0) return null; // nothing to close

  let result = input;

  // If we ended inside a string, close it
  if (inString) {
    result += '"';
  }

  // Remove trailing incomplete value: trailing comma, colon, or partial key
  result = result.replace(/,\s*$/, '');
  result = result.replace(/,\s*"[^"]*$/, ''); // trailing partial key in object
  result = result.replace(/:\s*$/, ': null');  // key with no value
  result = result.replace(/:\s*"[^"]*$/, ': null'); // key with truncated string value

  // Close all open structures in reverse order
  for (let j = stack.length - 1; j >= 0; j--) {
    result += stack[j];
  }

  return result;
}

/** Find the last complete array item (ends with `},` or `}]`) and trim there */
function trimToLastCompleteItem(input: string): string | null {
  // Find the last `},{` or `}]` or `},` — indicates a complete item boundary
  // Search backwards for `},` which separates array items
  let lastBoundary = -1;

  // Look for the pattern: }  followed by , or ] (with optional whitespace)
  for (let i = input.length - 1; i >= 0; i--) {
    if (input[i] === '}') {
      // Check if this } is followed by a , or ] (skipping whitespace)
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (j < input.length && (input[j] === ',' || input[j] === ']')) {
        lastBoundary = j; // include the comma
        break;
      }
    }
  }

  if (lastBoundary === -1) return null;

  // If it's a comma, trim up to and including the comma, then we'll close structures
  if (input[lastBoundary] === ',') {
    return input.slice(0, lastBoundary); // exclude trailing comma
  }
  // If it's a ], include it
  return input.slice(0, lastBoundary + 1);
}

// --- Safe Parse with Zod ---

type SafeParseResult<T> =
  | { success: true; data: T; repaired: boolean }
  | { success: false; error: string };

/** Extract JSON from LLM output, repair if truncated, validate with Zod */
export function safeParseJson<T>(output: string, schema: ZodType<T>, label: string): SafeParseResult<T> {
  const extracted = extractJson(output);

  const { json, repaired } = repairJson(extracted);

  // Try to parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { success: false, error: `JSON parse failed${repaired ? ' (after repair)' : ''}: ${e instanceof Error ? e.message : e}` };
  }

  // Validate with Zod
  const zodResult = schema.safeParse(parsed);
  if (zodResult.success) {
    if (repaired) {
      log.error(`[shadow:${label}] Repaired truncated JSON successfully`);
    }
    return { success: true, data: zodResult.data, repaired };
  }

  // If Zod failed on repaired JSON, try dropping the last item from each array
  if (repaired && typeof parsed === 'object' && parsed !== null) {
    const trimmed = dropLastArrayItems(parsed as Record<string, unknown>);
    const retryResult = schema.safeParse(trimmed);
    if (retryResult.success) {
      log.error(`[shadow:${label}] Repaired truncated JSON (dropped last truncated items)`);
      return { success: true, data: retryResult.data, repaired: true };
    }
  }

  const issues = zodResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
  return { success: false, error: `Zod validation failed${repaired ? ' (after repair)' : ''}: ${issues}` };
}

/** Drop the last element from every array in the top-level object */
function dropLastArrayItems(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0) {
      result[key] = value.slice(0, -1);
    } else {
      result[key] = value;
    }
  }
  return result;
}
