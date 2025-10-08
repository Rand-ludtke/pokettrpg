let logLines = [];
let i = 0;
let playing = false;
// Default to packaged local sprites; parent app can override via postMessage
let spritesDir = '/vendor/showdown/sprites/gen5';
let currentMode = 'singles'; // 'singles' | 'boss3v1'
// Support multi-slot layout: p1a/p1b/p1c and p2a (and optionally p2b/p2c if doubles/triples)
const state = {
  p1a: { hp: 100, base: 'scaleX(-1)' },
  p1b: { hp: 100, base: 'scaleX(-1)' },
  p1c: { hp: 100, base: 'scaleX(-1)' },
  p2a: { hp: 100, base: 'scaleX(1)' },
  p2b: { hp: 100, base: 'scaleX(1)' },
  p2c: { hp: 100, base: 'scaleX(1)' },
};
const moveData = { ready: false, byId: {} };

const logElem = document.getElementById('log');
// Optional in embedded mode (may be null)
const statusElem = document.getElementById('status');
const p1aimg = document.getElementById('p1a-mon');
const p1bimg = document.getElementById('p1b-mon');
const p1cimg = document.getElementById('p1c-mon');
const p2aimg = document.getElementById('p2a-mon');
const p2bimg = null; // not present in DOM yet
const p2cimg = null;
// Primary aliases for compatibility with bridge/helpers
const p1img = p1aimg;
const p2img = p2aimg;
const overlay = document.getElementById('overlay');

function setMode(mode){
  currentMode = (mode === 'boss3v1') ? 'boss3v1' : 'singles';
  try {
    const p1bSlot = p1bimg && p1bimg.parentElement; const p1cSlot = p1cimg && p1cimg.parentElement;
    if (p1bSlot) p1bSlot.style.display = (currentMode === 'boss3v1') ? '' : 'none';
    if (p1cSlot) p1cSlot.style.display = (currentMode === 'boss3v1') ? '' : 'none';
  } catch {}
}
// Default to singles layout at startup
setMode('singles');

// Create simple HP bars
for (const [id, side] of [['p1a', p1aimg], ['p1b', p1bimg], ['p1c', p1cimg], ['p2a', p2aimg]]) {
  const bar = document.createElement('div');
  bar.style.position = 'absolute';
  bar.style.bottom = '-8px';
  bar.style.left = '0';
  bar.style.height = '6px';
  bar.style.width = '100px';
  bar.style.background = '#333';
  bar.style.borderRadius = '4px';
  const fill = document.createElement('div');
  fill.style.height = '100%';
  fill.style.width = '100%';
  fill.style.background = '#29cc54';
  fill.style.borderRadius = '4px';
  bar.appendChild(fill);
  side.parentElement.appendChild(bar);
  state[id].bar = fill;
}

// Initialize base transforms (face each other)
try { p1aimg.style.transform = state.p1a.base; } catch(e){}
try { p1bimg && (p1bimg.style.transform = state.p1b.base); } catch(e){}
try { p1cimg && (p1cimg.style.transform = state.p1c.base); } catch(e){}
try { p2aimg.style.transform = state.p2a.base; } catch(e){}

// Load moves data for types/flags to color and classify animations
fetch('/showdown/data/moves.json').then(r=>r.json()).then(json=>{
  if (json && typeof json === 'object') {
    moveData.byId = json; moveData.ready = true;
  }
}).catch(()=>{ /* offline or missing: effects will fallback */ });

function appendLog(line) {
  logElem.textContent += line + '\n';
  logElem.scrollTop = logElem.scrollHeight;
}

function normalizeLine(line) {
  if (!line) return '';
  // Ignore input-style lines
  if (line.charAt(0) === '>') return '';
  // Strip leading room id like "battle-XXX|" to start from first pipe
  if (line.charAt(0) !== '|') {
    const idx = line.indexOf('|');
    if (idx >= 0) return line.slice(idx);
    return '';
  }
  return line;
}

function resolveImg(side){
  // Map generic p1/p2 to primary slots
  if (side === 'p1') side = 'p1a';
  if (side === 'p2') side = 'p2a';
  const map = { p1a: p1aimg, p1b: p1bimg, p1c: p1cimg, p2a: p2aimg, p2b: p2bimg, p2c: p2cimg };
  return map[side] || null;
}

function setSprite(side, species, shiny=false) {
  if (!spritesDir || !species) return;
  const file = `${species.toLowerCase().replace(/[^a-z0-9-]/g,'')}.png`;
  const url = spritesDir.replace(/\\/g,'/').replace(/\/$/,'') + '/' + file;
  let img = resolveImg(side);
  img.src = url;
}

function setHP(side, percent) {
  if (side === 'p1') side = 'p1a'; if (side === 'p2') side = 'p2a';
  const s = state[side];
  s.hp = Math.max(0, Math.min(100, percent));
  s.bar.style.width = `${s.hp}%`;
  s.bar.style.background = s.hp > 50 ? '#29cc54' : s.hp > 20 ? '#ffbf00' : '#ff4d4f';
}

function shake(img) {
  img.style.transform = 'translateX(-6px)';
  setTimeout(() => img.style.transform = 'translateX(6px)', 60);
  setTimeout(() => img.style.transform = 'translateX(0)', 120);
}

function attackAnim(side) {
  let img = resolveImg(side);
  const dir = side === 'p1' ? 1 : -1;
  const base = (side.startsWith('p1') ? state.p1a.base : state.p2a.base);
  img.style.transform = `${base} translateX(${12*dir}px)`;
  setTimeout(() => img.style.transform = `${base} translateX(${24*dir}px)`, 60);
  setTimeout(() => img.style.transform = `${base} translateX(${6*dir}px)`, 120);
  setTimeout(() => img.style.transform = `${base} translateX(0)`, 200);
}

function faintAnim(side) {
  let img = resolveImg(side);
  img.style.opacity = '0.2';
  setTimeout(() => img.style.opacity = '0.6', 120);
  setTimeout(() => img.style.opacity = '0.0', 260);
}

const TYPE_COLOR = {
  Normal: '#cccccc', Fire: '#ff7f24', Water: '#3db7ff', Electric: '#ffd600', Grass: '#65d96a', Ice: '#9be6ff', Fighting: '#d36f6f', Poison: '#b763cf', Ground: '#d3b457', Flying: '#9ac6ff', Psychic: '#ff6dac', Bug: '#93c33d', Rock: '#c9b873', Ghost: '#9b78eb', Dragon: '#8571ff', Dark: '#8a6a5a', Steel: '#b8b8d0', Fairy: '#f4b5f4'
};

function toId(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function moveInfo(moveName){
  try {
    const id = toId(moveName);
    const m = moveData.byId[id];
    if (!m) return { type:'Normal', category:'Status', flags:{} };
    return { type:m.type||'Normal', category:m.category||'Status', flags:m.flags||{} };
  } catch { return { type:'Normal', category:'Status', flags:{} }; }
}

function effectColorForType(type){ return TYPE_COLOR[type] || '#fff'; }

function projectileEffect(fromSide, toSide, color, size=8){
  if (!overlay) return;
  const from = resolveImg(fromSide);
  const to = resolveImg(toSide);
  const or = overlay.getBoundingClientRect();
  const fr = from.getBoundingClientRect(); const tr = to.getBoundingClientRect();
  const sx = fr.left - or.left + fr.width*0.6; const sy = fr.top - or.top + fr.height*0.4;
  const tx = tr.left - or.left + tr.width*0.4; const ty = tr.top - or.top + tr.height*0.5;
  const dot = document.createElement('div');
  dot.style.position = 'absolute'; dot.style.width = size+'px'; dot.style.height = size+'px';
  dot.style.borderRadius = size+'px'; dot.style.left = sx+'px'; dot.style.top = sy+'px';
  dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}`;
  overlay.appendChild(dot);
  const dx = tx - sx; const dy = ty - sy;
  dot.animate([{ transform:'translate(0,0)' }, { transform:`translate(${dx}px, ${dy}px)` }], { duration: 220, easing:'linear' });
  setTimeout(()=> { dot.remove(); sparkAt(toSide, color); }, 220);
}

function beamEffect(fromSide, toSide, color){
  if (!overlay) return;
  const fromEl = resolveImg(fromSide) || (fromSide==='p1'? p1aimg : p2aimg);
  const toEl = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg);
  const or = overlay.getBoundingClientRect(); const fr = fromEl.getBoundingClientRect(); const tr = toEl.getBoundingClientRect();
  const sx = fr.left - or.left + fr.width*0.65; const sy = fr.top - or.top + fr.height*0.35;
  const tx = tr.left - or.left + tr.width*0.4; const ty = tr.top - or.top + tr.height*0.45;
  const len = Math.hypot(tx - sx, ty - sy); const angle = Math.atan2(ty - sy, tx - sx) * 180 / Math.PI;
  const beam = document.createElement('div');
  beam.style.position = 'absolute'; beam.style.left = sx+'px'; beam.style.top = sy+'px';
  beam.style.width = '0px'; beam.style.height = '4px'; beam.style.background = color; beam.style.boxShadow = `0 0 10px ${color}, 0 0 20px ${color}`;
  beam.style.transformOrigin = 'left center'; beam.style.transform = `rotate(${angle}deg)`;
  overlay.appendChild(beam);
  beam.animate([{ width:'0px', opacity:1 }, { width: len+'px', opacity: 1 }], { duration: 200, easing:'ease-out' });
  setTimeout(()=> { beam.animate([{ opacity:1 }, { opacity:0 }], { duration: 120 }); setTimeout(()=> beam.remove(), 130); sparkAt(toSide, color); }, 210);
}

function boltEffect(fromSide, toSide, color){
  if (!overlay) return;
  const from = resolveImg(fromSide) || (fromSide==='p1'? p1aimg : p2aimg);
  const to = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg);
  const or = overlay.getBoundingClientRect(); const fr = from.getBoundingClientRect(); const tr = to.getBoundingClientRect();
  const sx = fr.left - or.left + fr.width*0.7; const sy = fr.top - or.top + fr.height*0.35;
  const tx = tr.left - or.left + tr.width*0.3; const ty = tr.top - or.top + tr.height*0.5;
  const segments = 4; let px = sx; let py = sy;
  for (let k=1;k<=segments;k++){
    const t = k/segments; const nx = sx + (tx - sx)*t + (Math.random()*20 - 10); const ny = sy + (ty - sy)*t + (Math.random()*16 - 8);
    const len = Math.hypot(nx - px, ny - py); const angle = Math.atan2(ny - py, nx - px) * 180 / Math.PI;
    const seg = document.createElement('div'); seg.style.position = 'absolute'; seg.style.left = px+'px'; seg.style.top = py+'px';
    seg.style.width = len+'px'; seg.style.height = '2px'; seg.style.background = color; seg.style.transformOrigin = 'left center';
    seg.style.transform = `rotate(${angle}deg)`; seg.style.boxShadow = `0 0 6px ${color}`;
    overlay.appendChild(seg);
    setTimeout(()=> { seg.style.opacity = '0'; seg.remove(); }, 140 + k*10);
    px = nx; py = ny;
  }
  setTimeout(()=> sparkAt(toSide, color), 160);
}

function flameConeEffect(fromSide, toSide, color){
  if (!overlay) return;
  const fromEl = resolveImg(fromSide) || (fromSide==='p1'? p1aimg : p2aimg);
  const toEl = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg);
  const or = overlay.getBoundingClientRect(); const fr = fromEl.getBoundingClientRect(); const tr = toEl.getBoundingClientRect();
  const sx = fr.left - or.left + fr.width*0.75; const sy = fr.top - or.top + fr.height*0.45;
  const tx = tr.left - or.left + tr.width*0.35; const ty = tr.top - or.top + tr.height*0.5;
  for (let k=0;k<12;k++){
    const dot = document.createElement('div');
    dot.style.position = 'absolute'; dot.style.width = '6px'; dot.style.height = '6px'; dot.style.borderRadius = '6px';
    dot.style.left = sx+'px'; dot.style.top = sy+'px'; dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}`;
    overlay.appendChild(dot);
    const ox = (Math.random()*30 - 15); const oy = (Math.random()*20 - 10);
    const ex = tx + (Math.random()*40 - 20); const ey = ty + (Math.random()*30 - 15);
    const dx = ex - (sx + ox); const dy = ey - (sy + oy);
    dot.animate([{ transform:`translate(${ox}px, ${oy}px)`, opacity:1 }, { transform:`translate(${dx}px, ${dy}px)`, opacity:0.4 }], { duration: 260 + Math.random()*60 });
    setTimeout(()=> dot.remove(), 340);
  }
  setTimeout(()=> sparkAt(toSide, color), 260);
}

function rockVolleyEffect(toSide, color='#c9b873'){
  if (!overlay) return; const to = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg); const or = overlay.getBoundingClientRect(); const tr = to.getBoundingClientRect();
  for (let k=0;k<4;k++){
    const rock = document.createElement('div'); rock.style.position='absolute'; rock.style.width='10px'; rock.style.height='8px'; rock.style.background=color; rock.style.boxShadow=`0 0 4px ${color}`;
    const sx = tr.left - or.left + (Math.random()*200 - 80); const sy = -20 - Math.random()*40; rock.style.left = sx+'px'; rock.style.top = sy+'px';
    overlay.appendChild(rock);
    const tx = tr.left - or.left + tr.width*0.5 + (Math.random()*20 - 10); const ty = tr.top - or.top + tr.height*0.6 + (Math.random()*10 - 5);
    const dx = tx - sx; const dy = ty - sy;
    rock.animate([{ transform:'translate(0,0)' }, { transform:`translate(${dx}px, ${dy}px)` }], { duration: 360, easing:'ease-in' });
  setTimeout(()=> { rock.remove(); sparkAt(toSide, color); const el = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg); if (el) shake(el); }, 360);
  }
}

function quakeEffect(){
  const targets = [p1aimg, p1bimg, p1cimg, p2aimg];
  for (const el of targets){ if (!el) continue; const base = (el===p2aimg? state.p2a.base : state.p1a.base); el.style.transform = `${base} translateX(-4px)`; setTimeout(()=> el.style.transform = `${base} translateX(4px)`, 60); setTimeout(()=> el.style.transform = `${base} translateX(0)`, 120); }
}

function gleamEffect(toSide, color){
  if (!overlay) return; const to = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg); const or = overlay.getBoundingClientRect(); const tr = to.getBoundingClientRect();
  for (let k=0;k<6;k++){
    const star = document.createElement('div'); const x = tr.left - or.left + tr.width*(0.3 + Math.random()*0.4); const y = tr.top - or.top + tr.height*(0.3 + Math.random()*0.4);
    star.style.position='absolute'; star.style.left=(x-4)+'px'; star.style.top=(y-4)+'px'; star.style.width='8px'; star.style.height='8px'; star.style.background=color; star.style.transform='rotate(45deg)';
    star.style.boxShadow=`0 0 8px ${color}`; overlay.appendChild(star);
    star.animate([{ transform:'rotate(45deg) scale(0.5)', opacity:0.8 }, { transform:'rotate(45deg) scale(1.8)', opacity:0 }], { duration: 360 });
    setTimeout(()=> star.remove(), 380);
  }
}

function meteorDropEffect(toSide, color){
  if (!overlay) return; const to = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg); const or = overlay.getBoundingClientRect(); const tr = to.getBoundingClientRect();
  for (let k=0;k<3;k++){
    const m = document.createElement('div'); const sx = tr.left - or.left + (Math.random()*200 - 40); const sy = -30 - Math.random()*60;
    m.style.position='absolute'; m.style.left=sx+'px'; m.style.top=sy+'px'; m.style.width='10px'; m.style.height='10px'; m.style.borderRadius='10px';
    m.style.background=color; m.style.boxShadow=`0 0 8px ${color}`; overlay.appendChild(m);
    const tx = tr.left - or.left + tr.width*(0.4 + Math.random()*0.2); const ty = tr.top - or.top + tr.height*(0.5 + Math.random()*0.2);
    const dx = tx - sx; const dy = ty - sy;
    m.animate([{ transform:'translate(0,0)' }, { transform:`translate(${dx}px, ${dy}px)` }], { duration: 420, easing:'ease-in' });
    setTimeout(()=> { m.remove(); sparkAt(toSide, color); shake(toSide==='p1'? p1img : p2img); }, 420);
  }
}

function pulseWaveEffect(fromSide, toSide, color){
  // Start at attacker, end at target as expanding ring; simple
  waveEffect(toSide, color);
}

function waveEffect(toSide, color){
  if (!overlay) return; const img = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg);
  const or = overlay.getBoundingClientRect(); const r = img.getBoundingClientRect();
  const cx = r.left - or.left + r.width/2; const cy = r.top - or.top + r.height/2;
  const ring = document.createElement('div'); ring.style.position = 'absolute'; ring.style.left = (cx-10)+'px'; ring.style.top = (cy-10)+'px';
  ring.style.width = '20px'; ring.style.height = '20px'; ring.style.border = `2px solid ${color}`; ring.style.borderRadius = '999px'; ring.style.opacity = '0.9';
  overlay.appendChild(ring);
  ring.animate([{ transform:'scale(1)', opacity:0.9 }, { transform:'scale(2.4)', opacity:0.2 }], { duration: 320, easing:'ease-out' });
  setTimeout(()=> ring.remove(), 330);
}

function powderEffect(toSide, color){
  if (!overlay) return; const img = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg); const or = overlay.getBoundingClientRect(); const r = img.getBoundingClientRect();
  for (let k=0;k<10;k++){
    const dot = document.createElement('div');
    const x = r.left - or.left + r.width/2; const y = r.top - or.top + r.height/2;
    dot.style.position = 'absolute'; dot.style.left = x+'px'; dot.style.top = y+'px'; dot.style.width = '6px'; dot.style.height = '6px';
    dot.style.background = color; dot.style.borderRadius = '6px'; dot.style.opacity = '0.9';
    overlay.appendChild(dot);
    const dx = (Math.random()*40-20); const dy = (Math.random()*30-10);
    dot.animate([{ transform:'translate(0,0)', opacity:0.9 }, { transform:`translate(${dx}px, ${dy}px)`, opacity:0 }], { duration: 360 });
    setTimeout(()=> dot.remove(), 380);
  }
}

function slashEffect(toSide, color){
  if (!overlay) return; const img = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg); const or = overlay.getBoundingClientRect(); const r = img.getBoundingClientRect();
  for (let k=0;k<2;k++){
    const cut = document.createElement('div');
    const x = r.left - or.left + r.width*0.3; const y = r.top - or.top + r.height*(0.3 + k*0.2);
    cut.style.position = 'absolute'; cut.style.left = x+'px'; cut.style.top = y+'px'; cut.style.width = '60px'; cut.style.height = '2px';
    cut.style.background = color; cut.style.boxShadow = `0 0 6px ${color}`; cut.style.transform = 'rotate(-20deg)';
    overlay.appendChild(cut);
    cut.animate([{ opacity:1 }, { opacity:0 }], { duration: 220 });
    setTimeout(()=> cut.remove(), 230);
  }
}

function explosionEffect(toSide, color){
  waveEffect(toSide, color); sparkAt(toSide, color); const img = resolveImg(toSide) || (toSide==='p1'? p1aimg : p2aimg); if (img) shake(img);
}

const curatedEffects = {
  flamethrower: 'flamecone', fireblast: 'explosion', ember: 'projectile', overheat: 'flamecone', willowisp: 'powder',
  thunderbolt: 'bolt', thunder: 'bolt', thunderwave: 'wave', volttackle: 'bolt', wildcharge: 'bolt',
  icebeam: 'beam', blizzard: 'powder', icepunch: 'impact', icywind: 'wave',
  surf: 'wave', hydropump: 'beam', waterpulse: 'pulse', scald: 'projectile',
  shadowball: 'orb', shadowclaw: 'slash', shadowsneak: 'slash',
  moonblast: 'gleam', dazzlinggleam: 'gleam', playrough: 'impact',
  psychic: 'wave', psyshock: 'projectile', psybeam: 'beam', futuresight: 'beam',
  earthquake: 'quake', earthpower: 'projectile', bulldoze: 'quake',
  rockslide: 'rockvolley', stoneedge: 'slash', rockblast: 'rockvolley',
  closecombat: 'slash', brickbreak: 'slash', machpunch: 'impact', bulletpunch: 'impact',
  leafblade: 'slash', energyball: 'orb', solarbeam: 'beam', leafstorm: 'powder',
  dragonpulse: 'pulse', dracometeor: 'meteor', dragonclaw: 'slash',
  darkpulse: 'pulse', foulplay: 'impact', nightslash: 'slash',
  flashcannon: 'beam', steelbeam: 'beam', meteormash: 'impact',
  sludgebomb: 'projectile', sludgewave: 'wave', poisonjab: 'impact'
};

function effectForMove(moveName){
  const info = moveInfo(moveName);
  const color = effectColorForType(info.type);
  const id = toId(moveName);
  const curated = curatedEffects[id];
  if (curated) return { kind: curated, color };
  // flags-based shortcuts
  if (info.flags?.punch) return { kind:'impact', color };
  if (info.flags?.bullet) return { kind:'projectile', color };
  if (info.flags?.powder) return { kind:'powder', color };
  if (info.flags?.sound) return { kind:'wave', color };
  if (info.flags?.pulse) return { kind:'beam', color };
  if (/beam|ray/.test(id)) return { kind:'beam', color };
  if (/blast|eruption|explosion|selfdestruct/.test(id)) return { kind:'explosion', color };
  if (/leaf|razorleaf|pin|needle/.test(id)) return { kind:'projectile', color };
  if (/slash|cut|xscissor|secretsword/.test(id)) return { kind:'slash', color };
  if (/wind|gust|hurricane|twister/.test(id)) return { kind:'wave', color };
  // Fallback by category
  if (info.category === 'Special') return { kind:'beam', color };
  if (info.category === 'Physical') return { kind:'impact', color };
  return { kind:'spark', color };
}

function sparkAt(targetSide, color='#fff') {
  const img = resolveImg(targetSide) || (targetSide === 'p1' ? p1aimg : p2aimg);
  if (!overlay || !img) return;
  const r = img.getBoundingClientRect();
  const or = overlay.getBoundingClientRect();
  const x = r.left - or.left + r.width/2;
  const y = r.top - or.top + r.height/2;
  const dot = document.createElement('div');
  dot.style.position = 'absolute';
  dot.style.width = '10px'; dot.style.height = '10px';
  dot.style.borderRadius = '10px';
  dot.style.background = color;
  dot.style.left = `${x-5}px`; dot.style.top = `${y-5}px`;
  dot.style.boxShadow = `0 0 10px ${color}, 0 0 20px ${color}`;
  dot.style.opacity = '0.9';
  overlay.appendChild(dot);
  setTimeout(()=> dot.style.opacity = '0.4', 80);
  setTimeout(()=> { dot.style.opacity = '0'; dot.remove(); }, 220);
}

function statusText(side, text) {
  const img = resolveImg(side) || (side === 'p1' ? p1aimg : p2aimg);
  if (!overlay || !img) return;
  const r = img.getBoundingClientRect();
  const or = overlay.getBoundingClientRect();
  const x = r.left - or.left + r.width/2;
  const y = r.top - or.top - 8;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.position = 'absolute';
  el.style.left = `${x - text.length * 3}px`; el.style.top = `${y}px`;
  el.style.color = '#fff'; el.style.fontSize = '12px';
  el.style.textShadow = '0 1px 2px #000';
  overlay.appendChild(el);
  setTimeout(()=> { el.style.top = `${y-16}px`; el.style.opacity = '0.5'; }, 50);
  setTimeout(()=> { el.style.opacity = '0'; el.remove(); }, 600);
}

function centerText(text, color='#fff') {
  if (!overlay) return;
  const el = document.createElement('div');
  el.textContent = text;
  el.style.position = 'absolute';
  el.style.left = '50%'; el.style.top = '16px'; el.style.transform = 'translateX(-50%)';
  el.style.color = color; el.style.fontSize = '14px'; el.style.fontWeight = '600';
  el.style.textShadow = '0 1px 2px #000, 0 0 8px rgba(0,0,0,0.5)';
  overlay.appendChild(el);
  setTimeout(()=> { el.style.top = '8px'; el.style.opacity = '0.7'; }, 50);
  setTimeout(()=> { el.style.opacity = '0'; el.remove(); }, 900);
}

function shieldEffect(toSide, color='#9cf') {
  if (!overlay) return; const img = toSide==='p1'? p1img : p2img; const or = overlay.getBoundingClientRect(); const r = img.getBoundingClientRect();
  const cx = r.left - or.left + r.width/2; const cy = r.top - or.top + r.height/2;
  const shield = document.createElement('div');
  shield.style.position = 'absolute'; shield.style.left = (cx-24)+'px'; shield.style.top = (cy-32)+'px';
  shield.style.width = '48px'; shield.style.height = '64px'; shield.style.border = `2px solid ${color}`; shield.style.borderRadius = '24px / 32px';
  shield.style.boxShadow = `0 0 12px ${color}`; shield.style.background = 'rgba(150,200,255,0.08)';
  overlay.appendChild(shield);
  shield.animate([{ opacity:1 }, { opacity:0.2 }], { duration: 300 });
  setTimeout(()=> shield.remove(), 320);
}

// Badges and condition overlays
const conditionState = {
  side: { p1: {}, p2: {} },
  field: {}
};

function showBadge(side, text, color='#999'){
  const img = (side === 'p1' ? (p1aimg || p1bimg || p1cimg) : (p2aimg));
  if (!overlay || !img) return;
  const r = img.getBoundingClientRect(); const or = overlay.getBoundingClientRect();
  const x = r.left - or.left + r.width*0.1; const y = r.top - or.top - 18;
  const el = document.createElement('div'); el.textContent = text;
  el.style.position='absolute'; el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.style.padding = '2px 6px'; el.style.fontSize='10px'; el.style.borderRadius='10px';
  el.style.background = 'rgba(0,0,0,0.5)'; el.style.color = color; el.style.border = `1px solid ${color}`;
  el.style.textShadow = '0 1px 1px #000';
  overlay.appendChild(el);
  setTimeout(()=> { el.style.top = `${y-10}px`; el.style.opacity = '0.7'; }, 50);
  setTimeout(()=> { el.style.opacity = '0'; el.remove(); }, 1100);
}

function layoutSideConditions(side){
  const map = conditionState.side[side]; const keys = Object.keys(map);
  const img = side === 'p1' ? (p1aimg || p1bimg || p1cimg) : (p2aimg); if (!overlay || !img) return;
  const r = img.getBoundingClientRect(); const or = overlay.getBoundingClientRect();
  let baseX = r.left - or.left - 6; let baseY = r.top - or.top + 4;
  keys.forEach((k, idx)=>{
    const el = map[k]; if (!el) return;
    el.style.left = `${baseX}px`; el.style.top = `${baseY + idx*16}px`;
  });
}

function updateSideCondition(side, key, label, color, active){
  const map = conditionState.side[side];
  if (active){
    if (map[key]) { map[key].textContent = label; map[key].style.borderColor = color; map[key].style.color = color; }
    else {
      const el = document.createElement('div'); el.textContent = label; el.style.position='absolute'; el.style.padding='1px 4px'; el.style.fontSize='10px'; el.style.border='1px solid '+color; el.style.borderRadius='8px'; el.style.background='rgba(0,0,0,0.35)'; el.style.color=color; el.style.textShadow='0 1px 1px #000'; overlay.appendChild(el); map[key] = el;
    }
  } else {
    if (map[key]) { map[key].remove(); delete map[key]; }
  }
  layoutSideConditions(side);
}

function layoutFieldConditions(){
  const keys = Object.keys(conditionState.field); if (!overlay) return;
  let baseX = overlay.clientWidth/2 - (keys.length*22)/2; const y = 34;
  keys.forEach((k, idx)=>{ const el = conditionState.field[k]; if (!el) return; el.style.left = `${baseX + idx*22}px`; el.style.top = `${y}px`; });
}

function updateFieldCondition(key, label, color, active){
  if (active){
    if (conditionState.field[key]) { conditionState.field[key].title = label; conditionState.field[key].style.borderColor=color; conditionState.field[key].style.background = color + '22'; }
    else { const el = document.createElement('div'); el.title=label; el.style.position='absolute'; el.style.width='16px'; el.style.height='16px'; el.style.borderRadius='16px'; el.style.border='2px solid '+color; el.style.background = color + '22'; overlay.appendChild(el); conditionState.field[key]=el; }
  } else { if (conditionState.field[key]) { conditionState.field[key].remove(); delete conditionState.field[key]; } }
  layoutFieldConditions();
}

function healEffect(side){
  const color = '#7cf58a'; waveEffect(side, color);
}

function processLine(lineRaw) {
  const line = normalizeLine(lineRaw);
  if (!line) return;
  if (line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|detailschange|')) {
    // Accept p1a/p1b/p1c or p1/p2 and map accordingly
    const m = /\|(p[12][abc]?)[a-z]*: ([^|]+)\|([^|]*)\|([^|]*)?/.exec(line);
    if (m) {
      setSprite(m[1], m[2]);
      // HP like 100/100; capture left as percent
      const hp = m[3] || '';
      const pm = /^(\d+)(?:\/\d+)?/.exec(hp);
      if (pm) setHP(m[1], Number(pm[1]));
    }
  } else if (line.startsWith('|-damage|') || line.startsWith('|-heal|')) {
    const m = /\|(p[12][abc]?)[a-z]*: [^|]+\|(\d+)(?:\/\d+)?/.exec(line);
    if (m) setHP(m[1], Number(m[2]));
    if (line.startsWith('|-damage|')) {
  const side = m && m[1] ? m[1] : 'p2a';
  const img = resolveImg(side) || p2aimg; if (img) shake(img);
      if (/\[from\] (?:move: )?Stealth Rock/i.test(line)) showBadge(side, 'Stealth Rock', '#c9b873');
      if (/\[from\] (?:move: )?Spikes/i.test(line)) showBadge(side, 'Spikes', '#ccc');
      if (/\[from\] (?:move: )?Toxic Spikes/i.test(line)) showBadge(side, 'Toxic Spikes', '#b763cf');
      if (/\[from\] (?:move: )?Sticky Web/i.test(line)) showBadge(side, 'Sticky Web', '#f4b5f4');
    }
    if (line.startsWith('|-heal|')) {
  const side = m && m[1] ? m[1] : 'p2a';
      healEffect(side);
      if (/\[from\] item: Leftovers/i.test(line)) showBadge(side, 'Leftovers', '#7cf58a');
      if (/\[from\] item: Black Sludge/i.test(line)) showBadge(side, 'Black Sludge', '#7cf58a');
    }
    if (line.includes('[from] brn')) statusText(m && m[1] || 'p1', 'BRN');
  } else if (line.startsWith('|move|')) {
    const parts = line.split('|');
    const user = parts[2] || '';
    const move = parts[3] || '';
    appendLog(`> ${user} used ${move}!`);
  let side = (user.indexOf('p1') === 0) ? 'p1a' : (user.indexOf('p2') === 0) ? 'p2a' : null;
    if (side) {
      attackAnim(side);
  const opponent = side.startsWith('p1') ? 'p2a' : 'p1a';
      const eff = effectForMove(move);
      if (eff.kind === 'beam') beamEffect(side, opponent, eff.color);
      else if (eff.kind === 'bolt') boltEffect(side, opponent, eff.color);
      else if (eff.kind === 'flamecone') flameConeEffect(side, opponent, eff.color);
      else if (eff.kind === 'projectile') projectileEffect(side, opponent, eff.color);
      else if (eff.kind === 'orb') projectileEffect(side, opponent, eff.color, 12);
      else if (eff.kind === 'powder') powderEffect(opponent, eff.color);
      else if (eff.kind === 'wave') waveEffect(opponent, eff.color);
      else if (eff.kind === 'pulse') pulseWaveEffect(side, opponent, eff.color);
      else if (eff.kind === 'slash') slashEffect(opponent, eff.color);
      else if (eff.kind === 'explosion') explosionEffect(opponent, eff.color);
      else if (eff.kind === 'rockvolley') rockVolleyEffect(opponent, eff.color);
  else if (eff.kind === 'gleam') gleamEffect(opponent, eff.color);
      else if (eff.kind === 'meteor') meteorDropEffect(opponent, eff.color);
    else if (eff.kind === 'quake') { quakeEffect(); const el = resolveImg(opponent) || (opponent==='p1'? p1aimg : p2aimg); if (el) shake(el); }
  else if (eff.kind === 'impact') { sparkAt(opponent, eff.color); const el = resolveImg(opponent) || (opponent==='p1'? p1aimg : p2aimg); if (el) shake(el); }
      else sparkAt(opponent, eff.color);
    }
  } else if (line.startsWith('|-hitcount|')) {
    // Multi-hit feedback; optional small sparks
    const m = /\|(-hitcount)\|[^|]+\|(\d+)/.exec(line);
    if (m) statusText('p2', `${m[2]} hits`);
  } else if (line.startsWith('|-crit|')) {
    const who = (line.split('|')[2] || '');
    const side = who.indexOf('p1')===0 ? 'p1' : who.indexOf('p2')===0 ? 'p2' : 'p2';
    statusText(side, 'CRIT!');
  } else if (line.startsWith('|-supereffective|')) {
    const who = (line.split('|')[2] || '');
    const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    statusText(side, 'Super effective'); sparkAt(side, '#ffef60');
  } else if (line.startsWith('|-resisted|')) {
    const who = (line.split('|')[2] || '');
    const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    statusText(side, 'Not very effective');
  } else if (line.startsWith('|-status|')) {
    // |-status|POKEMON|SLP/BRN/FRZ/PSN/PAR
    const parts = line.split('|');
    const who = parts[2] || ''; const st = (parts[3] || '').toUpperCase();
    const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    const text = st==='BRN'?'BRN': st==='FRZ'?'FRZ': st==='PAR'?'PAR': st==='PSN'||st==='TOX'?'PSN': st==='SLP'?'SLP': st;
    statusText(side, text);
  } else if (line.startsWith('|-curestatus|')) {
    const parts = line.split('|'); const who = parts[2] || ''; const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    statusText(side, 'Cured');
  } else if (line.startsWith('|-boost|') || line.startsWith('|-unboost|')) {
    // |-boost|POKEMON|atk|1
    const parts = line.split('|'); const who = parts[2] || ''; const stat = parts[3] || ''; const amt = parts[4] || '1';
    const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    const up = line.startsWith('|-boost|');
    const name = stat.toUpperCase();
    statusText(side, `${up?'+':'-'}${amt} ${name}`);
  } else if (line.startsWith('|-miss|')) {
    const parts = line.split('|'); const who = parts[2] || ''; const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    statusText(side==='p1'?'p1':'p2', 'Missed!');
  } else if (line.startsWith('|-immune|')) {
    const parts = line.split('|'); const who = parts[2] || ''; const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    statusText(side, 'No effect');
  } else if (line.startsWith('|-fail|')) {
    const parts = line.split('|'); const who = parts[2] || ''; const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    statusText(side, 'Failed');
  } else if (line.startsWith('|-start|')) {
    // |-start|POKEMON|move: Protect or |-start|POKEMON|Substitute
    const parts = line.split('|'); const who = parts[2] || ''; const effect = (parts[3] || '').toLowerCase();
    const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    if (effect.includes('protect')) shieldEffect(side, '#aef');
    else if (effect.includes('substitute')) shieldEffect(side, '#cfc');
    else if (effect.includes('reflect') || effect.includes('lightscreen')) statusText(side, effect.includes('reflect')?'Reflect':'Light Screen');
  } else if (line.startsWith('|-sidestart|')) {
    // |-sidestart|p1: [side]|Reflect or |-sidestart|p2: [side]|move: Stealth Rock
    const parts = line.split('|');
    const target = parts[2] || ''; const side = target.indexOf('p1')===0 ? 'p1' : 'p2';
    const eff = (parts[3] || '').toLowerCase();
    const effId = toId(eff.replace('move:',''));
    if (effId.includes('stealthrock')) updateSideCondition(side, 'sr', 'SR', '#c9b873', true);
    else if (effId.includes('spikes') && !effId.includes('toxic')) updateSideCondition(side, 'spikes', 'Spk', '#ccc', true);
    else if (effId.includes('toxicspikes')) updateSideCondition(side, 'tspikes', 'TSpk', '#b763cf', true);
    else if (effId.includes('stickyweb')) updateSideCondition(side, 'web', 'Web', '#f4b5f4', true);
    else if (effId.includes('reflect')) updateSideCondition(side, 'reflect', 'Ref', '#9cf', true);
    else if (effId.includes('lightscreen')) updateSideCondition(side, 'ls', 'LS', '#ffdb6e', true);
    else if (effId.includes('auroraveil')) updateSideCondition(side, 'av', 'AV', '#cceeff', true);
    else if (effId.includes('safeguard')) updateSideCondition(side, 'safeguard', 'S', '#aef', true);
    else if (effId.includes('tailwind')) updateSideCondition(side, 'tailwind', 'TW', '#9cf', true);
  } else if (line.startsWith('|-sideend|')) {
    const parts = line.split('|'); const target = parts[2] || ''; const side = target.indexOf('p1')===0 ? 'p1' : 'p2';
    const eff = (parts[3] || '').toLowerCase(); const effId = toId(eff.replace('move:',''));
    if (effId.includes('stealthrock')) updateSideCondition(side, 'sr', '', '#c9b873', false);
    else if (effId.includes('toxicspikes')) updateSideCondition(side, 'tspikes', '', '#b763cf', false);
    else if (effId.includes('stickyweb')) updateSideCondition(side, 'web', '', '#f4b5f4', false);
    else if (effId.includes('spikes') && !effId.includes('toxic')) updateSideCondition(side, 'spikes', '', '#ccc', false);
    else if (effId.includes('reflect')) updateSideCondition(side, 'reflect', '', '#9cf', false);
    else if (effId.includes('lightscreen')) updateSideCondition(side, 'ls', '', '#ffdb6e', false);
    else if (effId.includes('auroraveil')) updateSideCondition(side, 'av', '', '#cceeff', false);
    else if (effId.includes('safeguard')) updateSideCondition(side, 'safeguard', '', '#aef', false);
    else if (effId.includes('tailwind')) updateSideCondition(side, 'tailwind', '', '#9cf', false);
  } else if (line.startsWith('|-end|')) {
    const parts = line.split('|'); const who = parts[2] || ''; const effect = (parts[3] || '').toLowerCase(); const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    if (effect.includes('protect')) statusText(side, 'Protect End');
    if (effect.includes('substitute')) statusText(side, 'Sub End');
  } else if (line.startsWith('|weather|') || line.startsWith('|-weather|')) {
    // |weather|RainDance or |-weather|RainDance|[upkeep]
    const parts = line.split('|'); const w = parts[2] || '';
    const name = w.replace(/([A-Z])/g, ' $1').trim();
    const color = /Sand/.test(name)? '#d2b48c' : /Rain/.test(name)? '#9cf' : /Sun/.test(name)? '#f60' : /Hail|Snow/.test(name)? '#cde' : '#fff';
    centerText(name, color);
  } else if (line.startsWith('|-fieldstart|')) {
    const parts = line.split('|'); const eff = (parts[2]||''); const id = toId(eff);
    if (id.includes('electricterrain')) updateFieldCondition('eterrain', 'Electric Terrain', '#ffd600', true);
    else if (id.includes('grassyterrain')) updateFieldCondition('gterrain', 'Grassy Terrain', '#65d96a', true);
    else if (id.includes('mistyterrain')) updateFieldCondition('mterrain', 'Misty Terrain', '#cde', true);
    else if (id.includes('psychicterrain')) updateFieldCondition('pterrain', 'Psychic Terrain', '#ff6dac', true);
    else if (id.includes('trickroom')) updateFieldCondition('trickroom', 'Trick Room', '#c9f', true);
  } else if (line.startsWith('|-fieldend|')) {
    const parts = line.split('|'); const eff = (parts[2]||''); const id = toId(eff);
    if (id.includes('electricterrain')) updateFieldCondition('eterrain', '', '#ffd600', false);
    else if (id.includes('grassyterrain')) updateFieldCondition('gterrain', '', '#65d96a', false);
    else if (id.includes('mistyterrain')) updateFieldCondition('mterrain', '', '#cde', false);
    else if (id.includes('psychicterrain')) updateFieldCondition('pterrain', '', '#ff6dac', false);
    else if (id.includes('trickroom')) updateFieldCondition('trickroom', '', '#c9f', false);
  } else if (line.startsWith('|-faint|')) {
    const parts = line.split('|');
    const who = parts[2] || '';
    const side = (who.indexOf('p1') === 0) ? 'p1' : (who.indexOf('p2') === 0) ? 'p2' : null;
    if (side) faintAnim(side);
  } else if (line.startsWith('|win|')) {
    const winner = line.split('|')[2];
    appendLog(`Winner: ${winner}`);
  } else if (line.startsWith('|-ability|')) {
    const parts = line.split('|'); const who = parts[2]||''; const ab = parts[3]||'';
    const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    showBadge(side, ab, '#88f');
  } else if (line.startsWith('|-item|')) {
    const parts = line.split('|'); const who = parts[2]||''; const item = parts[3]||'';
    const side = who.indexOf('p1')===0 ? 'p1' : 'p2';
    showBadge(side, item, '#8f8');
  }
}

function step() {
  if (i >= logLines.length) { if (statusElem) statusElem.textContent = 'end of log'; playing = false; return; }
  const line = logLines[i++];
  const n = normalizeLine(line);
  if (!n) return step();
  appendLog(n);
  processLine(n);
}

// Playback helper (used by bridge too)
async function play() {
  playing = true;
  while (playing && i < logLines.length) {
    step();
    await new Promise(r => setTimeout(r, 250));
  }
}

// Embedded mode only: no local file/sprites/play/step controls

// Click-to-target support: clicking a sprite posts a message up to parent to set target
try {
  function clickTarget(side) {
    try { if (window.parent) window.parent.postMessage({ type:'mb:clickTarget', side }, '*'); } catch(e){}
  }
  p1aimg?.addEventListener('click', () => clickTarget('p1a'));
  p1bimg?.addEventListener('click', () => clickTarget('p1b'));
  p1cimg?.addEventListener('click', () => clickTarget('p1c'));
  p2aimg?.addEventListener('click', () => clickTarget('p2a'));
} catch(e){}
