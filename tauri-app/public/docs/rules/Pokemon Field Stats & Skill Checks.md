# Pokemon Field Stats & Skill Checks

See also: [Main rules.md](Main%20rules.md), [Pokemon Contest & Showcase Draft.md](Pokemon%20Contest%20%26%20Showcase%20Draft.md)

Use this rules layer when a Pokemon is acting like a character in a scene instead of just making a normal battle attack.

Good uses:
- shaping a move in the environment, like Psychic making stone spikes or water lifting a bridge lever
- travel and field obstacles
- boss-fight support scenes
- anime-style stunt actions
- direct Pokemon-led showcase moments

Do **not** use this to replace normal in-battle attack, defense, damage, or move-power math.
Battle damage still uses the normal battle rules.

This note is for **field scenes and direct out-of-battle Pokemon actions**.
For **Contest Round 2**, use the contest document's version of these same five stats, which is based on the Pokemon's **calculated battle stats** instead of base stats.

## Core idea

Pokemon get a short field-stat line derived from their base stats.

Use these five stats:
- **Strength**
- **Athletics**
- **Intelligence**
- **Fortitude**
- **Charm**

`Charm` is the Pokemon-facing replacement for `Speech`.

If a rule would call for `Speech` but the Pokemon is the one acting directly, use `Charm` instead.

## Quick formulas

Use the Pokemon's **calculated (level-adjusted) stats**, not raw base stats.

This means field stats scale with level, nature, EVs, and IVs just like battle stats do.
A higher-level Pokemon will have stronger field-stat checks.

If you are resolving **Contest Round 2** instead, keep this note's stat names and type-bonus map, but use the contest document's calculated-stat formulas instead.

Define these helper functions for the app:

```text
ceil10(x) = ceil(x / 10)
ceil20(x) = ceil(x / 20)
clampStat(x) = min(20, max(3, x))
typeBonus(stat, types) = number of the Pokemon's types that match that stat, max 2
fieldBonus(stat) = ceil(stat / 2)
```

Then calculate using the Pokemon's **calculated** Attack, Speed, Sp. Atk, Sp. Def, HP, and Defense:

```text
Strength = clampStat(ceil10(Attack) + typeBonus(Strength, types))
Athletics = clampStat(ceil10(Speed) + typeBonus(Athletics, types))
Intelligence = clampStat(ceil20(Sp. Atk + Sp. Def) + typeBonus(Intelligence, types))
Fortitude = clampStat(ceil20(HP + Defense) + typeBonus(Fortitude, types))
Charm = clampStat(ceil20(HP + Sp. Def) + typeBonus(Charm, types))
```

Rolls use the same check system as trainers:

```text
Pokemon field check = d12 + fieldBonus(relevant stat)
Natural 12 = 12 + relevant stat
```

That keeps Pokemon on the same scale as the rest of your campaign and makes the app math simple.

## Contest note

These same five stats now have two uses:

- **Field stats** in this note use **calculated (level-adjusted) stats** for out-of-battle scenes
- **Contest battle stats** in [Pokemon Contest & Showcase Draft.md](Pokemon%20Contest%20%26%20Showcase%20Draft.md) use **calculated battle stats** for Round 2 exchanges

Both systems now scale with level. Keep the shared type-bonus map between both systems.
That way the Pokemon still "feels" like the same species across field scenes and contest combat.

## Type bonus map

Each matching type gives `+1` to the linked field stat.
If both of the Pokemon's types point to the same stat, that stat gets `+2`.

| Type | Field stat bonus |
|---|---|
| Normal | Charm |
| Fire | Charm |
| Water | Fortitude |
| Electric | Athletics |
| Grass | Charm |
| Ice | Athletics |
| Fighting | Strength |
| Poison | Intelligence |
| Ground | Strength |
| Flying | Athletics |
| Psychic | Intelligence |
| Bug | Athletics |
| Rock | Fortitude |
| Ghost | Intelligence |
| Dragon | Strength |
| Dark | Intelligence |
| Steel | Fortitude |
| Fairy | Charm |

## What each stat means

### Strength
Use for:
- lifting, dragging, smashing, breaking, pinning, body checks
- forcing terrain open
- raw physical move applications like `Brick Break`, `Vine Whip`, `Iron Tail`, or `Bulldoze`

### Athletics
Use for:
- sprinting, leaping, climbing, dodging, racing, balance
- precision movement
- speed-based move applications like `Quick Attack`, `Agility`, `Flame Charge`, or aerial repositioning

### Intelligence
Use for:
- precise control of unusual move shaping
- reading space, understanding a mechanism, picking the right angle
- psychic construction, illusion work, elemental shaping, barriers, targeting, and puzzle actions

This is the main stat for things like:
- `Psychic` lifting or arranging objects
- making stone spikes with a controlled `Rock Slide` or `Stone Edge` style use
- `Ice Beam` freezing a lock instead of an enemy
- `Thunder Wave` overloading a device carefully instead of just blasting it

### Fortitude
Use for:
- holding a barrier under pressure
- enduring weather, poison air, heat, cold, falling debris, or recoil-like scene stress
- resisting being pushed back, drained, or worn down outside battle

Fortitude is also the main stat for reducing **out-of-battle HP strain**.

### Charm
Use for:
- emotional presence, showmanship, cuteness, confidence, intimidation, or direct connection
- showcases and presentations where the Pokemon itself is the focus
- calming civilians, attracting attention, winning over crowds, or selling the visual of a stunt

This is not only cuteness.
It covers charisma, presence, and how strongly the Pokemon fills the scene.

## Out-of-battle strain and HP drain

When a Pokemon pushes itself outside battle, do not use normal attack damage.
Instead, assign a **strain band** and reduce it by the Pokemon's **Fortitude bonus**.

```text
Fortitude bonus = ceil(Fortitude / 2)
Final strain damage = max(0, strain roll - Fortitude bonus)
```

Recommended strain bands:

| Situation | Strain |
|---|---:|
| minor overexertion, light hazard, repeated utility use | `1d4` |
| serious push, rough terrain shaping, holding a move under pressure | `1d6` |
| dangerous stunt, crash landing, major environmental force | `1d10` |
| extreme scene, boss-scale burden, catastrophic backlash | `2d6` or `1d12` |

Use this only for **out-of-battle** loss.
Normal battle damage still uses the standard battle rules.

## Choosing the stat quickly

Use this shortcut when you do not want to overthink it:

| If the Pokemon is mostly... | Use |
|---|---|
| overpowering the problem | Strength |
| outmoving the problem | Athletics |
| shaping or solving the problem | Intelligence |
| enduring the problem | Fortitude |
| selling, calming, or commanding the scene | Charm |

## Trainer plus Pokemon scenes

If both the trainer and Pokemon matter, use one of these two methods.

### Method 1: lead and assist
- the main actor rolls normally
- the helper makes a supporting check against the same DC
- on a success, add `+2`
- on a failure by `5+`, apply `-2`

Examples:
- trainer uses `Intelligence`, Alakazam uses `Intelligence` to shape a psychic bridge
- trainer uses `Speech`, Sylveon uses `Charm` in a showcase introduction
- trainer uses `Athletics`, Machamp uses `Strength` to move rubble during a rescue

### Method 2: best-fit single roll
If the scene is short, just use the stat of the side actually doing the hard part.

Examples:
- the trainer is yelling commands, but the Pokemon is the one threading a beam through ruins: roll the Pokemon's `Intelligence`
- the Pokemon is bracing a collapsing tunnel while the trainer is mostly staying out of the way: roll the Pokemon's `Fortitude`

## Showcase use

For direct Pokemon-led performance checks:
- use `Charm` by default
- use `Intelligence` for tightly technical routines
- use `Athletics` for physically active routines
- use `Fortitude` if the act is punishing or dangerous

If the trainer is still the lead performer, keep using the normal showcase draft rules.

## Fast DC guide

Because Pokemon field checks use the same d12 + half-stat structure as trainers, keep DCs on the same scale:

| Difficulty | DC |
|---|---:|
| easy but meaningful | 10 |
| standard scene obstacle | 12 |
| trained or notable stunt | 14 |
| hard dramatic use | 16 |
| elite showcase or dangerous precision | 18 |
| near-signature miracle moment | 20+ |

## Examples

### Example 1: Alakazam shapes stone spikes with Psychic

Base stats used:
- HP 55
- Attack 50
- Defense 45
- Sp. Atk 135
- Sp. Def 95
- Speed 120
- Type: Psychic

```text
Strength = ceil(50 / 10) = 5
Athletics = ceil(120 / 10) = 12
Intelligence = ceil((135 + 95) / 20) + 1 = 13
Fortitude = ceil((55 + 45) / 20) = 5
Charm = ceil((55 + 95) / 20) = 8
```

Psychic stone shaping check:

```text
d12 + ceil(13 / 2)
= d12 + 7
```

If the move causes serious scene strain, apply `1d6 - Fortitude bonus` HP drain afterward.

### Example 2: Machamp holds a collapsing gate

Use `Fortitude` if the challenge is enduring the weight.
Use `Strength` if the challenge is forcing it open or lifting it fast.

### Example 3: Sylveon wins over a frightened crowd during a showcase interruption

Use `Charm`.
If the trainer is helping by narrating and cueing the act, the trainer can assist with `Speech`.

## Optional tweak if you want more differentiation

If some Pokemon feel a little too flat in the app, add one **nature or personality bump**:
- pick one field stat that fits the species, nature, or recurring characterization
- give it `+1`
- reduce one clearly weak field stat by `-1`

Keep this optional.
The default formulas above are faster and easier to automate.

## App-ready pseudocode

```text
function ceilDiv(value, divisor) {
  return Math.ceil(value / divisor)
}

function clampStat(value) {
  return Math.max(3, Math.min(20, value))
}

function getTypeBonus(statName, types) {
  const map = {
    Strength: ["Fighting", "Ground", "Dragon"],
    Athletics: ["Electric", "Ice", "Flying", "Bug"],
    Intelligence: ["Poison", "Psychic", "Ghost", "Dark"],
    Fortitude: ["Water", "Rock", "Steel"],
    Charm: ["Normal", "Fire", "Grass", "Fairy"]
  }

  return Math.min(2, types.filter(type => map[statName].includes(type)).length)
}

strength = clampStat(ceilDiv(atk, 10) + getTypeBonus("Strength", types))
athletics = clampStat(ceilDiv(spe, 10) + getTypeBonus("Athletics", types))
intelligence = clampStat(ceilDiv(spa + spd, 20) + getTypeBonus("Intelligence", types))
fortitude = clampStat(ceilDiv(hp + def, 20) + getTypeBonus("Fortitude", types))
charm = clampStat(ceilDiv(hp + spd, 20) + getTypeBonus("Charm", types))

checkBonus = Math.ceil(stat / 2)
rollTotal = d12 + checkBonus
nat12Total = 12 + stat

strainDamage = Math.max(0, strainRoll - Math.ceil(fortitude / 2))
```