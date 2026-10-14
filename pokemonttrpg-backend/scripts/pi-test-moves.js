// Test script to verify moves.js loads on the Pi
console.log('Loading from: ../dist/data/moves.js');
try {
  const mod = require('../dist/data/moves.js');
  const m = mod.default || mod;
  console.log('Moves loaded:', Object.keys(m).length);
  console.log('renewal pp:', m.renewal ? m.renewal.pp : 'MISSING');
  console.log('blackout pp:', m.blackout ? m.blackout.pp : 'MISSING');
  console.log('sandjet pp:', m.sandjet ? m.sandjet.pp : 'MISSING');
} catch (e) {
  console.error('FAILED to load moves.js:', e.message);
}