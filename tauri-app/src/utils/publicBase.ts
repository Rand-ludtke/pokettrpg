export function getPublicBase(): string {
  let base = String((import.meta as any)?.env?.BASE_URL || '/').trim();
  if (!base) base = '/';

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    if (!base.startsWith('/') && !base.startsWith('./') && !base.startsWith('../')) {
      base = `/${base}`;
    }
  }

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
      const url = typeof window !== 'undefined'
        ? new URL(base, window.location.href)
        : new URL(base);
      base = url.pathname;
    } else if (typeof window !== 'undefined') {
      const url = new URL(base, window.location.origin);
      base = url.pathname;
    }
  } catch {
    // Keep the original base if URL parsing fails.
  }

  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

export function withPublicBase(path: string): string {
  const base = getPublicBase();
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${base}${clean}`;
}
