# TM Crafting & Etching

Companion references:
- [Crafting, Salvage & Field Fabrication.md](Crafting%2C%20Salvage%20%26%20Field%20Fabrication.md)
- [Crafting Materials Index.md](Crafting%20Materials%20Index.md)
- [TM Ingredient Table - Regional Type Lanes.md](TM%20Ingredient%20Table%20-%20Regional%20Type%20Lanes.md)
- [Main rules.md](Main%20rules.md)

## What this system is for
This is the rule set for **one-use TM crafting** in your sequel campaign.

Core idea:
- wild Pokemon and route materials provide **typed source value**
- that value becomes a **BP budget**
- an **Intelligence check** converts a percentage of that budget into the finished TM
- crafted TMs are normally **one-use plates**
- **Gym reward TMs** remain **multi-use**

---

## TM requirements

| Requirement | Needed? | Notes |
|---|---|---|
| TM blank | always | one blank makes one etched TM plate |
| typed source materials | always | determines starting BP budget |
| blueprint OR Pokemon Center access | always | either works |
| station | yes | Pokemon Center, lab, or field rig with blueprint |

### Blueprint rule
A blueprint can be created from:
- a Pokemon that currently knows the move
- a Pokemon that has previously learned the move in a way the GM accepts
- a League, lab, or Center archive

### Pokemart blueprint rule
Most **common and standard move blueprints** are sold in Pokemarts the same way TMs are, but at a heavily discounted price because the buyer is only purchasing the **move pattern**, not the charged plate.

Default shop formula:

`Blueprint price = 25% of the matching TM's listed shop price, rounded up to the nearest 250`

| TM price band | Blueprint price |
|---:|---:|
| 1,000 | 250 |
| 3,000 | 750 |
| 6,000 | 1,500 |
| 10,000 | 2,500 |
| 15,000 | 3,750 |
| 20,000 | 5,000 |
| 25,000 | 6,250 |

Practical shop rule:
- Pokemarts usually stock **basic, low-output, standard field, and some specialist** blueprints.
- Advanced, expedition-grade, rare support, and signature move blueprints should still come from gyms, labs, research rewards, black markets, or specific Pokemon study.

Practical ruling:
- common moves can usually be etched at a Pokemon Center without carrying a physical blueprint
- signature, rare, or weird moves should still require a blueprint

---

## Type rules

- Typed materials can only be used toward a TM of that type.
- A dual-type mon's harvested part can be refined toward **one** of its types.
- **Normal-type material** may be used as support value for **any non-Ghost TM**.
- Normal cannot help craft Ghost TMs.
- Off-type support material can stabilize a craft, but only **typed MV** sets the starting BP budget.

Example:
- Mareep fur can help make Electric TMs.
- Gligar claws can help make Ground or Flying TMs.
- Bidoof fur can help stabilize many non-Ghost TMs as Normal support.

---

## Stage value and starting BP

### Step 1: total typed MV
Add the MV of all materials that match the TM's type.

### Step 2: starting BP budget
Use this formula:

`Starting BP Budget = typed MV x 10`

Examples:
- 3 typed MV = 30 BP budget
- 6 typed MV = 60 BP budget
- 9 typed MV = 90 BP budget

Normal support materials do **not** create starting BP by themselves. They only help stabilize the etching.

---

## Intelligence quality roll

After setting the starting BP budget, make an **Intelligence** crafting check.

Use the normal system:
- `D12 + half Intelligence (round up)`

### Suggested DC by target move tier

| Target BP or move tier | DC |
|---|---:|
| 30 to 40 BP | 10 |
| 50 to 70 BP | 12 |
| 80 to 90 BP | 15 |
| 100+ BP or strong status tech | 18 |

### Conversion percentage table

| Craft result | Value converted |
|---|---:|
| Fail by 5+ | 50% |
| Fail by 1-4 | 75% |
| Meet DC | 100% |
| Beat DC by 5+ | 125% |
| Natural 12 | 150% |

### Final BP cap formula

`Final BP Cap = Starting BP Budget x conversion percentage`

Round down to the nearest 5.

Examples:
- 60 budget, meet DC = 60 final BP cap
- 60 budget, beat by 5 = 75 final BP cap
- 80 budget, natural 12 = 120 final BP cap

---

## Choosing the actual move

The finished TM must satisfy **all** of the following:
- the move type matches the craft type
- the move is available from the blueprint or Center archive
- the move's BP is **equal to or below** the final BP cap

If the desired move is above the cap:
- choose a weaker move of that type
- or keep the blueprint and try again later with better materials

---

## Status and utility TMs
Status moves do not use BP the same way, so convert them by **utility tier**.

### Utility tier by final BP cap

| Final BP cap | Status / utility tier |
|---:|---|
| 30 to 40 | basic utility |
| 45 to 60 | standard support |
| 65 to 80 | strong support |
| 85+ | elite support |

### Example status mapping

| Tier | Example moves |
|---|---|
| basic utility | Growl, Tail Whip, Sand Attack, String Shot |
| standard support | Thunder Wave, Will-O-Wisp, Light Screen, Reflect, Safeguard |
| strong support | Taunt, Trick Room, Toxic Spikes, Calm Mind, Swords Dance |
| elite support | Nasty Plot, Quiver Dance, Shell Smash, high-end signature support |

DM rule:
- if a status move would clearly be too strong for a given story point, require a blueprint even at a Pokemon Center

---

## Example move-band chart by type

| Type | 30 to 40 BP | 50 to 70 BP | 80 to 90 BP | 100+ BP |
|---|---|---|---|---|
| Normal | Swift | Facade | Hyper Voice | Hyper Beam |
| Fire | Ember | Flame Charge | Flamethrower | Fire Blast |
| Water | Water Pulse | Scald | Surf | Hydro Pump |
| Grass | Magical Leaf | Razor Leaf / Seed Bomb | Energy Ball | Leaf Storm |
| Electric | Thunder Shock | Spark / Volt Switch | Thunderbolt | Thunder |
| Ice | Powder Snow / Icy Wind | Ice Punch / Aurora Beam | Ice Beam | Blizzard |
| Fighting | Rock Smash | Brick Break / Drain Punch | Aura Sphere / Close Combat | Focus Blast |
| Poison | Acid Spray | Sludge | Sludge Bomb | Gunk Shot |
| Ground | Mud-Slap | Bulldoze / Dig | Earth Power | Earthquake |
| Flying | Gust / Aerial Ace | Air Cutter / Acrobatics | Air Slash | Hurricane |
| Psychic | Confusion | Psybeam / Zen Headbutt | Psychic | Future Sight |
| Bug | Struggle Bug | Signal Beam / X-Scissor | Bug Buzz | Megahorn |
| Rock | Rock Tomb | Ancient Power / Rock Slide | Power Gem | Stone Edge |
| Ghost | Astonish / Hex | Shadow Punch / Ominous Wind | Shadow Ball | Phantom Force |
| Dragon | Twister | Dragon Breath / Dragon Claw | Dragon Pulse | Draco Meteor |
| Dark | Snarl / Bite | Foul Play / Crunch | Dark Pulse | Hyperspace-style or signature only |
| Steel | Metal Claw | Iron Head | Flash Cannon | Steel Beam |
| Fairy | Draining Kiss | Dazzling Gleam | Moonblast | Fleur Cannon |

This chart is a default move-band guide, not a prison. If the blueprint and story support a different move of similar strength, use it.

---

## TM blank grades

| Blank grade | Typical source | What it supports |
|---|---|---|
| Common blank | shops, scavenged League stock, Rocket salvage | basic and standard TMs |
| Reinforced blank | Pokemon Center, gym workshop, good salvage | strong support and 80 to 90 BP moves |
| Premium blank | gym reward chassis, Vulmotech, high-rank research | 100+ BP or elite support |

---

## One-use vs multi-use

### Crafted TMs
- one use by default
- consumed when successfully taught

### Gym reward TMs
- multi-use
- built on official League-grade or gym-certified plates
- should feel like a major reward, not something the party mass-produces

---

## Worked examples

### Example 1: Electric TM from Mareep materials
- Mareep wool tuft = 3 MV
- Mareep wool tuft = 3 MV
- typed MV total = 6
- starting BP budget = 60
- Intelligence check meets DC 12
- final BP cap = 60

Good outputs:
- Spark
- Volt Switch if blueprint exists and you allow it at that band

### Example 2: Ground TM from Gligar claws
- Gligar claw = 3 MV
- Gligar claw = 3 MV
- Sandile fang = 3 MV toward Ground
- typed MV total = 9
- starting BP budget = 90
- fail by 1 to 4 on the check = 75%
- final BP cap = 65

Good outputs:
- Dig
- Bulldoze
- not Earthquake yet

### Example 3: Big Electric TM from mid-stage and final-stage parts
- Flaaffy mane strip = 5 MV
- Magnemite coil = 3 MV
- Erace capacitor core = 7 MV
- typed MV total = 15
- starting BP budget = 150
- strong success = 125%
- final BP cap = 185, but still limited by blueprint and blank quality

Good outputs:
- Thunderbolt on a reinforced blank
- Thunder on a premium blank with a good blueprint

---

## Regional type-lane support
Use [TM Ingredient Table - Regional Type Lanes.md](TM%20Ingredient%20Table%20-%20Regional%20Type%20Lanes.md) as the fast table for common route species, default harvest parts, and which TM lanes those parts naturally feed.

---

## Practical balancing notes
- Most route-made TMs should land in the **30 to 80 BP** space.
- **90+ BP** TMs should require better parts, better blanks, and usually a better station.
- Gym leaders and labs should still feel special because they can hand out **multi-use** plates or cleaner move access.