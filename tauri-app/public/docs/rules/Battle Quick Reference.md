# Battle Quick Reference

See also: [Main rules.md](Main%20rules.md), [Pokemon Contest & Showcase Draft.md](Pokemon%20Contest%20%26%20Showcase%20Draft.md), [Pokemon Field Stats & Skill Checks.md](Pokemon%20Field%20Stats%20%26%20Skill%20Checks.md)

Use this as the at-table helper sheet or the source text for a battle tab.

## Standard battle round

Each side gets:

- `1` Pokemon action
- Pokemon movement up to **half calculated Speed in feet**
- `1` Trainer action
- trainer movement from Athletics
- `1` Pokemon reaction
- `1` Trainer reaction

Turn order:

- higher active Pokemon Speed acts first
- ties go to trainer Initiative
- Priority moves still jump the line

## Move power to damage die

| Adjusted move power | Damage die |
|---|---:|
| `0-29` | `1d4` |
| `30-49` | `1d6` |
| `50-69` | `1d8` |
| `70-89` | `1d10` |
| `90-109` | `1d12` |
| `110+` | `1d20` |

## Calculated combat bonus bands

| Calculated stat | Attack / Sp. Atk bonus | Defense / Sp. Def modifier | Speed bonus |
|---|---:|---:|---:|
| `0-39` | `+0` | `+1 damage taken` | `+0` |
| `40-59` | `+1` | `0` | `+1` |
| `60-79` | `+2` | `-1` | `+2` |
| `80-99` | `+3` | `-2` | `+3` |
| `100-119` | `+4` | `-3` | `+4` |
| `120-139` | `+5` | `-4` | `+5` |
| `140-159` | `+6` | `-5` | `+6` |
| `160+` | `+7` | `-6` | `+7` |

## Damage steps

1. Start with the printed move power.
2. Apply STAB, weather, terrain, abilities, held items, stat stages, and type effectiveness.
3. Convert adjusted power to a damage die.
4. Add calculated `Attack` or `Special Attack` bonus.
5. Apply calculated `Defense` or `Special Defense` modifier.
6. Add recoil, status, recharge, or move text fallout.

## Head-on move clashes

If two moves collide directly, each side rolls:

`d12 + relevant combat bonus + clash power bonus`

Clash power bonus:

- adjusted power `0-29`: `+0`
- adjusted power `30-49`: `+1`
- adjusted power `50-69`: `+2`
- adjusted power `70-89`: `+3`
- adjusted power `90-109`: `+4`
- adjusted power `110-129`: `+5`
- adjusted power `130+`: `+6`

## Trainer combat quick rules

Trainer combat bonus table:

| Trainer stat | Combat bonus |
|---|---:|
| `5-7` | `+0` |
| `8-11` | `+1` |
| `12-15` | `+2` |
| `16-19` | `+3` |
| `20+` | `+4` |

Common stat uses:

- `Strength`: punches, tackles, grapples, hauling
- `Athletics`: throws, dodges, lunges, repositioning
- `Fortitude`: blocks, braces, holds
- `Intelligence`: gadgets, devices, trap triggers

Trainer damage:

- unarmed strike: `1d4`
- baton, tool, or melee weapon: `1d6`
- thrown improvised object: `1d4`

## Grappled

On a successful grapple:

- movement becomes `0`
- physical attacks become clumsier and can take an accuracy penalty
- heavy contact attacks usually drop one damage die step until escape

Breaking free is usually `Strength` or `Athletics` against the grappler.

## Battlemap movement

- trainer and Pokemon do **not** have to move in tandem
- Pokemon movement = **half calculated Speed in feet**
- trainer movement uses Athletics and normal square conversion
- staying within about `30 feet` keeps commands, items, and support clean

## Contest Round 2 quick flow

Start:

- both contestants start at `60 Appeal`
- battle lasts `5` turns
- fainting or being unable to continue loses the match immediately
- faster Pokemon gets tempo advantage on turns `1, 3, and 5`

Turn flow:

1. Both sides declare the move and broad approach.
2. DM states the visible stage read.
3. On turns `1, 3, and 5`, the faster side may change approach.
4. Either side may spend a reaction to change move or declare a combo.
5. Both Pokemon reposition up to half Speed.
6. Roll the opposed contest check.
7. Apply Appeal loss and fallout.

## Contest reaction uses

- **Change move reaction**: switch declared move after reveal
- **Combo reaction**: reveal first move now, hide second move until resolution

Each Pokemon gets up to `2` total reactions for the whole contest and never more than `1` in the same turn.

## Contest stat picks

- **Strength**: overpowering, charging, direct collision
- **Athletics**: dodging, weaving, skimming, evasive timing
- **Intelligence**: shaping, barriers, beam control, setup
- **Fortitude**: bracing, shielding, enduring force
- **Charm**: posture, feints, confidence, winning the room

Common matchups:

- attack into block: `Strength` vs `Fortitude`
- ranged pressure into sidestep: `Intelligence` or `Strength` vs `Athletics`
- setup into rush: `Intelligence` vs `Athletics`
- wall into breaking strike: `Fortitude` or `Intelligence` vs `Strength`

Contest roll:

`d12 + contestBonus(relevant stat) + movePowerBonus`

## Contest move power bonus

| Adjusted move power | Bonus |
|---|---:|
| `0-29` | `+0` |
| `30-49` | `+1` |
| `50-69` | `+2` |
| `70-89` | `+3` |
| `90-109` | `+4` |
| `110-129` | `+5` |
| `130+` | `+6` |

If the clash is head-on and one move would be super effective, multiply that move's power bonus by `1.5`, rounded down.

## Contest Appeal loss bands

| Result band | Appeal loss |
|---|---:|
| Minor | `1d4` |
| Solid | `2d6` |
| Major | `3d6` |
| Reversal | `4d6` |

Use:

- **Minor** for plain success or small stumbles
- **Solid** for clear wins and readable momentum shifts
- **Major** for decisive clashes, stuffed plans, or clean payoff moments
- **Reversal** for match-defining counters, combo reveals, or public humiliations