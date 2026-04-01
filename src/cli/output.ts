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
