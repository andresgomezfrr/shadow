/**
 * CLI output goes to stdout — shell scripts, hooks (statusline.sh), and
 * pipes (`shadow --json status | jq`) depend on this. The daemon `log.ts`
 * module is stderr-only because it's for operational logs; this printer
 * is for user-facing data, which is a different stream contract.
 *
 * Regression history: the O-05 logger migration initially replaced these
 * `console.log` calls with `log.info` (stderr), which broke the statusline
 * hook — it saw empty stdout and showed "{•_•} offline" despite the daemon
 * being healthy. Reverted to stdout + documented the stream boundary.
 */

export function printOutput(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log('No results.');
      return;
    }

    for (const item of value) {
      console.log(renderHuman(item));
      console.log('---');
    }
    return;
  }

  console.log(renderHuman(value));
}

function renderHuman(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return String(value);
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined);

  return entries
    .map(([key, entry]) => {
      const rendered =
        typeof entry === 'string'
          ? entry
          : entry === null
            ? 'null'
            : Array.isArray(entry) || typeof entry === 'object'
              ? JSON.stringify(entry)
              : String(entry);

      return `${key}: ${rendered}`;
    })
    .join('\n');
}
