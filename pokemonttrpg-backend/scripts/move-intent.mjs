import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SS2_JSON = path.resolve(__dirname, '../../tauri-app/public/data/ss2-patch/generated/moves.custom.ss2-soulstones.json');
export const STAT_ALIASES = { 'attack':'atk','atk':'atk','defense':'def','def':'def','sp. atk':'spa','sp.atk':'spa','sp atk':'spa','special attack':'spa','special':'spa','sp. def':'spd','sp.def':'spd','sp def':'spd','special defense':'spd','speed':'spe','spe':'spe','accuracy':'accuracy','evasion':'evasion','all':'all' };
export function normStatWord(phrase){const p=phrase.toLowerCase().replace(/stat(s)?\b/g,'').trim().replace(/[^a-z. ']/g,'').trim();const q=p.replace(/[ .]/g,'');return STAT_ALIASES[p]||STAT_ALIASES[q]||({'spatk':'spa','spdef':'spd','atk':'atk','def':'def','spe':'spe'}[q])||undefined;}
export function stageFromText(t){t=t.toLowerCase();if(/drastically|maximi[sz]|three stages|by three/.test(t))return 3;if(/sharply|harshly|two stages|greatly|by two/.test(t))return 2;const m=t.match(/by\s+(three|two|one|\d)(?:\s+stages?)?/);if(m){const w={one:1,two:2,three:3}[m[1]]||parseInt(m[1],10);return Math.min(6,w);}return 1;}
export function chanceFromText(text){const m=text.toLowerCase().match(/(\d{1,3})\s?%(?:\s+chance| of the time)/);if(m)return Math.min(100,parseInt(m[1],10));return /always|will raise|guaranteed/.test(text.toLowerCase())?100:100;}
export function percentFraction(pct){return Math.round(pct)/100;}
export function classifyMove(id,entry,pristine){const base=pristine[id];if(!base)return 'new';const n=(t)=>String(t||'').toLowerCase().replace(/[^a-z0-9]/g,'');const ct=n(entry.type),bt=n(base.type);return(ct&&ct!==bt)?'retyped-variant':'canonical-kept';}
export function loadSS2Moves(){return JSON.parse(fs.readFileSync(SS2_JSON,'utf8'));}
function statPair(text){const out=[];const re=/(?:sp\.?\s*atk|sp\.?\s*def|special\s+attack|special\s+defense|attack|defense|defence|speed|accuracy|evasion|all\s+stats|(?<![a-z])atk(?![a-z])|(?<![a-z])def(?![a-z])|(?<![a-z])spe(?![a-z]))/gi;let m;while((m=re.exec(text))){const st=normStatWord(m[0]);if(st&&!out.includes(st))out.push(st);}return out.includes('all')?['atk','def','spa','spd','spe']:out;}
const pickT=(e)=>String(e.target||'normal');
const boostsFrom=(d,sign=1)=>{const s=statPair(d),b={};for(const st of s)b[st]=sign*stageFromText(d);return b;};
// Sign-aware boost parser: splits desc into clauses, decides +/- per clause.
// Protects "Sp." tokens before splitting so "Sp. Atk"/"Sp. Def" survive clause breaks.
export function signedBoosts(d){
    const tmp=String(d).toLowerCase().replace(/\bsp\./g,'sp_');
    const clauses=tmp.split(/ but | then | however |; |\. /).map(s=>s.trim()).filter(Boolean);
    const out={};
    for(const c of clauses){
        const neg=/(?:lower|reduc|cut|drop|shatter)/.test(c);
        const pos=/(?:rais|increas|boost|maximi)/.test(c);
        if(!neg&&!pos)continue;
        const stats=statPair(c.replace(/sp_/g,'sp.'));
        if(!stats.length)continue;
        const stage=stageFromText(c);
        for(const st of stats)out[st]=(st in out?out[st]:0)+(neg?-stage:stage);
    }
    return out;
}
// Moves whose mechanics need code handlers (function clones of canonical moves or
// bespoke side conditions). Implemented in sync-ps-engine.js customMoveEffectPatches.
export const ENGINE_BESPOKE = {
    asteroidbelt: {custom:'protect-contact-punish (existing handler)'},
    innervate: {clone:'healblock'},
    suppressaura: {clone:'gastroacid'},
    aurablock: {clone:'torment'},
    nervesofsteel: {clone:'mist'},
    guardianangel: {clone:'safeguard'},
    firewall: {clone:'wideguard'},
    hallowedground: {clone:'matblock'},
    vexingvines: {clone:'fairylock'},
    encircle: {clone:'fairylock'},
    judoflip: {clone:'topsyturvy'},
    frozenheart: {clone:'healbell'},
    powernap: {clone:'healbell'},
    shootingstar: {clone:'suckerpunch'},
    goldenbullet: {clone:'suckerpunch'},
    surgingblow: {clone:'suckerpunch'},
    coupdegrace: {clone:'brine'},
    dracotempest: {clone:'brine'},
    spectrallash: {clone:'brine'},
    huntdown: {clone:'pursuit'},
    grabandgo: {clone:'spectralthief'},
    mindcrush: {clone:'punishment'},
    unlockchi: {clone:'storedpower'},
    quillvolley: {clone:'furycutter'},
    spitefulchant: {clone:'dragontail'},
    maleficact: {clone:'chipaway'},
    hexbolt: {clone:'chipaway'},
    neutralize: {clone:'clearsmite'},
    wyrmbeam: {clone:'clearsmite'},
    autumnblast: {clone:'brickbreak'},
    blight: {clone:'brickbreak'},
    hellbrand: {clone:'brickbreak'},
    quakeslam: {clone:'knockoff'},
    disturb: {clone:'knockoff'},
    mindmeld: {clone:'knockoff'},
    wyrmsrage: {custom:'double-if-previous-failed'},
    fanaticism: {custom:'double-if-previous-failed'},
    nebulastrike: {custom:'double-if-previous-failed'},
    wraithpulse: {custom:'boost-if-faster'},
    icydeluge: {custom:'boost-if-faster'},
    radiantlance: {custom:'miss-recoil-gravity-fail'},
    beatdrop: {custom:'miss-recoil-gravity-fail'},
    winterwarning: {clone:'futuresight'},
    deadsilence: {custom:'ban-sound-moves'},
    overflow: {custom:'speed-boost-clear-hazards'},
    heavensknuckle: {custom:'ko-boost'},
    checkmate: {custom:'ko-boost'},
    duneblast: {custom:'ko-boost'},
    chillingblast: {custom:'ko-boost'},
    antimatter: {clone:'clearsmite'},
    sinfulsmite: {clone:'clearsmite'},
    songofsilence: {clone:'clearsmite'},
    cobaltray: {clone:'clearsmite'},
    goldrush: {clone:'clearsmite'},
    vendetta: {clone:'chipaway'},
    refraction: {clone:'chipaway'},
    skydive: {clone:'chipaway'},
    infection: {clone:'hex'},
    hypothermia: {clone:'hex'},
    purge: {clone:'hex'},
    allergy: {clone:'hex'},
    cruelwhip: {clone:'hex'},
    phobia: {clone:'hex'},
    spiritbarrage: {clone:'revenge'},
    rebuke: {clone:'revenge'},
    starsaligned: {clone:'storedpower'},
    boomingbeats: {clone:'storedpower'},
    spaceinvaders: {clone:'beatup'},
    hivemind: {clone:'outrage'},
    determination: {clone:'outrage'},
    stampede: {clone:'outrage'},
    blackhole: {clone:'thousandarrows'},
    icevortex: {clone:'dragontail'},
    karmaspell: {clone:'dragontail'},
    hypertorrent: {clone:'dragontail'},
    waterwhip: {clone:'dragontail'},
    fireball: {clone:'furycutter'},
    clonesurge: {clone:'furycutter'},
    crescendo: {clone:'furycutter'},
    divinevision: {clone:'futuresight'},
    darkomen: {clone:'futuresight'},
    zephyrpurge: {clone:'lastresort'},
    boulderhurl: {clone:'bodypress'},
    shieldbash: {clone:'bodypress'},
    holyward: {custom:'spdef-bodypress'},
    scentedshield: {custom:'spdef-bodypress'},
    soundbarrier: {custom:'spdef-bodypress'},
    powerdrill: {clone:'brickbreak'},
    shatter: {clone:'brickbreak'},
    spoil: {clone:'knockoff'},
    powerwash: {clone:'knockoff'},
    turbulence: {clone:'knockoff'},
    streamrush: {clone:'electroball'},
    parry: {custom:'double-if-ally-fainted'},
    timebomb: {custom:'double-if-ally-fainted'},
    scoresettler: {custom:'double-if-ally-fainted'},
    wail: {custom:'double-if-lowered-this-turn'},
    flatulence: {custom:'double-if-berry-eaten'},
    oberonswrath: {custom:'weaken-as-user-hp-drops'},
    valkyriechariot: {custom:'miss-recoil-gravity-fail'},
    continentalrift: {custom:'ignore-ability-physpec-swap'},
    concoction: {custom:'physpec-swap'},
    bombardment: {custom:'physpec-swap'},
    cleanse: {custom:'defog-plus-remove-screens-terrain'},
    blackout: {custom:'light-damage-reduction-field'},
    schizophrenia: {custom:'boost-highest-lowest'},
    refurbish: {custom:'boost-highest-lowest'},
    repentance: {custom:'bellydrum-spa-hp-cost'},
    stormshield: {custom:'protect-contact-defense-lower'},
    scoresettler: {custom:'double-if-ally-fainted'},
    tidalwave: {custom:'double-vs-submerge'},
};
const chance=(d)=>chanceFromText(d);
const PATTERN_RULES = [
    { name:'multihit', test:(d)=>{if(/two to five|2-5/.test(d))return true;if(/flurry|punches|consecutive|multiple-hit|multi-hit/.test(d)&&/two|three|2|3/.test(d))return true;const m=d.match(/(?:one|two|three|four|five|\d+) times?/);return m&&!/turn/.test(d);}, patch:(d,e)=>{if(/two to five|2-5/.test(d))return{multihit:[2,5],target:pickT(e)};const f=/flurry|three-part/.test(d)?3:2;if(/flurry|punches|consecutive|multiple-hit|multi-hit/.test(d))return{multihit:[f,f],target:pickT(e)};const m=d.match(/(?:one|two|three|four|five|\d+) times?/);if(m&&!/turn/.test(d)){const w={one:1,two:2,three:3,four:4,five:5}[m[0].split(' ')[0]]||parseInt(m[0],10);return{multihit:[w,w],target:pickT(e)};}return null;} },
    { name:'memento', test:(d,e)=>e.category==='Status'&&/user faints/.test(d)&&/harshly lowers|lower.*target/.test(d), patch:(d)=>({target:'normal',category:'Status',basePower:0,selfdestruct:'ifHit',boosts:boostsFrom(d,-1)}) },
    { name:'healing-wish', test:(d,e)=>e.category==='Status'&&/user faints/.test(d)&&/replacement|restored and status/.test(d), patch:()=>({target:'self',category:'Status',basePower:0,selfdestruct:'always'}) },
    { name:'final-gambit', test:(d)=>/user faints/.test(d)&&/deals damage equal to|equal to.*hp/i.test(d), patch:(e)=>({target:pickT(e),category:'Physical',basePower:1,selfdestruct:'ifHit'}) },
    { name:'protection', test:(d,e)=>e.category==='Status'&&/protects? the user|prevent.*attacks|blocks? attacks? aimed|guard.*from damage|immune to.*attacks/.test(d), patch:()=>({target:'self',custom:'protect-family'}) },
    { name:'weather', test:(d,e)=>e.category==='Status'&&/\b(sun(?:light|ny)?|rain|sandstorm|hail|snow|eclipse)\b/.test(d)&&/weather|summons|intensif|causes|starts/.test(d), patch:(d)=>({target:'field',weather:/\beclipse\b/.test(d)?'eclipse':/\bsun|sunny/.test(d)?'sunnyday':/\brain/.test(d)?'raindance':/\bsand/.test(d)?'sandstorm':'snowscape'}) },
    { name:'terrain', test:(d,e)=>e.category==='Status'&&/\bterrain\b/.test(d), patch:(d)=>({target:'field',terrain:/electric/.test(d)?'electricterrain':/grassy|meadow/.test(d)?'grassyterrain':/misty/.test(d)?'mistyterrain':/psychic/.test(d)?'psychicterrain':null}) },
    { name:'hazard', test:(d,e)=>e.category==='Status'&&/(spikes|stealth rock|toxic spikes|sticky web|calaminon)/i.test(d)&&/field|side|enemy|scatters|lays|sets/.test(d), patch:(d)=>({target:'foeSide',hazard:/toxic spikes/i.test(d)?'toxicspikes':/sticky web/i.test(d)?'stickyweb':/stealth rock/i.test(d)?'stealthrock':/calaminon/i.test(d)?'calaminon':'spikes'}) },
    { name:'heal-self-half', test:(d,e)=>e.category==='Status'&&/restores?.*hp by (?:half|50%)/.test(d)&&!/damage taken/.test(d), patch:()=>({target:'self',heal:[1,2],flags:{heal:1}}) },
    { name:'drain-half-damage', test:(d)=>/restored by half the damage taken|restores.*hp equal to half the damage/.test(d), patch:(d,e)=>({target:pickT(e),drain:[1,2]}) },
    { name:'drain-percent', test:(d)=>/drains?.*hp|steals?.*hp/.test(d)&&/%/.test(d), patch:(d,e)=>{const m=d.match(/(\d{1,2})%/);const f=m?percentFraction(parseInt(m[1],10)):0.5;return{target:pickT(e),drain:[Math.round(f*100),100]};} },
    { name:'wish-heal', test:(d,e)=>e.category==='Status'&&/one turn after this move/.test(d)&&/restored by half/.test(d), patch:()=>({target:'self',custom:'wish'}) },
    { name:'status-cure-heal', test:(d,e)=>e.category==='Status'&&/heals? the target's status|cure.*status/.test(d)&&/restores?.*own/.test(d), patch:()=>({target:'normal',custom:'purify'}) },
    { name:'heal-party', test:(d,e)=>e.category==='Status'&&/heals?.*(?:all|party|team).*(?:pokémon|member)/.test(d), patch:()=>({target:'self',custom:'heal-party-status'}) },
    { name:'recoil', test:(d)=>/takes?.*recoil|recoils?/.test(d)&&/(?:1\/3|1\/2|1\/4|a third|a quarter)/.test(d), patch:(d,e)=>{const f=/1\/3|a third/.test(d)?[1,3]:/1\/2/.test(d)?[1,2]:[1,4];return{target:pickT(e),recoil:f};} },
    { name:'burn-chance', test:(d)=>/(\d{1,2})% chance to burn/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'brn',chance:chance(d)}}) },
    { name:'paralyze-chance', test:(d)=>/(\d{1,2})% chance to paral[yi]|paral[yi]z(e|es|ing)/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'par',chance:chance(d)}}) },
    { name:'poison-chance', test:(d)=>/(\d{1,2})% chance to poison/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'psn',chance:chance(d)}}) },
    { name:'freeze-chance', test:(d)=>/(\d{1,2})% chance to freez|frozen solid/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'frz',chance:chance(d)}}) },
    { name:'sleep-status', test:(d,e)=>e.category==='Status'&&/target falls asleep|puts?.*to sleep/.test(d), patch:()=>({target:'normal',status:'slp'}) },
    { name:'confuse-status', test:(d,e)=>e.category==='Status'&&/confuses?|bewilders?/.test(d)&&!/chance/.test(d), patch:()=>({target:'normal',volatileStatus:'confusion'}) },
    { name:'flinch-only', test:(d)=>/flinches?.*but only works on the first turn/.test(d), patch:()=>({target:'normal',volatileStatus:'flinch'}) },
    { name:'charge-attack', test:(d)=>/charges?.*on the.*turn|charges? instantly|two.turn attack/i.test(d)&&!/submerge|diving|first turn.*dive/.test(d), patch:(d,e)=>({target:pickT(e),chargeMove:true,custom:'solarbeam-family'}) },
    { name:'two-turn-dive', test:(d)=>/diving|becomes? hidden|first turn.*dive|next turn/.test(d)&&/then hits|next turn/.test(d), patch:(d,e)=>({target:pickT(e),chargeMove:true,custom:'two-turn-semivulnerable'}) },
    { name:'switch-forcer', test:(d)=>/forces?.*to switch|forced to switch/.test(d), patch:()=>({target:'normal',forceSwitch:true}) },
    { name:'trap', test:(d)=>/traps?\b|trapp(?:ed|ing)|prevent.*escape|cannot escape|canno(t|')? escape/.test(d), patch:()=>({target:'normal',volatileStatus:'trapped'}) },
    { name:'damage-flinch', test:(d)=>/(\d{1,2})% chance to flinch/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{volatileStatus:'flinch',chance:chance(d)}}) },
    { name:'damage-burn', test:(d)=>/(\d{1,2})% chance to (?:burn|ignite)/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'brn',chance:chance(d)}}) },
    { name:'damage-paralyze', test:(d)=>/(\d{1,2})% chance to paral[yi]/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'par',chance:chance(d)}}) },
    { name:'damage-poison', test:(d)=>/(\d{1,2})% chance to poison/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'psn',chance:chance(d)}}) },
    { name:'damage-confuse', test:(d)=>/(\d{1,2})% chance to confuse/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{volatileStatus:'confusion',chance:chance(d)}}) },
    { name:'damage-freeze', test:(d)=>/(\d{1,2})% chance to freez/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{status:'frz',chance:chance(d)}}) },
    { name:'damage-boost-self', test:(d)=>/(\d{1,2})% chance to raise.*(?:user|its|their) /.test(d), patch:(d,e)=>({target:pickT(e),secondary:{self:{boosts:boostsFrom(d,1)},chance:chance(d)}}) },
    { name:'damage-lower-target', test:(d)=>/(\d{1,2})% chance to lower.*target's /.test(d), patch:(d,e)=>({target:pickT(e),secondary:{boosts:boostsFrom(d,-1),chance:chance(d)}}) },
    { name:'always-boost-self', test:(d,e)=>e.basePower>0&&/always raises?|raises?.*by \d stage.*attack|raises? its (?:atk|spa|spe|spd|def)/.test(d)&&!/chance/.test(d), patch:(d,e)=>({target:pickT(e),self:{boosts:boostsFrom(d,1)}}) },
    { name:'status-boost-self', test:(d,e)=>e.category==='Status'&&/raises?.*(?:user|its|their|it's) (?!target)/.test(d)&&/by \d stage|sharply|harshly/.test(d), patch:(d)=>({target:'self',boosts:boostsFrom(d,1)}) },
    { name:'status-boost-ally', test:(d,e)=>e.category==='Status'&&/raises?.*(?:ally|allies|team)/.test(d), patch:(d)=>({target:'allies',boosts:boostsFrom(d,1)}) },
    { name:'status-lower-target', test:(d,e)=>e.category==='Status'&&/lowers?.*target's/.test(d), patch:(d)=>({target:'normal',boosts:boostsFrom(d,-1)}) },
    { name:'ohko', test:(d)=>/one-hit|ohko|instantly ko|knocks out the target/.test(d), patch:(e)=>({target:pickT(e),ohko:true,custom:'ohko'}) },
    { name:'fixed-damage-weight', test:(d)=>/heavier the|weight.*greater|curbstomp|heat crash|grass knot|low kick|heavy slam/.test(d), patch:(e)=>({target:pickT(e),weightPower:true,custom:'heatcrash-family'}) },
    { name:'drain-half-alt', test:(d)=>/hp is restored by half (?:of )?(?:the )?damage (?:dealt|done|taken)|half (?:of )?(?:the )?damage.*(?:restored|healed)/.test(d), patch:(d,e)=>({target:pickT(e),drain:[1,2]}) },
    { name:'cure-status-self', test:(d,e)=>e.category==='Status'&&/cure[sd]?(?: the)? status|cures? non[- ]volatile|remove(?:s|ing)? impurities/.test(d)&&!/target/.test(d), patch:()=>({target:'self',custom:'cure-status'}) },
    { name:'heal-party-status', test:(d,e)=>e.category==='Status'&&/heals? (?:all|the) (?:party|team) (?:pok.{1,3}on|member)|heals? their side|restoring their side/.test(d), patch:()=>({target:'allies',custom:'heal-party-status'}) },
    { name:'heal-25-percent', test:(d,e)=>e.category==='Status'&&/(?:restoring|restores?).*hp for 25%|heals? their side's? hp|restores? their side's? hp/.test(d), patch:()=>({target:'allies',heal:[1,4],custom:'heal-bell-plus'}) },
    { name:'type-change', test:(d,e)=>e.category==='Status'&&/becomes? (?:a |the )?(?:\w+)[- ]?type|changes? the target's type/.test(d), patch:(d)=>{const m=d.match(/becomes? (?:a |the )?(\w+)[- ]?type/);return{target:'normal',custom:'type-change',newType:m?m[1].charAt(0).toUpperCase()+m[1].slice(1):null};} },
    { name:'frostbite', test:(d,e)=>e.category==='Status'&&/frostbit/.test(d), patch:()=>({target:'normal',status:'frb',custom:'frostbite'}) },
    { name:'burn-status', test:(d,e)=>e.category==='Status'&&/inflict(?:s|ing)? a burn|burn the target/.test(d)&&!/chance/.test(d), patch:()=>({target:'normal',status:'brn'}) },
    { name:'poison-status', test:(d,e)=>e.category==='Status'&&/poison(?:s|ing)? the target|contaminated.*poison/.test(d)&&!/chance/.test(d), patch:()=>({target:'normal',status:'psn'}) },
    { name:'crit-boost', test:(d,e)=>e.basePower>0&&/\+1 crit(?:ical)?(?: hit)? rate|\+1 crit ratio/.test(d), patch:(d,e)=>({target:pickT(e),critRatio:2}) },
    { name:'spread-move', test:(d,e)=>e.basePower>0&&/hits? (?:all|every|both) (?:adjacent )?(?:foe|opponent|enemy|pok.{1,3}on|targets?)|strikes? every|around it|hits? everyone/.test(d), patch:(d,e)=>({target:'allAdjacentFoes'}) },
    { name:'cant-miss', test:(d,e)=>e.basePower>0&&/(?:hits? without fail|never miss(?:es)?|always hits?|cannot miss|sure to hit|certain to hit)/.test(d), patch:(d,e)=>({target:pickT(e),accuracy:true}) },
    { name:'self-boost-two-stat', test:(d,e)=>e.category==='Status'&&statPair(d).length>=2&&/rais|boost/.test(d)&&!/target|foe|opponent|enemy/.test(d)&&!/weather|terrain/.test(d), patch:(d)=>({target:'self',boosts:/lower|reduc|shatter/.test(d)?signedBoosts(d):boostsFrom(d,1)}) },
    { name:'guaranteed-lower-target', test:(d,e)=>e.basePower>0&&/always lowers|harshly lowers/.test(d), patch:(d,e)=>({target:pickT(e),boosts:boostsFrom(d,-1)}) },
    { name:'status-lower-both', test:(d,e)=>e.category==='Status'&&/lowering their|lowers? their|reducing their/.test(d), patch:(d)=>({target:'normal',boosts:boostsFrom(d,-1)}) },
    { name:'random-status', test:(d,e)=>e.category==='Status'&&/random status condition/.test(d), patch:()=>({target:'normal',custom:'random-status'}) },
    { name:'stat-swap', test:(d,e)=>e.category==='Status'&&/switch.*stat changes|swaps? (?:its |their )?(?:stat|boosts)/.test(d), patch:()=>({target:'normal',custom:'stat-swap'}) },
    { name:'pivot', test:(d,e)=>e.basePower>0&&/runs? back|switch places with|hit.and.run|then switches/.test(d), patch:(d,e)=>({target:pickT(e),selfSwitch:true}) },
    { name:'lowers-two-stats', test:(d,e)=>e.basePower===0&&/lowering their|lowers? (?:the )?target(?:'s)?.*and/.test(d), patch:(d)=>({target:'normal',boosts:boostsFrom(d,-1)}) },
    // --- broad catch-alls (evaluated last; merge semantics in inferMoveIntent) ---
    { name:'status-boost-broad', test:(d,e)=>e.category==='Status'&&statPair(d).length>0&&/rais|increas|boost|maximi/.test(d)&&!/target|foe|opponent|enemy/.test(d)&&!/weather|terrain|field/.test(d), patch:(d)=>({target:'self',boosts:/lower|reduc|shatter/.test(d)?signedBoosts(d):boostsFrom(d,1)}) },
    { name:'status-lower-broad', test:(d,e)=>e.category==='Status'&&statPair(d).length>0&&/lower|reduc|harsh|cut/.test(d)&&/target|foe|opponent|enemy/.test(d), patch:(d)=>({target:'normal',boosts:signedBoosts(d)}) },
    { name:'status-heal-broad', test:(d,e)=>e.category==='Status'&&/restores? (?:its|their|the user's) own hp|heals? (?:it|them|their)s?elf|heals? (?:the )?user\b|restores? half of (?:its|their) max hp/.test(d), patch:()=>({target:'self',heal:[1,2],flags:{heal:1}}) },
    { name:'status-sleep-broad', test:(d,e)=>e.category==='Status'&&/fall(?:s)? asleep|puts?.*to sleep/.test(d), patch:()=>({target:'normal',status:'slp'}) },
    { name:'attack-chance-status-broad', test:(d,e)=>e.basePower>0&&/\d{1,3}\s?% chance to (?:cause |inflict |induce )?(?:the target to )?(?:the target )?(burn|paraly\w*|poison\w*|freez\w*|frostbit\w*|confus\w*|flinch|sleep|frozen|fall asleep)/.test(d), patch:(d,e)=>{const m=d.match(/% chance to (?:cause |inflict |induce )?(?:the target to )?(?:the target )?(burn|paraly\w*|poison\w*|freez\w*|frostbit\w*|confus\w*|flinch|sleep|frozen|fall asleep)/);const w=m[1];const st=/burn/.test(w)?'brn':/paraly/.test(w)?'par':/poison/.test(w)?'psn':/frostbit/.test(w)?'frb':/freez|frozen/.test(w)?'frz':/confus/.test(w)?'conf':/flinch/.test(w)?'flinch':'slp';const sec=(st==='conf'||st==='flinch')?{volatileStatus:st==='conf'?'confusion':'flinch',chance:chance(d)}:{status:st,chance:chance(d)};return{target:pickT(e),secondary:sec};} },
    { name:'attack-chance-self-stat', test:(d,e)=>e.basePower>0&&/\d{1,3}\s?% chance to (?:rais\w*|increas\w*|boost\w*) (?:sp\.?\s*atk|sp\.?\s*def|atk|attack|defen\w*|speed|spe)/.test(d)&&/user|its|their/.test(d), patch:(d,e)=>({target:pickT(e),secondary:{self:{boosts:boostsFrom(d,1)},chance:chance(d)}}) },
    { name:'attack-self-lower-broad', test:(d,e)=>e.basePower>0&&/reduc\w* (?:the |its )?user's|lower\w* (?:the |its |their )?(?:own )?user's|lowers? (?:its|their) own|(?:lowers?|reduc\w*|cuts?)[^.]*?of the user|harshly reduc\w* (?:its own|the user|user)/.test(d), patch:(d,e)=>{const tmp=d.replace(/\bsp\./g,'sp_');const clauses=tmp.split(/ but | then | however |; |\. /).map(s=>s.replace(/sp_/g,'sp.'));const c=clauses.find(x=>/reduc\w* (?:the |its )?user's|lower\w* (?:the )?user's|lowers? (?:its|their) own|(?:lowers?|reduc\w*|cuts?)[^.]*?of the user/.test(x))||d;const b=signedBoosts(c);return{target:pickT(e),self:{boosts:Object.keys(b).length?b:signedBoosts(d)}};} },
    { name:'attack-lower-target-broad', test:(d,e)=>e.basePower>0&&/lowers?|reduc/.test(d)&&/target|foe|opponent|enemy|their/.test(d)&&!/chance/.test(d)&&!/(?:lower|reduc)\w* (?:the |its |their )?(?:user's|own)/.test(d), patch:(d,e)=>({target:pickT(e),boosts:signedBoosts(d)}) },
    { name:'attack-self-boost-guaranteed', test:(d,e)=>e.basePower>0&&/raises? (?:the |their |its )?(?:own )?user's|raises? its (?:own )?(?:atk|attack|sp\.?\s*atk|def|speed)|raises? their (?:atk|attack|sp\.?\s*atk|sp\.?\s*def|defen\w*|speed|spe)|raises? (?:its|their) (?:speed|atk|attack|sp\.?\s*atk)|raises? (?:speed|spe|atk|attack|defen[cs]e|sp\.?\s*atk)\b/.test(d)&&!/chance/.test(d)&&!/rais\w* (?:the )?target/.test(d), patch:(d,e)=>({target:pickT(e),self:{boosts:boostsFrom(d,1)}}) },
    { name:'attack-drain-broad', test:(d,e)=>e.basePower>0&&/drains?\w*|hp (?:is )?restored by|restoring (?:the user's |their |its )?hp|restoring half of damage/.test(d), patch:(d,e)=>({target:pickT(e),drain:[1,2]}) },
    { name:'strike-first', test:(d)=>/sure to strike first|strike first\b|sure to attack first/.test(d)&&!/fails? if/.test(d), patch:(d,e)=>({target:pickT(e),priority:1}) },
    { name:'priority-phrase', test:(d,e)=>e.basePower>0&&/strikes? with priority|in priority\b|always goes first|goes first\b|with a priority spell/.test(d)&&!/fails? if/.test(d), patch:(d,e)=>({target:pickT(e),priority:1}) },
    { name:'numeric-priority', test:(d)=>/[+\-]?\d\s+priority/.test(d), patch:(d,e)=>{const m=d.match(/([+\-]?\d)\s+priority/);return{target:pickT(e),priority:parseInt(m[1],10)};} },
    { name:'recoil-percent', test:(d)=>/\d{1,3}\s?% recoil/.test(d), patch:(d,e)=>{const m=d.match(/(\d{1,3})\s?% recoil/);return{target:pickT(e),recoil:[parseInt(m[1],10),100]};} },
    { name:'chance-raise-self-broad', test:(d,e)=>e.basePower>0&&/\d{1,3}\s?% chance to (?:rais\w*|increas\w*|boost\w*)/.test(d)&&!/chance to (?:lower|reduc|cut|drop|cause|inflict|induce|burn|paraly|poison|freez|frostbit|confus|flinch|sleep)/.test(d), patch:(d,e)=>{let b;if(/all (?:the )?user's stats|all (?:of )?(?:its|their) stats/.test(d)){b={atk:1,def:1,spa:1,spd:1,spe:1};}else{const st=statPair(d);b={};for(const s of st)b[s]=1;}return{target:pickT(e),secondary:{self:{boosts:b},chance:chance(d)}};} },
    { name:'chance-lower-target-broad', test:(d,e)=>e.basePower>0&&/\d{1,3}\s?% chance (?:to )?(?:lower|reduc|cut|drop)/.test(d), patch:(d,e)=>{const st=statPair(d);const b={};for(const s of st)b[s]=-1;return{target:pickT(e),secondary:{boosts:b,chance:chance(d)}};} },
    { name:'guaranteed-status-on-hit', test:(d,e)=>e.basePower>0&&/leaves? the target (?:with |poisoned|burned)|burns? the target|poisons? the target|always confuses|confuses? the target if it hits|cause frostbite/.test(d), patch:(d,e)=>{const st=/poison/.test(d)?'psn':/burn/.test(d)?'brn':/frostbit/.test(d)?'frb':/paraly/.test(d)?'par':'conf';return{target:pickT(e),secondary:st==='conf'?{volatileStatus:'confusion',chance:100}:{status:st,chance:100}};} },
    { name:'ability-negate', test:(d,e)=>/negate(?:s|d|ing)? the (?:effect of their )?ability|negate the ability of those hit/.test(d), patch:(d,e)=>({target:pickT(e),volatileStatus:'gastroacid'}) },
    { name:'always-crit', test:(d,e)=>e.basePower>0&&/always (?:results in )?a critical hit|always critical/.test(d), patch:(d,e)=>({target:pickT(e),willCrit:true}) },
    { name:'se-vs-type', test:(d,e)=>e.basePower>0&&/(?:super effective|se\b) (?:on|against) (\w+?)(?:[- ]types?| types?|\.|,|$)/.test(d), patch:(d,e)=>{const m=d.match(/(?:super effective|se\b) (?:on|against) (\w+?)(?:[- ]types?| types?|\.|,|$)/);const t=m?m[1].charAt(0).toUpperCase()+m[1].slice(1):null;return{target:pickT(e),seAgainst:t};} },
    { name:'spread-enemy-side', test:(d,e)=>e.basePower>0&&/(?:enemy|foes?)'?s? side of the field|nearby foes|hits? the enemies|hits the enemy side|all others in (?:their|its) path/.test(d), patch:(d,e)=>({target:'allAdjacentFoes'}) },
    { name:'spread-everyone', test:(d,e)=>e.basePower>0&&/everyone on the field|hitting everyone|all pok.{1,3}mon on the field|harming both sides/.test(d), patch:(d,e)=>({target:'allAdjacent'}) },
    { name:'pivot-switches-places', test:(d,e)=>e.basePower>0&&/switch(?:es)? (?:places|out)/.test(d), patch:(d,e)=>({target:pickT(e),selfSwitch:true}) },
];
export function inferMoveIntent(id, entry, pristine) {
    const cls = classifyMove(id, entry, pristine);
    if (cls !== 'new') return { class: cls, patch: null };
    const desc = String(entry.desc || '').toLowerCase();
    const overrides = globalThis.__SS2_OVERRIDES__ || {};
    if (overrides[id]) return { class: cls, patch: { ...overrides[id], _override: true }, rule: 'explicit-override' };
    if (ENGINE_BESPOKE[id]) return { class: cls, patch: { custom: 'engine-bespoke' }, rule: 'engine-bespoke:' + (ENGINE_BESPOKE[id].clone || ENGINE_BESPOKE[id].custom || '') };
    // Merge semantics: every matching rule contributes; FIRST rule wins per key so
    // precise rules dominate and multi-effect moves (e.g. priority+recoil) combine.
    const merged = {};
    const matched = [];
    for (const rule of PATTERN_RULES) {
        if (!rule.test(desc, entry)) continue;
        const patch = rule.patch(desc, entry);
        if (!patch) continue;
        matched.push(rule.name);
        for (const [k, v] of Object.entries(patch)) if (!(k in merged)) merged[k] = v;
    }
    if (matched.length) return { class: cls, patch: merged, rule: matched.join('+') };
    return { class: cls, patch: null, rule: 'unmatched' };
}
export function inferAllMoves(ss2Moves, pristine) {
    const out = {};
    for (const [id, entry] of Object.entries(ss2Moves)) out[id] = inferMoveIntent(id, entry, pristine);
    return out;
}

