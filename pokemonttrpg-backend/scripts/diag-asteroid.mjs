import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

require('../dist/sync-ps-engine.js'); // triggers injections

const ps = require('pokemon-showdown');
const { Dex } = ps;

const mv = Dex.data.Moves.asteroidbelt;
console.log('--- move entry ---');
console.log('exists:', !!mv);
console.log('priority:', mv && mv.priority, 'target:', mv && mv.target);
console.log('has condition:', !!(mv && mv.condition));
console.log('condition keys:', mv && mv.condition ? Object.keys(mv.condition) : []);
console.log('onTryHit fn:', typeof mv?.condition?.onTryHit);

console.log('--- conditions.get ---');
const c = Dex.conditions.get('asteroidbelt');
console.log('exists:', c.exists);
console.log('keys:', Object.keys(c));
console.log('onTryHit fn:', typeof c.onTryHit);
console.log('duration:', c.duration);

console.log('--- conditions.getByID ---');
const c2 = Dex.conditions.getByID('asteroidbelt');
console.log('exists:', c2.exists);
console.log('keys:', Object.keys(c2));
console.log('onTryHit fn:', typeof c2.onTryHit);
