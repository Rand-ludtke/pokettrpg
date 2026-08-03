// RogueModeGame.tsx -- pokerogue-style dungeon-crawl mode using SoulStone zones.
// Integrates with loadShowdownDex() from adapter for soulstone pokemon pool data.
// Includes: types, type effectiveness chart (from PathwaysArena + SoulStone), move DB,
// procedural encounter generation, battle engine, XP/leveling, floor-based progression,
// gym-leader-type bosses every 5 floors, final boss at floor 31, and full UI with sidebar-style layout.

import React, { useState, useEffect, useCallback } from 'react';
import { loadShowdownDex } from '../data/adapter';

// ──────────────────────────────── TYPES ─────────────────────────────────────

interface BattleMon {
  speciesKey: string;
  displayName: string;
  types: string[];
  level: number;
  currentHp: number;
  maxHp: number;
  baseAtk: number;
  baseDef: number;
  baseSpa: number;
  baseSpd: number;
  baseSpe: number;
  moves: string[];
}
interface LogEntry { msg: string; type: 'action'|'damage'|'heal'|'win'|'lose'|'system'|'item'; }
type GamePhase = 'main_menu'|'exploring'|'battle'|'victory'|'game_over';
type ZoneType  = 'Crystal'|'Cosmic'|'Nuclear'|'Stellar'|'Light'|'Sound';

interface ZoneInfo { name: string; type: ZoneType; floorStart:number; floorEnd:number; zoneColor:string; }

// ──────────────────────── CONSTANTS ─────────────────────────────────────────

const SOULSTONE_TYPES: ZoneType[] = ['Crystal','Cosmic','Nuclear','Stellar','Light','Sound'];

const ZONES: ZoneInfo[] = [
  { name:'Crystal Crags',      type:'Crystal', floorStart:1,  floorEnd:5,  zoneColor:'#a0d2eb' },
  { name:'Cosmic Chasm',       type:'Cosmic',  floorStart:6,  floorEnd:10, zoneColor:'#c491e9' },
  { name:'Nuclear Wastes',     type:'Nuclear', floorStart:11, floorEnd:15, zoneColor:'#4caf50' },
  { name:'Stellar Depths',     type:'Stellar', floorStart:16, floorEnd:20, zoneColor:'#fbc531' },
  { name:'Light Sanctum',      type:'Light',   floorStart:21, floorEnd:25, zoneColor:'#fffacd' },
  { name:'Sound Caverns',      type:'Sound',   floorStart:26, floorEnd:30, zoneColor:'#ff66aa' },
];

const FINAL_BOSS_FLOOR = 31;

const TYPE_COLORS: Record<string,string> = {
  Normal:'#a8a77a',Fire:'#ee8130',Water:'#6390f0',Electric:'#f7d02c',Grass:'#7ac74c',Ice:'#96d9d6',
  Fighting:'#c22e28',Poison:'#a33ea1',Ground:'#e2bf51',Flying:'#a98ff3',Psychic:'#f95587',Bug:'#a6b91a',
  Rock:'#b6a136',Ghost:'#735797',Dragon:'#6f35fc',Dark:'#705746',Steel:'#b7b7ce',Fairy:'#d685ad',
  Crystal:'#a0d2eb',Cosmic:'#c491e9',Nuclear:'#4caf50',Stellar:'#fbc531',Sound:'#ff66aa',Light:'#fffacd',
};

// ──────────── TYPE EFFECTIVENESS CHART (from + beside PathwaysArena) ─────────

const TYPE_CHART: Record<string, Partial<Record<string,number>>> = {
  Normal:{Rock:0.5,Ghost:0,Steel:0.5}, Fire:{Fire:0.5,Water:0.5,Grass:2,Ice:2,Bug:2,Rock:0.5,Dragon:0.5,Steel:2},
  Water:{Fire:2,Water:0.5,Grass:0.5,Ground:2,Rock:2,Dragon:0.5}, Electric:{Water:2,Electric:0.5,Grass:0.5,Ground:0,Flying:2,Dragon:0.5},
  Grass:{Fire:0.5,Water:2,Grass:0.5,Poison:0.5,Ground:2,Flying:0.5,Bug:0.5,Rock:2,Dragon:0.5,Steel:0.5},
  Ice:{Fire:0.5,Water:0.5,Grass:2,Ice:0.5,Ground:2,Flying:2,Dragon:2,Steel:0.5},
  Fighting:{Normal:2,Ice:2,Rock:2,Dark:2,Steel:2,Poison:0.5,Flying:0.5,Psychic:0.5,Bug:0.5,Ghost:0,Fairy:0.5},
  Poison:{Grass:2,Poison:0.5,Ground:0.5,Rock:0.5,Ghost:0.5,Steel:0,Fairy:2},
  Ground:{Fire:2,Electric:2,Grass:0.5,Poison:2,Flying:0,Bug:0.5,Rock:2,Steel:2},
  Flying:{Electric:0.5,Grass:2,Fighting:2,Bug:2,Rock:0.5,Steel:0.5},
  Psychic:{Fighting:2,Poison:2,Psychic:0.5,Dark:0}, Bug:{Fire:0.5,Grass:2,Fighting:0.5,Poison:0.5,Flying:0.5,Psychic:2,Ghost:0.5,Dark:2,Steel:0.5,Fairy:0.5},
  Rock:{Fire:2,Ice:2,Fighting:0.5,Ground:0.5,Flying:2,Bug:2,Steel:0.5}, Ghost:{Normal:0,Psychic:2,Ghost:2,Dark:0.5},
  Dragon:{Dragon:2,Steel:0.5,Fairy:0}, Dark:{Fighting:0.5,Psychic:2,Ghost:2,Dark:0.5,Fairy:0.5},
  Steel:{Fire:0.5,Water:0.5,Electric:0.5,Ice:2,Rock:2,Steel:0.5,Fairy:2}, Fairy:{Fire:0.5,Fighting:2,Poison:0.5,Dragon:2,Dark:2,Steel:0.5},
  // SoulStone types
  Crystal:{Fire:0.5,Water:2,Ice:0.5,Psychic:1.5,Rock:1.2}, Cosmic:{Psychic:2,Dragon:2,Dark:0.5,Steel:1.5},
  Nuclear:{Electric:2,Poison:2,Steel:1,Ghost:1.5,Normal:1.5}, Stellar:{Ghost:2,Dark:2,Fire:0.5,Water:0.5},
  Sound:{Psychic:2,Flying:2,Dark:1.5,Ice:0.5}, Light:{Dark:3,Steel:0.5,Psychic:1.5,Ghost:1.5},
};

function getEffectiveness(attackerType:string, defenderTypes:string[]): number {
  let mult=1; const c=TYPE_CHART[attackerType];
  for (const dt of defenderTypes) mult*=((c&&c[dt])??1); return mult;
}

// ──────────────── MOVE DATABASE ─────────────────────────────────────────────

interface MoveDef { power:number; type:string; pp:number; category:'physical'|'special'|'status'; }
const MOVES_DB: Record<string,MoveDef> = {
  Tackle:{power:40,type:'Normal',pp:35,category:'physical'}, Scratch:{power:40,type:'Normal',pp:35,category:'physical'},
  Headbutt:{power:70,type:'Normal',pp:15,category:'physical'}, QuickAttack:{power:40,type:'Normal',pp:30,category:'physical'},
  ShadowStrike:{power:70,type:'Dark',pp:15,category:'physical'}, BodySlam:{power:85,type:'Normal',pp:15,category:'physical'},
  ThunderPunch:{power:75,type:'Electric',pp:15,category:'physical'}, IcePunch:{power:75,type:'Ice',pp:15,category:'physical'},
  FirePunch:{power:75,type:'Fire',pp:15,category:'physical'}, DragonClaw:{power:80,type:'Dragon',pp:15,category:'physical'},
  DarkPulse:{power:80,type:'Dark',pp:15,category:'special'}, IronTail:{power:100,type:'Steel',pp:15,category:'physical'},
  Ember:{power:40,type:'Fire',pp:25,category:'special'}, WaterGun:{power:40,type:'Water',pp:25,category:'special'},
  VineWhip:{power:45,type:'Grass',pp:25,category:'physical'}, ThunderShock:{power:40,type:'Electric',pp:30,category:'special'},
  Thunderbolt:{power:90,type:'Electric',pp:15,category:'special'}, Flamethrower:{power:90,type:'Fire',pp:15,category:'special'},
  HydroPump:{power:110,type:'Water',pp:5,category:'special'}, SolarBeam:{power:120,type:'Grass',pp:5,category:'special'},
  Psychic:{power:90,type:'Psychic',pp:10,category:'special'}, ShadowBall:{power:80,type:'Ghost',pp:15,category:'special'},
  AuraSphere:{power:80,type:'Fighting',pp:20,category:'special'}, Moonblast:{power:95,type:'Fairy',pp:15,category:'special'},
  FreezeDry:{power:70,type:'Ice',pp:20,category:'special'},
  // SoulStone special moves
  CrystalRay:{power:85,type:'Crystal',pp:10,category:'special'}, PrismShot:{power:95,type:'Crystal',pp:5,category:'special'},
  CosmicBeam:{power:90,type:'Cosmic',pp:10,category:'special'}, Stardust:{power:75,type:'Cosmic',pp:15,category:'special'},
  NuclearBlast:{power:95,type:'Nuclear',pp:8,category:'special'}, RadiationWave:{power:80,type:'Nuclear',pp:12,category:'special'},
  StellarBeam:{power:90,type:'Stellar',pp:10,category:'special'}, CometPunch:{power:65,type:'Stellar',pp:18,category:'physical'},
  LightBeam:{power:90,type:'Light',pp:10,category:'special'}, RadiantPulse:{power:75,type:'Light',pp:14,category:'special'},
  SoundWave:{power:80,type:'Sound',pp:12,category:'special'}, EchoBlade:{power:70,type:'Sound',pp:16,category:'physical'},
  // Status
  Recover:{power:0,type:'Normal',pp:10,category:'status'},
};

function movePoolForZone(z: ZoneType): string[] {
  switch(z) {
    case 'Crystal':   return ['Tackle','CrystalRay','HydroPump','Recover'];
    case 'Cosmic':    return ['CosmicBeam','Psychic','ThunderShock','Stardust'];
    case 'Nuclear':   return ['NuclearBlast','RadiationWave','Thunderbolt','Flamethrower'];
    case 'Stellar':   return ['StellarBeam','CometPunch','DragonClaw','ShadowBall'];
    case 'Light':     return ['LightBeam','RadiantPulse','AuraSphere','Moonblast'];
    case 'Sound':     return ['SoundWave','EchoBlade','DarkPulse','ShadowStrike'];
  }
}

// ──────── PROCEDURAL encounter / boss generation ────────────────────────────

function zoneTypeOptions(z: ZoneType): string[][] {
  switch(z) {
    case'Crystal': return[['Crystal','Water'],['Crystal','Ice'],['Water','Ice']];
    case'Cosmic':  return[['Cosmic','Psychic'],['Cosmic','Dragon'],['Psychic','Dragon']];
    case'Nuclear': return[['Nuclear','Electric'],['Nuclear','Poison'],['Electric','Poison']];
    case'Stellar': return[['Stellar','Ghost'],['Stellar','Dark'],['Ghost','Dark']];
    case'Light':   return[['Light','Fairy'],['Light','Psychic'],['Fairy','Psychic']];
    case'Sound':   return[['Sound','Flying'],['Sound','Dark'],['Sound','Ice']];
  }
}

function calcMaxHp(baseHp:number, level:number, isBoss=false): number {
  const b=isBoss?1.8:1; return Math.floor((baseHp*level/50+10+level)*b);
}

function createBattleMon(zoneType:ZoneType, level:number, isBoss=false): BattleMon {
  const tOpts=zoneTypeOptions(zoneType);
  const chosen=tOpts[Math.floor(Math.random()*tOpts.length)];
  const bonus=isBoss?12:0;
  return {
    speciesKey:`rog-${zoneType}-${isBoss?'boss-':'r '}${Math.random().toString(36).slice(2,7)}`,
    displayName:`${zoneType} #${level}`, types:chosen, level,
    maxHp:calcMaxHp(40+Math.floor(Math.random()*30),level,isBoss||false), currentHp:0,
    baseAtk: Math.floor((15+Math.random()*50+bonus)*level/45),
    baseDef: Math.floor((15+Math.random()*35+bonus*0.7)*level/45),
    baseSpa: Math.floor((20+Math.random()*40+bonus)*level/45),
    baseSpd: Math.floor((10+Math.random()*30+bonus*0.5)*level/45),
    baseSpe: Math.floor((10+Math.random()*40+bonus*0.6)*level/45),
    moves: isBoss?movePoolForZone(zoneType):['Tackle','QuickAttack'],
  };
}

function execMove(attacker:BattleMon, defenderTypes:string[], moveName:string): {damage:number;label:string;miss:boolean} {
  const mv=MOVES_DB[moveName]; if(!mv) return{damage:0,label:'',miss:false};
  const eff=getEffectiveness(mv.type,defenderTypes);
  let label:string;
  if(eff>1)       label=`✨${Math.round(eff*100)}%`;
  else if(eff===0) label='🚫 No Effect!';
  else if(eff<1)   label='🛡️ not very effective…';
  else              label='';
  if(Math.random()<0.1) return{damage:0,label:'💨 Missed!',miss:true};
  const atkSt=mv.category==='physical'?attacker.baseAtk:attacker.baseSpa;
  const defSt=Math.max(attacker.baseDef*0.8,1);
  const baseDmg=((2*attacker.level/5+2)*mv.power*atkSt/(defSt*50))+2;
  return{damage:Math.max(1,Math.floor(baseDmg*eff)),label,miss:false};
}

// ──────────────────────── STARTER DATA ──────────────────────────────────────

const STARTERS = [
  {name:'Charmander',types:['Fire'],baseHp:39,atk:52,def:43,spa:60,spd:50,spe:65},
  {name:'Squirtle',  types:['Water'],baseHp:44,atk:48,def:65,spa:50,spd:64,spe:43},
  {name:'Bulbasaur', types:['Grass','Poison'],baseHp:45,atk:49,def:49,spa:65,spd:65,spe:45},
];
const STARTER_MOVES: Record<string,string[]> = {
  Charmander:['Ember','QuickAttack','Scratch'], Squirtle:['WaterGun','QuickAttack','Tackle'], Bulbasaur:['VineWhip','QuickAttack','Tackle'],
};

// ════════════════════ BATTLE SCREEN SUB-COMPONENT ═════════════════════════

interface BattleScreenProps {
  team:BattleMon[]; enemies:BattleMon[]; log:LogEntry[]; onUseMove:(m:string)=>void;
}
const BattleScreen: React.FC<BattleScreenProps> = ({team,enemies,log,onUseMove}) => {
  const finished=log.some(l=>l.type==='win'||l.type==='lose');

  return(
    <div style={{padding:20,background:'#1a1a2e',color:'#fff',borderRadius:10,fontFamily:'Arial,sans-serif'}}>
      <h3 style={{marginBottom:12}}>⚔️ Battle Active</h3>

      {/* player team */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
        {team.map((p,i)=>(
          <div key={i} style={{padding:8,background:p.currentHp>0?'#16213e':'#3d0f0f',borderRadius:6,
            border:p.currentHp>0?'2px solid gold':'1px solid #444',opacity:p.currentHp<=0?0.5:1,minWidth:200}}>
            <div>{p.displayName} Lv.{p.level}</div>
            <div style={{color:TYPE_COLORS[p.types[0]]||'#888'}}>{p.types.join('/')}</div>
            <div>HP:<span style={{color:p.currentHp>10?'#4caf50':'#ff4444'}}>{p.currentHp}/{p.maxHp}</span></div>
            <div style={{height:8,background:'#333',borderRadius:4,marginTop:2}}>
              <div style={{height:'100%',width:`${(p.currentHp/p.maxHp)*100}%`,background:p.currentHp>10?'#4caf50':'#ff4444',borderRadius:4}}/>
            </div>
          </div>))}
      </div>

      {/* enemy team */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
        {enemies.map((e,i)=>(
          <div key={i} style={{padding:8,background:e.currentHp>0?'#30475e':'#3d0f0f',borderRadius:6,border:'1px solid #444',
            opacity:e.currentHp<=0?0.5:1,minWidth:200}}>
            <div>{e.displayName} Lv.{e.level}</div>
            <div style={{color:TYPE_COLORS[e.types[0]]||'#888'}}>{e.types.join('/')}</div>
            <div>HP:<span style={{color:e.currentHp>10?'#4caf50':'#ff4444'}}>{e.currentHp}/{e.maxHp}</span></div>
            <div style={{height:8,background:'#333',borderRadius:4,marginTop:2}}>
              <div style={{height:'100%',width:`${(e.currentHp/e.maxHp)*100}%`,background:e.currentHp>10?'#4caf50':'#ff4444',borderRadius:4}}/>
            </div>
          </div>))}
      </div>

      {/* log */}
      <div style={{padding:8,background:'#0f3460',borderRadius:6,maxHeight:200,overflowY:'auto'}}>
        {log.slice(-15).map((entry,i)=>(
          <div key={i} style={{padding:'2px 0',color:entry.type==='win'?'#4caf50':entry.type==='lose'?'#ff4444':entry.type==='damage'?'#ffd700':'#ccc'}}>
            ({entry.type}) {entry.msg}
          </div>))}
      </div>

      {/* move buttons */}
      {!finished&&(
        <div style={{marginTop:16,display:'flex',gap:8,flexWrap:'wrap'}}>
          {Array.from(new Set(['Tackle','Ember','WaterGun','Recover'])).slice(0,4).map(mv=>{
            const d=MOVES_DB[mv];
            return <button key={mv} onClick={()=>onUseMove(mv)} style={{
              padding:'10px 16px',border:'none',borderRadius:6,background:d?TYPE_COLORS[d.type]||'#555':'#555',
              color:'#fff',cursor:'pointer',fontWeight:'bold'}}>{mv}</button>;
          })}
        </div>)}

      {finished&&(<button onClick={()=>onUseMove('continue')} style={{padding:'12px 24px',border:'none',borderRadius:8,background:'#ffd700',color:'#333',cursor:'pointer',fontWeight:'bold',marginTop:16}}>Continue →</button>)}
    </div>);
};

// ════════════════════ ROGUEMODE MAIN COMPONENT ══════════════════════════════

export const RogueModeGame: React.FC = () => {
  // Load dex data for soulstone pokemon pool. loadShowdownDex() gives us the merged DexIndex
  // (standard + Sage/SoulStone/custom overlays) which can be queried for encounter pools in future iterations.
  useEffect(()=>{void loadShowdownDex().catch(()=>{});},[]);

  const [phase, setPhase]          = useState<GamePhase>('main_menu');
  const [playerTeam, setPlayerTeam] = useState<BattleMon[]>([]);
  const [enemyTeam,  setEnemyTeam]  = useState<BattleMon[]>([]);
  const [floor,      setFloor]      = useState(1);
  const [badgeCount, setBadgeCount] = useState(0);
  const [xpTotal,    setXpTotal]    = useState(0);
  const [battleLog,  setBattleLog]  = useState<LogEntry[]>([]);

  // zone lookup helper
  const currentZone: ZoneInfo|null = (()=>{
    for (const z of ZONES)if(floor>=z.floorStart&&floor<=z.floorEnd)return z;
    return null;
  })();

  // XP threshold for a given level (cumulative from lvl 5)
  const xpThresholdFor = (l:number):number=>{let s=0;for(let i=5;i<l;i++)s+=15+i*3;return s;};

  /* ── transitions ──────────────────────────────────────────────────────── */

  const startNewGame = useCallback(()=>{
    setFloor(1);setPhase('exploring');setPlayerTeam([]);setEnemyTeam([]);
    setBadgeCount(0);setXpTotal(0);
    setBattleLog([{msg:'Welcome to RogueMode! Choose your starter.',type:'system'}]);
  },[]);

  const pickStarter = useCallback((idx:number)=>{
    const s=STARTERS[idx];
    const mon:BattleMon={
      speciesKey:`starter-${idx}`,displayName:s.name,types:[...s.types],level:5,
      maxHp:calcMaxHp(s.baseHp,5),currentHp:0,
      baseAtk:s.atk,baseDef:s.def,baseSpa:s.spa,baseSpd:s.spd,baseSpe:s.spe,
      moves:[...STARTER_MOVES[s.name]],};
    mon.currentHp=mon.maxHp;
    setPlayerTeam([mon]);setPhase('exploring');
    setBattleLog([{msg:`You chose ${s.name}! Let's explore the dungeon.`,type:'system'}]);
  },[]);

  /* ── EXPLORE → battle trigger ─────────────────────────────────────────── */

  const startBattle = useCallback(()=>{
    if(!currentZone||phase!=='exploring')return;
    let enemies:BattleMon[]=[];
    // floor+1 >= FINAL_BOSS_FLOOR means the NEXT step would be the final boss floor.
    // we handle it here for the "explore" button context.
    const isFinalBoss=(floor===FINAL_BOSS_FLOOR-1);

    if(isFinalBoss){
      // Final boss: 6 soulstone-type pokemon, scaled
      const lvl=Math.min(95,30+Math.floor(Math.random()*10));
      enemies=SOULSTONE_TYPES.map(zt=>{const m=createBattleMon(zt,lvl,true);m.currentHp=m.maxHp;return m;});
    }else if(floor%5===0){
      // Boss every 5th floor
      const lvl=Math.min(95,currentZone.floorStart+3);
      for(let i=0;i<3;i++){const m=createBattleMon(currentZone.type,lvl+i*4,true);m.currentHp=m.maxHp;enemies.push(m);}
    }else{
      // wild encounter — zone-based type pool
      const lvl=Math.min(95,currentZone.floorStart+((currentZone.floorEnd-currentZone.floorStart)>>1));
      const m=createBattleMon(currentZone.type,lvl,false);m.currentHp=m.maxHp;enemies.push(m);
    }

    if(isFinalBoss)setPhase('battle');
    setEnemyTeam(enemies);
    setBattleLog(p=>[...p,{msg:isFinalBoss?'⚔️  The FINAL BOSS appears!':`💥 Encounter on Floor ${floor}: ${currentZone.type} area!`,type:'system'}]);
    if(!isFinalBoss)setPhase('battle');
  },[floor,currentZone,phase]);

  /* ── turn logic (called via BattleScreen.onUseMove) ──────────────────── */

  const processAction = useCallback((action:string)=>{
    if(phase!=='battle')return;

    /* victory / lose continue-flow */
    if(action==='continue'){
      const last=battleLog[battleLog.length-1];
      if(!last)return;
      if(last.type==='win'){
        /* badge for boss kills */
        if(floor%5===0||floor===FINAL_BOSS_FLOOR-1)setBadgeCount(p=>p+1);

        /* XP reward */
        const xep=enemyTeam.reduce((s,m)=>s+Math.floor(15+m.level*3),0);
        setXpTotal(p=>p+xep);

        /* level-up player pokemon — each mon gets avg XP; auto-level while thresholds met */
        if(playerTeam.length>0){
          const avgx=Math.floor(xep/playerTeam.length);
          setPlayerTeam(prev=>prev.map(m=>{
            let nm={...m};
            for(let t=avgx;t>0&&nm.level<100;){
              if(avgx>=xpThresholdFor(nm.level)){nm.level++;t-=xpThresholdFor(nm.level)}else break;
              nm.maxHp=calcMaxHp(40+nm.baseAtk-nm.baseDef,nm.level);
            }
            const pct=(m.currentHp/m.maxHp)||1;
            nm.currentHp=Math.floor(pct*nm.maxHp);
            return nm;
          }));
        }

        if(floor===FINAL_BOSS_FLOOR-1){/* about to hit 30 */
          /* check: did they survive final boss? yes → victory */
          setPhase('victory');return;
        }
        advanceFloor();
        /* heal 30% between floors */
        setPlayerTeam(p=>p.map(m=>({...m,currentHp:Math.min(m.maxHp,m.currentHp+Math.floor(m.maxHp*0.3))})));
      }else if(last.type==='lose'){setPhase('game_over');}
      return;
    }

    /* normal combat round */
    let teamOut=playerTeam.map(m=>({...m}));
    let foeOut =enemyTeam .map(m=>({...m}));
    const logs:LogEntry[]=[];

    const pIdx=teamOut.findIndex(m=>m.currentHp>0);
    if(pIdx<0){setPhase('game_over');return;}

    const eIdx=foeOut.findIndex(m=>m.currentHp>0);
    if(eIdx<0||eIdx>=foeOut.length)return;

    const attacker=teamOut[pIdx];
    const defTypes=[...foeOut[eIdx].types];

    /* status = heal self */
    if(MOVES_DB[action]?.category==='status'){
      const amt=Math.floor(attacker.maxHp*0.5);
      attacker.currentHp=Math.min(attacker.maxHp,attacker.currentHp+amt);
      logs.push({msg:`${attacker.displayName} used ${action}! (+${amt} HP)`,type:'heal'});
    }else{
      const res=execMove(attacker,defTypes,action);
      if(res.miss){logs.push({msg:`${attacker.displayName} used ${action} but missed!`,type:'action'})}
      else if(res.damage>0){
        foeOut[eIdx]={...foeOut[eIdx],currentHp:Math.max(0,foeOut[eIdx].currentHp-res.damage)};
        logs.push({msg:`${attacker.displayName} used ${action}${res.label?' '+res.label:''} (-${res.damage} HP)`,type:'damage'});
        if(foeOut[eIdx].currentHp===0){logs.push({msg:`${foeOut[eIdx].displayName} fainted!`,type:'action'})}
      }
    }

    /* check win */
    const allDead=foeOut.every(m=>m.currentHp<=0);
    if(allDead){logs.push({msg:'✅ All opponents defeated!',type:'win'});}
    else{
      /* counter-attacks from every alive enemy */
      foeOut.filter(e=>e.currentHp>0&&e!==foeOut[eIdx]).forEach((ea)=>{
        const ti=pIdx>=0?Math.max(0,pIdx):teamOut.findIndex(m=>m.currentHp>0);
        if(ti<0||ti>=teamOut.length)return;
        const tgt=teamOut[ti];if(tgt.currentHp<=0)return;
        const mv=['Tackle','QuickAttack','Ember','WaterGun'][Math.floor(Math.random()*4)];
        const r2=execMove(ea,[tgt.types[0]],mv);
        if(r2.miss)logs.push({msg:`${ea.displayName} missed!`,type:'action'});
        else{teamOut[ti]={...teamOut[ti],currentHp:Math.max(0,tgt.currentHp-r2.damage)};
          logs.push({msg:`${ea.displayName} dealt ${r2.damage} to ${tgt.displayName}${r2.label?' '+r2.label:''}`,type:'damage'});}
      });

      /* also the primary target defender if alive and different from pIdx */
      const ea=foeOut[eIdx];if(ea.currentHp>0){
        const ti=pIdx>=0?Math.max(0,pIdx):teamOut.findIndex(m=>m.currentHp>0);
        if(ti<0||ti>=teamOut.length)return;
        const tgt=teamOut[ti];if(tgt.currentHp<=0)return;
        const mv=['Tackle','QuickAttack','Ember','WaterGun'][Math.floor(Math.random()*4)];
        const r2=execMove(ea,[tgt.types[0]],mv);
        if(r2.miss)logs.push({msg:`${ea.displayName} missed!`,type:'action'});
        else{teamOut[ti]={...teamOut[ti],currentHp:Math.max(0,tgt.currentHp-r2.damage)};
          logs.push({msg:`${ea.displayName} dealt ${r2.damage} to ${tgt.displayName}${r2.label?' '+r2.label:''}`,type:'damage'});}
      }
    }

    if(!teamOut.some(m=>m.currentHp>0))logs.push({msg:'💀 Your team fainted!',type:'lose'});
    setPlayerTeam(teamOut);setEnemyTeam(foeOut);setBattleLog(p=>[...p,...logs]);
  },[phase,playerTeam,enemyTeam,battleLog,floor,currentZone]/* eslint-disable-line no-unused-vars */);

  const advanceFloor = useCallback(()=>{
    if(floor>=FINAL_BOSS_FLOOR)return;
    const nf=Math.min(FINAL_BOSS_FLOOR-1,floor+1);
    setFloor(nf);setPhase('exploring');
    setBattleLog(p=>[...p,{msg:`Reached Floor ${nf}`,type:'system'}]);
  },[floor]);

  /* ── render helpers ─────────────────────────────────────────────────── */

  const isBossFloor=floor%5===0||floor===FINAL_BOSS_FLOOR-1;

  // ──────── JSX ─────────────────────────────────────────────────────────

  return(
    <div style={{maxWidth:960,margin:'auto',padding:24,fontFamily:'Arial,sans-serif',color:'#333'}}>

      {/* ══ MAIN MENU ══ */}
      {phase==='main_menu'&&(
        <div style={{textAlign:'center',padding:60,background:'#1a1a2e',borderRadius:10}}>
          <h1 style={{color:'#ffd700',fontSize:36,marginBottom:8}}>⚡ ROGUE MODE ⚡</h1>
          <p style={{color:'#ccc',fontSize:18,maxWidth:500,margin:'auto'}}>
            Crawl through the SoulStone dungeon. Fight wild encounters every floor, survive gym-leader bosses every 5 floors, and challenge the Final Boss!
          </p>
          <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:20,flexWrap:'wrap'}}>
            {ZONES.map(z=>(<span key={z.type} style={{padding:'4px 10px',background:z.zoneColor,borderRadius:4,fontSize:12,color:'#333'}}>{z.name} ({z.floorStart}-{z.floorEnd})</span>))}
          </div>
          <p style={{color:'#aaa'}}>6 SoulStone zones ─ Boss every 5 floors ─ Final Boss at floor 30</p>
          <br/>
          <button onClick={startNewGame} style={{padding:'15px 30px',fontSize:24,border:'none',borderRadius:8,background:'#ffd700',color:'#333',cursor:'pointer',fontWeight:'bold'}}>▶ New Dungeon</button>
        </div>)}

      {/* ══ STARTER SELECT ══ */}
      {phase==='exploring'&&playerTeam.length===0&&(
        <div style={{textAlign:'center',padding:40,background:'#fff',borderRadius:10}}>
          <h2>🎮 Pick Your Starter</h2><p>Choose a partner to begin the dungeon!</p>
          <div style={{display:'flex',gap:15,justifyContent:'center',marginTop:20,flexWrap:'wrap'}}>
            {STARTERS.map((s,i)=>(<button key={i} onClick={()=>pickStarter(i)} style={{padding:'15px 20px',fontSize:16,border:'none',borderRadius:8,background:TYPE_COLORS[s.types[0]]||'#888',cursor:'pointer',color:'#fff',fontWeight:'bold',minWidth:140}}>{s.name} ({s.types.join('/')})</button>))}
          </div>
        </div>)}

      {/* ══ EXPLORING (post-starter) ══ */}
      {phase==='exploring'&&currentZone&&playerTeam.length>0&&(
        <div style={{padding:20,background:'#fff',borderRadius:10}}>
          <h3>📍 Floor {floor}: {currentZone.name}</h3>
          <p>Zone:<strong>{currentZone.type}</strong> │ Levels:{currentZone.floorStart}–{currentZone.floorEnd}{isBossFloor?' ⚔️ Boss ahead!':''}</p>

          {/* team sidebar row */}
          <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
            {playerTeam.map((m,i)=>(<span key={i} style={{padding:'4px 8px',borderRadius:4,fontSize:13,color:'#fff',background:TYPE_COLORS[m.types[0]]||'#888'}}>{m.displayName} Lv.{m.level} ({m.currentHp}/{m.maxHp})</span>))}
          </div>
          <p style={{color:'#555'}}>XP: {xpTotal}</p>

          {/* buttons */}
          <div style={{display:'flex',gap:12,marginTop:16,flexWrap:'wrap'}}>
            <button onClick={startNewGame} style={{padding:'10px 16px',border:'none',borderRadius:6,background:'#555',color:'#fff',cursor:'pointer'}}>↺ New Game</button>
            
            {floor>=FINAL_BOSS_FLOOR-1
              ?<button onClick={startBattle} style={{padding:'12px 24px',border:'none',borderRadius:8,background:'#d9534f',color:'#fff',cursor:'pointer',fontWeight:'bold'}}>⚔️ Face Final Boss!</button>
              :isBossFloor&&(floor%5===0)
                ?<button onClick={startBattle} style={{padding:'12px 24px',border:'none',borderRadius:8,background:'#d9534f',color:'#fff',cursor:'pointer',fontWeight:'bold'}}>⚔️ Fight Boss!</button>
              :<button onClick={startBattle} style={{padding:'12px 24px',border:'none',borderRadius:8,background:'#2196F3',color:'#fff',cursor:'pointer',fontWeight:'bold'}}>🔍 Search Floor</button>}

            {floor<FINAL_BOSS_FLOOR-1&&(<button onClick={advanceFloor} style={{padding:'10px 16px',border:'none',borderRadius:6,background:'#5cb85c',color:'#fff'}}>→ Next Floor</button>)}
          </div>

          {/* badge progress */}
          <div style={{marginTop:20}}>
            <h4>SoulStone Bosses Defeated ({badgeCount}/{SOULSTONE_TYPES.length+1}):</h4>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {SOULSTONE_TYPES.map((zt,i)=>(<span key={zt} style={{padding:'4px 10px',borderRadius:4,background:i<badgeCount?'#4caf50':'#ccc',color:'#fff',fontSize:13}}>{i+1}:{zt[0]}</span>))}
            </div>
          </div>

          {/* floor log */}
          {battleLog.length>0&&(<div style={{marginTop:20,padding:10,background:'rgba(0,0,0,0.05)',borderRadius:6}}>
            {battleLog.slice(-8).map((l,i)=>(<div key={i} style={{color:l.type==='system'?'#888':'#333',fontSize:13,padding:'2px 0'}}>{l.msg}</div>))}
          </div>)}
        </div>)}

      {/* ══ BATTLE ══ */}
      {phase==='battle'&&(<BattleScreen team={playerTeam} enemies={enemyTeam} log={battleLog} onUseMove={processAction}/>)}

      {/* ══ VICTORY ══ */}
      {phase==='victory'&&(
        <div style={{textAlign:'center',padding:60,background:'#2d5a27',borderRadius:10}}>
          <h1 style={{color:'#ffd700'}}>🏆 VICTORY! 🏆</h1>
          <p>You conquered the dungeon with {badgeCount} badges and {xpTotal} XP!</p>
          <button onClick={startNewGame} style={{padding:'15px 30px',border:'none',borderRadius:8,background:'#ffd700'}}>Play Again</button>
        </div>)}

      {/* ══ GAME OVER ══ */}
      {phase==='game_over'&&(
        <div style={{textAlign:'center',padding:60,background:'#5a1a1a',borderRadius:10}}>
          <h1>💀 GAME OVER 💀</h1><p>Your team fainted on Floor {floor}.</p>
          <button onClick={startNewGame} style={{padding:'15px 30px',border:'none',borderRadius:8,background:'#ffd700'}}>Try Again</button>
        </div>)}

    </div>);
};
// end of RogueModeGame.tsx
