/**
 * Locale-aware prompt helpers (audit P-14 follow-up).
 *
 * Single source of truth for "given user.locale, what should I inject into
 * the prompt?". Two design rules:
 *
 *   1. **Inject the language name directly, never the locale code.**
 *      Bad:  "respond in the user's locale"
 *      Good: "respond in Spanish"
 *      The LLM doesn't have to look up `es` → `Spanish`; we hand the answer.
 *      Structural containment over prompt indirection.
 *
 *   2. **English is the base — no instruction emitted when locale is en.**
 *      All prompts are written in English by default. Adding "respond in
 *      English" to an English prompt is noise and wastes tokens. Only
 *      non-English locales get an explicit instruction.
 *
 * Examples (few-shot) follow the same pattern: an EN variant is the base,
 * an ES variant exists for current Spanish-speaking users. Picker returns EN
 * for unknown/missing locales — safe default.
 */

import { EXTRACT_EXAMPLE_EN, EXTRACT_EXAMPLE_ES, OBSERVE_EXAMPLE_EN, OBSERVE_EXAMPLE_ES } from './schemas.js';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ca: 'Catalan',
  ja: 'Japanese',
  zh: 'Chinese',
};

/** Map a locale code (e.g. 'es-ES', 'en_US', 'fr') to a language name. */
export function languageFromLocale(locale: string | null | undefined): string {
  if (!locale) return 'English';
  const code = locale.toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_NAMES[code] ?? 'English';
}

/**
 * Returns a ready-to-inject prompt fragment instructing the model to write
 * user-facing output in the right language. Empty string when locale is
 * English (the prompt's own default — no instruction needed).
 *
 * Usage in prompts:
 *   const instruction = outputLanguageInstruction(profile.locale);
 *   const prompt = ['Extract durable knowledge...', ..., instruction, ...].filter(Boolean).join('\n');
 */
export function outputLanguageInstruction(locale: string | null | undefined): string {
  const lang = languageFromLocale(locale);
  if (lang === 'English') return '';
  return `LANGUAGE: write all user-facing strings (titles, body content, summaries, notes) in ${lang}. Identifiers, code, file paths, and JSON keys stay as-is.`;
}

export function pickExtractExample(locale: string | null | undefined): string {
  return languageFromLocale(locale) === 'Spanish' ? EXTRACT_EXAMPLE_ES : EXTRACT_EXAMPLE_EN;
}

export function pickObserveExample(locale: string | null | undefined): string {
  return languageFromLocale(locale) === 'Spanish' ? OBSERVE_EXAMPLE_ES : OBSERVE_EXAMPLE_EN;
}
