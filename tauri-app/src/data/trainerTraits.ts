export type TrainerStat = 'strength' | 'athletics' | 'intelligence' | 'speech' | 'fortitude' | 'luck';

export type TrainerTrait = {
  name: string;
  desc: string;
  reqText?: string;
  minStats?: Partial<Record<TrainerStat, number>>;
  requiredTraits?: string[];
  requiresTypeSpecialty?: boolean;
};

export const TRAINER_TRAITS: TrainerTrait[] = [
  { name: 'Pitcher', desc: 'Can throw a Pokéball before the first turn at a 1.5x catch rate. Does not stack with Quick Balls and is overridden by the 4x multiplier. Stacks multiplicatively with any other Pokéball catching multiplier.', reqText: '8 STR', minStats: { strength: 8 } },
  { name: 'Black Belt', desc: 'Can use Strength stat for Athletics rolls.', reqText: '15 STR', minStats: { strength: 15 } },
  { name: 'Runner', desc: 'Can run away from any battle, regardless of location/status. Cannot run from trainer battles.', reqText: '10 ATH', minStats: { athletics: 10 } },
  { name: 'Sneak attack', desc: 'Gains the “Ambush” ability. Can sneak attack a Pokémon to get a free first hit if unseen and actively sneaking.', reqText: '10 ATH', minStats: { athletics: 10 } },
  { name: 'Fisher', desc: 'Can use a fishing rod without an Athletics check.', reqText: '10 ATH', minStats: { athletics: 10 } },
  { name: 'Chef', desc: 'Cook a meal to restore the gang to full HP and SP using extra supplies.', reqText: '10 INT', minStats: { intelligence: 10 } },
  { name: 'Scholar', desc: 'Gain advantage on Intelligence checks involving history, Pokémon info, and current events.', reqText: '10 INT', minStats: { intelligence: 10 } },
  { name: 'Double Battler', desc: 'Can use two Pokémon in wild encounters or wild trainer battles. Gym rules are set in stone.', reqText: '10 INT', minStats: { intelligence: 10 } },
  { name: 'Jr. Professor', desc: 'May use Intelligence to attempt a Wild Bond.', reqText: 'INT D12 (12 INT)', minStats: { intelligence: 12 } },
  { name: 'Nurse', desc: 'Heal People and Pokémon to full HP during a rest without supplies. Advantage on Wild Bond attempts for injured Pokémon.', reqText: 'INT D12 (12 INT)', minStats: { intelligence: 12 } },
  { name: 'Aura Guardian', desc: 'Loosely speak with Pokémon that share your Type Specialty. Wild Card can speak fluently with starter.', reqText: '10 INT', minStats: { intelligence: 10 } },
  { name: 'Trace', desc: 'Copy the ability of one Pokémon; persistent until removed by psychic means.', reqText: '12 INT + Aura Guardian', minStats: { intelligence: 12 }, requiredTraits: ['Aura Guardian'] },
  { name: 'Psychic', desc: 'High-DC Intelligence check to know the opponent’s next Pokémon and allow a switch.', reqText: '20 INT', minStats: { intelligence: 20 } },
  { name: 'Ace Trainer', desc: 'The more Pokémon in your party (max 6), +1 to catch rolls during the attempt.', reqText: '10 FTD', minStats: { fortitude: 10 } },
  { name: 'Biker', desc: 'Ride a bike to expend one-third SP while traveling (flat/mostly unobstructed).', reqText: '10 FTD', minStats: { fortitude: 10 } },
  { name: 'Hiker', desc: 'Expend half as much SP when traveling from place to place.', reqText: '13 FTD', minStats: { fortitude: 13 } },
  { name: "It's the Vibes", desc: '1.5x modifier to catching Pokémon of the same gender as you.', reqText: '8 SCH', minStats: { speech: 8 } },
  { name: 'Contest Star', desc: 'Use Contest attributes of Pokémon moves (Smart, Cool, Tough, Cute, Beauty) to gain bonuses on Speech rolls.', reqText: '10 SCH', minStats: { speech: 10 } },
  { name: 'Down Brock', desc: 'Smooth talk the opposite gender very well (unless a Pokémon is done with your antics).', reqText: '15 SCH', minStats: { speech: 15 } },
  { name: 'Actor/Actress', desc: '1.5x bonus to Speech checks while impersonating or deceiving.', reqText: '15 SCH', minStats: { speech: 15 } },
  { name: 'Test Your Luck', desc: 'Once a day, reroll a failed check using Luck.', reqText: '10 LCK', minStats: { luck: 10 } },
  { name: 'Prepared For Everything', desc: 'Make a “Test Your Luck” roll to just so happen to have exactly what you need.', reqText: '20 LCK + Test Your Luck', minStats: { luck: 20 }, requiredTraits: ['Test Your Luck'] },
  { name: 'Guys Type trainer', desc: 'Boosts catch rate by 1.5x if a Pokémon has more than one head/being in it.', reqText: 'No requirements' },
  { name: 'Expanding Horizons', desc: 'Wild Card: gain a Type Specialty. If you already have one, gain another (no limit).', reqText: 'No requirements' },
  { name: 'In Tune', desc: 'Become in tune with your Type Specialty (bonuses vary by type).', reqText: 'Requires Type Specialty', requiresTypeSpecialty: true },
  { name: 'Field Researcher', desc: 'When collecting samples, running surveys, or doing on-route science, gain advantage on relevant Intelligence checks.', reqText: '10 INT', minStats: { intelligence: 10 } },
  { name: 'Zone Sense', desc: 'You can always attempt an INT check to read a route fracture. On success, gain advantage on the next navigation/seam-read check on that route.', reqText: '12 INT', minStats: { intelligence: 12 } },
  { name: 'Bond Whisperer', desc: 'Gain advantage on attempts to calm, approach, or negotiate with Pokémon that match your Type Specialty.', reqText: '12 INT + Type Specialty', minStats: { intelligence: 12 }, requiresTypeSpecialty: true },
  { name: 'Gadgeteer', desc: 'Build or repair small field gadgets during rests; on success, gain a practical utility item for the next scene.', reqText: '12 INT', minStats: { intelligence: 12 } },
  { name: 'Iron Will', desc: 'Push through one extra training or travel scene when you should be done; you pass out immediately after.', reqText: '12 FTD', minStats: { fortitude: 12 } },
  { name: 'Battle Analyst', desc: 'Once per battle, make an INT check to call the fight and reveal a meaningful tactical truth; an ally gains advantage on one related roll.', reqText: '12 INT', minStats: { intelligence: 12 } },
  { name: 'Quick Hands', desc: 'Once per battle, use an item (or throw a Poké Ball) without losing your action.', reqText: '10 ATH', minStats: { athletics: 10 } },
  { name: 'Type Specialist', desc: 'Gain advantage on checks to identify, track, and work with Pokémon matching your Type Specialty, plus a 1.5x catch-rate modifier for matching types.', reqText: 'Requires Type Specialty', requiresTypeSpecialty: true },
  { name: 'People person', desc: 'Instantly know when an Insight (INT) roll can be used without initiating it.', reqText: '12 SCH', minStats: { speech: 12 } },
  { name: 'Seam Cartographer', desc: 'When traveling a route you have already mapped, reroll one navigation or seam-read check per travel and keep the better result.', reqText: '12 INT + Zone Sense', minStats: { intelligence: 12 }, requiredTraits: ['Zone Sense'] },
  { name: 'Fracture Runner', desc: 'When a route becomes a traversal scene, take point and grant the party +1 on the next traversal-related check.', reqText: '12 ATH', minStats: { athletics: 12 } },
  { name: 'Stormwise', desc: 'Gain advantage on checks to endure severe weather. Once per travel, reduce the SP cost of one weather hazard by 1 for the party (min 0).', reqText: '12 FTD', minStats: { fortitude: 12 } },
  { name: 'Supply Discipline', desc: 'Once per travel day, ignore the first extra-supplies consequence from a failed travel check (you still lose time).', reqText: '10 FTD', minStats: { fortitude: 10 } },
  { name: 'Field Lab Kit', desc: 'During a rest, process samples and bank 1 Research Note. Spend a Note to gain advantage on a related knowledge check later.', reqText: '12 INT + Field Researcher', minStats: { intelligence: 12 }, requiredTraits: ['Field Researcher'] },
  { name: 'Stabilizer Protocols', desc: 'When a high-chaos or fusion event hits, attempt an INT check to reduce collateral; on success, reduce one severity.', reqText: '15 INT', minStats: { intelligence: 15 } },
  { name: 'Defuse Assist', desc: 'When a fused or rampaging boss is incapacitated and the party attempts a Defuse, gain advantage on the primary Defuse INT check.', reqText: '12 INT + Gadgeteer', minStats: { intelligence: 12 }, requiredTraits: ['Gadgeteer'] },
  { name: 'Raid Captain', desc: 'Boss battles only: once per boss battle, issue a callout so one ally gains advantage on their next attack/check or can reposition without provoking.', reqText: '12 SCH', minStats: { speech: 12 } },
  { name: 'Tempo Reader', desc: 'After the first full round, call the enemy pattern to learn its strongest move category, main weakness angle, or likely next action.', reqText: '12 INT + Battle Analyst', minStats: { intelligence: 12 }, requiredTraits: ['Battle Analyst'] },
  { name: 'Emergency Swap', desc: 'Once per battle, switch your active Pokémon without losing your action (still respects system limits).', reqText: '12 ATH', minStats: { athletics: 12 } },
  { name: 'Calm Voice', desc: 'Gain advantage on checks to de-escalate with wild Pokémon and prevent fights.', reqText: '12 SCH', minStats: { speech: 12 } },
  { name: 'Quick Fix', desc: 'Once per rest, repair one broken item or gear tag without needing a shop.', reqText: '12 INT + Gadgeteer', minStats: { intelligence: 12 }, requiredTraits: ['Gadgeteer'] },
  { name: 'Permit Forger', desc: 'Gain advantage when using paperwork, disguises, or permits to bypass checkpoints.', reqText: '12 INT + Actor/Actress', minStats: { intelligence: 12 }, requiredTraits: ['Actor/Actress'] },
  { name: 'Lockpick & Latch', desc: 'Gain advantage on checks to open stuck doors, hatches, lockers, and service panels without making a scene.', reqText: '12 ATH + Quick Hands', minStats: { athletics: 12 }, requiredTraits: ['Quick Hands'] },
  { name: 'Dual Specialty', desc: 'Choose a second Type Specialty. Outsider penalty applies only outside both, and matching either specialty gives your normal bonus.', reqText: '15 INT + Expanding Horizons', minStats: { intelligence: 15 }, requiredTraits: ['Expanding Horizons'] },
  { name: 'Terrain Attunement', desc: 'In a biome strongly matching your Type Specialty, once per travel reduce the SP cost of one obstacle by 1 (min 0).', reqText: 'Requires Type Specialty', requiresTypeSpecialty: true },
];
