export function num(result: Record<string, unknown>, key: string): number {
  const v = result[key];
  return typeof v === 'number' ? v : 0;
}

export function str(result: Record<string, unknown>, key: string): string | undefined {
  const v = result[key];
  return typeof v === 'string' ? v : undefined;
}

export function arr(result: Record<string, unknown>, key: string): string[] {
  const v = result[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function items(result: Record<string, unknown>, key: string): Array<{ id: string; title: string }> {
  const v = result[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is { id: string; title: string } =>
    typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string' && typeof (x as Record<string, unknown>).title === 'string'
  );
}
