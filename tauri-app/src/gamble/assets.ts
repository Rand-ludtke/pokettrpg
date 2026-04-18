import { withPublicBase } from '../utils/publicBase';

export function gamecornerAsset(path: string): string {
  return withPublicBase(`gamecorner/${path.replace(/^\/+/, '')}`);
}