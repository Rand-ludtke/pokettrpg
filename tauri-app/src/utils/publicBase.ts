export function getPublicBase(): string {
  const base = (import.meta as any)?.env?.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function withPublicBase(path: string): string {
  const base = getPublicBase();
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${base}${clean}`;
}
