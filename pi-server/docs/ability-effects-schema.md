# Ability `effects` schema (v1, draft)

`DnD_abilities.json` -- one entry per ability (built from the Pi's cached dex by
`build_abilities_list.py`; the rebuild only refreshes `description` and `pokemon`, so
everything below survives it). Effects are added by `migrate_abilities_vN.py` scripts, the
same way moves are (see `move-effects-schema.md`). The battle page doesn't read this file yet.

```jsonc
{
  "name": "Overgrow",
  "description": "...",
  "pokemon": ["Octodendron", ...],
  "categories": ["unknown"],        // only tag so far: manual by design (out of combat / not modelled)
  "effects": [ { ... }, ... ]       // absent = not tagged yet (backlog); [] + "unknown" = manual
}
```

An ability with **no `effects` key** is backlog. An ability tagged **`unknown`** is manual by
design (mostly out-of-combat abilities) -- the battle page only shows its text, and it is
never counted as backlog. Same rule as `unknown` moves.

## One effect entry

```jsonc
{
  "when":     { "type": <event>, ...filters },    // WHEN it fires -- see Events
  "while":    [ <gate>, ... ],                    // optional: states that must ALL hold -- see Gates
  "kind":     <kind>, ...fields,                  // WHAT it does -- see Kinds
  "target":   "self",                             // who it affects: self (default) | attacker | target |
                                                  //   allies | enemies | all   (allies/enemies/all need radiusFt
                                                  //   unless the ability says "in battle")
  "radiusFt": 30,
  "chance":   { "die": "d4", "min": 4 },          // "roll a d4, on a 4 ..." (min..max of the die passes)
  "save":     { "ability": "CON", "dc": 12 },     // the AFFECTED creature saves to avoid it;
                                                  //   dc may be a formula string, e.g. "8+proficiency+CON"
  "limit":    { "uses": 1, "per": "short_rest" }, // per: short_rest | long_rest | day | combat | round | turn
  "optional": true,                               // "may" -- the player decides when it fires
  "ends":     [ ... ],                            // how a lasting effect stops -- same shapes as moves
                                                  //   ({"type":"until_turn","whose":"holder","point":"end"},
                                                  //    {"type":"uses","n":1}, {"type":"encounter"}, ...)
  "note":     "free text for anything the fields can't carry"
}
```

Several effects that fire together share the same `when`/`while` (Overgrow is two entries:
the dice boost and the VP-cost increase).

## Events (`when.type`)

| type | fires when | optional filters |
|---|---|---|
| `passive` | always on while the Pokemon is in battle | |
| `enter_battle` | the Pokemon enters combat / is sent out | |
| `start_of_turn` / `end_of_turn` | its own turn starts / ends | |
| `start_of_round` | each new round of initiative | |
| `hit_by` | it is hit by an attack | `melee`, `moveTypes`, `damaging`, `superEffective` |
| `damaged` | it takes damage | `moveTypes` |
| `crit_taken` / `crit_dealt` | it suffers / scores a critical hit | |
| `attack_missed` | one of its attacks misses | |
| `hits` | one of its attacks hits | `melee`, `moveTypes` |
| `move_used` | it uses a move | `moveTypes`, `nameMatch` |
| `targeted` | a move targets it | `direct` (single-target only) |
| `ally_targeted` | an ally in `radiusFt` is targeted | `moveTypes`, `damaging` |
| `condition_gained` | a condition is put on it | `conditions` |
| `ko_dealt` | it makes an opponent faint | |
| `ally_fainted` | it sees an ally faint | |
| `knocked_out` | it faints | `melee`, `damaging` |
| `switched_out` | it returns to its Poke Ball | |
| `enemy_attack_roll` | any enemy is about to make an attack roll (Intimidate's "attack roll of your choice") | |
| `ally_drain_heal` | an ally in `radiusFt` heals from damage it dealt (Winter Roots) | |

## Gates (`while`)

The `{type: ...}` shapes the moves' `damage_note` conditions already use, plus a few new ones:

| type | holds when |
|---|---|
| `self_hp_below` `{fraction}` | current HP < fraction x max (Overgrow: 0.25) |
| `self_hp_at_or_below` `{fraction}` | current HP <= fraction x max |
| `self_hp_full` | current HP = max |
| `self_weather_contains` `{any}` | weather name contains a keyword: `sun`, `rain`, `sand`, `hail`, `snow` |
| `self_terrain_contains` `{any}` | terrain under it contains a keyword (`grass`, `electric`, ...) |
| `self_status` `{any}` | it has one of these conditions |
| `self_negative_status` | it has any negative condition |
| `target_status` `{any}` | the creature it attacks has one of these conditions |
| `target_types` `{any}` | the creature it attacks has one of these types |
| `ally_has_ability` `{any}` | an ally in battle has one of these abilities |
| `environment` `{any}` | narrative place (`outside`, `desert`, `arctic`, `coastal`, `swamp`, `rocky`, `water`, `type_habitat`) -- DM-confirmed, the engine asks |
| `self_hp_at_or_above` `{fraction}` | current HP >= fraction x max (Ferocity's 50% tier stops at 25%) |
| `self_no_held_item` | it holds no item |
| `ally_adjacent_to_target` | one of its allies is within 5 ft of the creature it attacks |
| `target_shares_type` | the creature it attacks shares one of its types |
| `combat_round_at_most` `{n}` | combat round <= n |
| `any_of` `{gates}` | at least one of the listed gates holds (weather OR environment) |

## Kinds

**Outgoing damage and attacks** (filters: `moveTypes`, `damaging`, `melee`, `moves` (exact names),
`nameMatch` (substring of the move name), `soundBased` (the move's own marker), `superEffective`,
`attackRoll`, `maxVpCost`, `ownType` (STAB moves), `recoil` (moves with a `recoil` effect),
`negativeCondition` (moves that inflict one))

| kind | fields |
|---|---|
| `damage_mod` | `diceMultiplier` (1.5 = +50% dice), `totalMultiplier`, `flatBonus` (`"proficiency"` / number), `extraDice` (`"2d6"`), `rerollKeep` (`"either"` / `"higher"`), `filter` |
| `stab_mod` | `multiplier` (2 = double STAB), `grant` (gets STAB even off-type), `filter` |
| `ignore_immunity` | `moveTypes`, `vsTypes` -- these moves hit those types anyway (Scrappy) |
| `ignore_protections` | `names` -- bypasses these protection effects (Light Screen, Reflect) |
| `initiative_position` | `position`: `last` |
| `vp_cost_mod` | `multiplier`, `filter` -- with `target: "attacker"` it is the ATTACKER's cost (Pressure) |
| `attack_bonus` | `amount`, `filter` |
| `crit_range` | `amount` (1 = crits on 19-20) |
| `crit_dice_multiplier` | `multiplier` (Sniper: 3) |
| `ignore_resistance` | `filter` |
| `move_type_override` | `from` (type, optional), `filter`, `to` -- the move counts as this type |
| `type_proficiency` | `moveTypes` -- proficient with these moves (STAB) |
| `save_dc_bonus` | `amount` (`"level"` / number), `filter` -- DC of saves its moves force |

**Incoming damage and defences**

| kind | fields |
|---|---|
| `immunity` | any of: `damageTypes`, `conditions`, `negativeConditions` (all of them), `moves` (exact names), `nameMatch`, `soundBased`, `critDamage` (no extra crit damage), `weatherDamage` (`["sand","hail"]`), `allyAttacks`, `recoil`, `opportunityAttacks`, `vulnerabilityExtra` (no extra damage from its weaknesses), `nonVulnerableDamage` (Wonder Guard) |
| `resistance` / `vulnerability` | `damageTypes` |
| `damage_taken_mod` | `multiplier`, `filter` (`damageTypes`, `melee`, `superEffective`, `vulnerable`, `notTypes`, `crit`, `saveForHalf` + `saveSucceeded`), `firstOnly` (only the first damage while the gate holds), `maxDamage` (dice count as max) |
| `lose_hp` | `amount`, optional `pool: "VP"` -- self-inflicted loss (Dry Skin in sun) |
| `absorb` | `damageTypes`, `healFraction` -- no damage, heals that fraction of it instead |
| `stat_lock` | `stats` (absent = all) -- other creatures can't lower these |
| `retaliate` | `amount` (`{"proficiency":true}`, `{"dice":"1d4","plus":"proficiency"}`, `{"fractionOfDamage":0.5}`), `damageType` -- hits back at `target` |

**Reused from moves:** `stat` (`stat`, `amount` or `set`; new stat names `swim_speed`, `reach`),
`roll` (`roll`, `on` -- plus `on: "initiative"` and an optional `vsConditions` for saves against
specific conditions), `condition` (`apply`, `value`), `heal` (`amount`: `{"proficiency":true}` /
`{"fractionMaxHP":0.0625}` / `{"level":1}` / `{"dice":"2d10"}` / `{"fractionOfAllyHealing":0.5}`),
`temp_hp`, `set_weather` (`name`, `rounds`).

`target: "trainer"` -- the Pokemon's trainer (Speed Boost / Unburden: advantage on initiative).

**Information only:** `reveal` (`what`: `super_effective_move` | `strongest_move` | `held_item`) -- a popup at
the right moment, nothing to compute.

**Escape hatch:** `manual` (`note`) -- one part of an otherwise structured ability that the
engine only reminds about (e.g. a lighting rule, a one-off narrative clause).

## Open questions (answered per batch)

- `melee`: moves don't carry a melee marker yet. The engine will have to decide it from the
  move's range (`5ft.` / `Touch` / `Melee`) unless we add one.
- Weather from abilities (`Drizzle` etc.) says "outside battle" -- the engine asks the DM.
