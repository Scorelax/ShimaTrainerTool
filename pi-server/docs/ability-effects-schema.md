# Ability `effects` schema (v1, draft)

Status 2026-10-09: all 348 abilities done -- 305 with effects, 43 `unknown`, 18 with a Benjakronk
`review` question (`abilities_to_check.md`).

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
                                                  //   ally (the one that triggered it) | allies | enemies |
                                                  //   all (includes itself) | others (all but itself)
                                                  //   (area targets need radiusFt unless the ability says "in battle")
  "radiusFt": 30,
  "chance":   { "die": "d4", "min": 4 },          // "roll a d4, on a 4 ..." (min..max of the die passes)
  "save":     { "ability": "CON", "dc": 12 },     // the AFFECTED creature saves to avoid it;
                                                  //   dc may be a formula string, e.g. "8+proficiency+CON"
  "limit":    { "uses": 1, "per": "short_rest" }, // per: short_rest | long_rest | day | combat | round | turn
                                                  //   short/long rest = the same charge tracker moves use
                                                  //   ("recharge (short rest)" -> {maxCharges, type: 'SR'})
  "optional": true,                               // "may" -- the player decides when it fires
  "reaction": true,                               // using it costs the Pokemon's reaction
  "targetFilter": { "types": ["Grass"], "grounded": true },  // narrows target allies/enemies/all
  "stacks":   { "max": 5 },                       // repeat triggers stack up to N times; temp_hp uses
                                                  //   { "capLevelMultiple": 2 } (pool capped at 2 x level)
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
| `ally_hit` | an ally in `radiusFt` is hit by an attack (Friend Guard) | |
| `attack_roll_against` | an attack roll against it has been rolled, before hit/miss is final (Heavy Metal, Proper Form) | |
| `would_faint` | it would drop to 0 HP (Phantom Body) -- fires before `knocked_out` | |
| `creature_start_of_turn_within` / `creature_end_of_turn_within` | any creature starts / ends its turn within `radiusFt` | |

Extra event filters: `damaged` takes `minFractionOfCurrentHP` (the hit is at least that share of its
current HP -- Sturdy) and `crossesBelowFraction` (the hit takes it from above to below that share of
max HP -- Wimp Out); `hit_by` takes `vulnerable` (a type it is weak to); `condition_gained` takes
`fromMove`; `ally_targeted` takes `includeSelf` and `direct`.

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
| `damage_taken_mod` | `multiplier`, `filter` (`damageTypes`, `melee`, `superEffective`, `vulnerable`, `notTypes`, `crit`, `saveForHalf` + `saveSucceeded`), `firstOnly` (only the first damage while the gate holds), `maxDamage` (dice count as max), `rerollKeep: "lower"` (Prism Armor) |
| `lose_hp` | `amount`, optional `pool: "VP"` -- self-inflicted loss (Dry Skin in sun) |
| `redirect` | the triggering move targets this Pokemon instead; `damageMultiplier` (Lightning Rod: 0.5), `moveAdjacent` + `useOwnAC` (Praetorian Guard) |
| `prevent_faint` | (as moves) it stays up instead of fainting |

**Area and field**

| kind | fields |
|---|---|
| `deal_damage` | `amount`, `damageType`, optional `halfOnSave`, `ignoreResistance` -- damage to `target` (auras, Temporal Collapse) |
| `aura_break` | Dark Aura / Fairy Aura in range halve instead of double |
| `auto_save` | `ability` -- targets automatically pass those saves (Aroma Veil) |
| `suppress_weather_abilities` | every ability whose effects are gated on weather does nothing (Air Lock, Cloud Nine) |
| `suppress_secondary_effects` | `filter` -- matching moves lose their non-damage effects (Pure Waters) |
| `action_cost_override` | `from`, `to` -- moves with that action cost use the other one instead (Dazzling) |

**Turn economy and faint**

| kind | fields |
|---|---|
| `extra_action` | it takes one more action this turn (Moxie) |
| `use_move` | `move`, `free` -- it uses that move right away at no cost (Self-Destructor) |
| `retreat` | `mandatory`, `allowSwitch` -- disengage and move away as a free action; its trainer may (or must) switch it out |

**Type changes:** the moves' `condition` `apply: "type_changed"` with `valueFrom` (`hit_move_type` |
`used_move_type`) instead of a fixed `value`, optional `slot: "primary"`, or `options` (list of types
the player picks from -- Primordial Shift). `type_by_weather` (`map` keyword -> type, `default`) for Forecast.
| `absorb` | `damageTypes`, `healFraction` -- no damage, heals that fraction of it instead |
| `stat_lock` | `stats` (absent = all) -- other creatures can't lower these |
| `retaliate` | `amount` (`{"proficiency":true}`, `{"dice":"1d4","plus":"proficiency"}`, `{"fractionOfDamage":0.5}`), `damageType` -- hits back at `target` |

**Reused from moves:** `stat` (`stat`, `amount` or `set`; new stat names `swim_speed`, `reach`),
`roll` (`roll`, `on` -- plus `on: "initiative"` and an optional `vsConditions` for saves against
specific conditions), `condition` (`apply`, `value`), `heal` (`amount`: `{"proficiency":true}` /
`{"fractionMaxHP":0.0625}` / `{"level":1}` / `{"dice":"2d10"}` / `{"fractionOfAllyHealing":0.5}`;
`setTo: true` sets HP to that amount instead of adding it), `temp_hp` (`amount`: `{"levelMultiple":2}` /
`{"abilityMod":"INT","plusProficiency":true}`), `set_weather` (`name`, `rounds`).
More stat names: `flying_speed`, `saving_throw_abilities` (the ability scores of its saving-throw
proficiencies -- Beast Boost).

`target: "trainer"` -- the Pokemon's trainer (Speed Boost / Unburden: advantage on initiative).

**Information only:** `reveal` (`what`: `super_effective_move` | `strongest_move` | `held_item`) -- a popup at
the right moment, nothing to compute.

**Escape hatch:** `manual` (`note`) -- one part of an otherwise structured ability that the
engine only reminds about (e.g. a lighting rule, a one-off narrative clause).

## Batch C additions (`migrate_abilities_v3.py`)

**`review`** (top level, next to `effects`): `{"with": "Benjakronk", "question": "..."}` -- the effects
are a best guess until it is answered. `abilities_to_check.md` lists them all (regenerated by v3).
A `save.dc` of `null` means the text gives no DC.

**Events:** `activated` (`action`: `1 action` | `1 bonus action` | `free`) -- the player uses the
ability on its turn; `before_attack_roll` (Huge Power: declared before rolling); `berry_eaten`;
`contact` (it touches or is touched -- melee either way); `creature_used_move` (`nameMatch`);
`enemy_switched_in`; `enemy_used_consumable_item`; `save_failed` (`vsNegativeCondition`).
Filters: `hits` takes `naturalRollMin`; `hit_by` takes `ranged`; `targeted` takes `drain`;
`condition_gained` takes `negative`, `fromCreature`, `byEnemy`; `move_used` takes `moves`.

**Gates:** `not` `{gate}`; `dm_confirms` `{text}` (the engine asks the DM); `self_level_at_least`,
`target_level_below`, `target_level_at_least` `{n}`; `target_level_below_self`; `target_marked`
`{mark}` (Predator's prey); `moved_straight_at_least` `{ft}` (Ram); `self_used_berry_this_turn`.

**Targets:** `enemy` (one opponent), `chosen` / `chosen_ally` (the player picks), `touched`,
`self_or_touched`, `self_and_allies`, `other` (whoever it made contact with), `formation`.
`targetFilter` also takes `conditions`, `canSee`, `switchedIn`.

**Ends:** `{"type": "hp_below", "fraction": 0.25}` (Schooling) and `{"type": "move_used", "damaging": true}`
(Stance Change), on top of the moves' shapes.

**Common fields:** `scaling` (`{"5": "2d6", "10": "2d8"}` -- dice by the Pokemon's level; or
`{"10": {"radiusFt": 100}}`), `check` (`{"skill": "Medicine"}`), `contest` (`{"self": "DEX", "target": "WIS"}`),
`pickOne` (one condition from the list), `options` (the player picks one -- also conditions, Vector),
`choice` (as moves: sibling effects grouped into one pick -- `{"kind":"chosen","option":"Attack"}` for
Transformer's forms, `{"kind":"random","die":"d4","roll":2}` for Magnetic Polarity's table).
Amounts: `{"dice":"1d4","timesLevel":true}`, `{"flat":10,"proficiencyMultiple":2}`,
`{"fractionMaxHP":0.1,"round":"up"}`, `{"fractionOfDamageDealt":0.5}`, `{"diceBySize":{...}}`,
`{"dice":"2d10","perClearedStatChange":true}`. Damage filters: `firstUseInEncounter`, `slashing`, `healing`.

| kind | what it does |
|---|---|
| `cure_condition` | `conditions` or `negativeConditions` -- removes them |
| `negate_condition` / `reflect_condition` | the incoming condition doesn't apply / goes to `target` instead |
| `pass_save` | a failed save becomes a pass |
| `invert_condition_damage` | `conditions` -- their damage heals instead (Poison Heal) |
| `invert_stat_changes` | stat changes from moves are reversed (Contrary) |
| `clear_stat_changes` | reverts stat changes in effect (Balance Keeper) |
| `swap_stats` | `stats` -- swap two stats (Stance Change) |
| `ignore_target_abilities` | its moves ignore abilities that would weaken or block them (Mold Breaker) |
| `ignore_target_stat_changes` | ignores the target's boosts (Unaware) |
| `ignore_disadvantage` | `source` (`sight`) |
| `save_ability_override` | `use` -- every save uses this ability's modifier |
| `reroll_ones` | `pool`, `appliesTo` -- luck points (Fortune's Favor) |
| `force_reroll` | any d20 in `radiusFt` is rerolled |
| `reflect_attack` | the attack's damage and effects hit the attacker instead |
| `split_damage` | `pools` -- the damage is split between HP and VP |
| `store_damage` | the damage taken is added to its next damaging move |
| `difficult_terrain` | the area counts as difficult terrain for `target` |
| `negation_zone` | `shape`, `lengthFt`, `exceptMoveTypes`, `exceptSelf` -- moves inside are negated |
| `multi_hit_minimum` | `min` -- multi-hit moves hit at least this many times |
| `no_repeat_move` | can't use the same move two rounds in a row |
| `reaction_move` | it uses one of its moves as a reaction |
| `suppress_ability` / `replace_ability` / `copy_ability` | turn off / swap (`to`, `random`) / copy (`random`, `exclude`) an ability |
| `type_from_held_item` | `item` -- its type follows the held item |
| `no_held_item`, `steal_item`, `copy_item`, `swap_item`, `restore_item`, `consume_held_berry`, `item_use_save` | held-item rules (Klutz, Magician, Pickup, Symbiosis, Harvest, Gluttony, Unnerve) |

Also: `immunity` takes `itemRemoval`, `forcedSwitch`, `hazards`, `surprised`; `resistance` takes
`damageTypes: "all"` + `exceptTypes`, or `"all_not_vulnerable"`, or `valueFrom`; `stat` takes `alsoStats`;
`roll` takes `vsAreaMoves`; `heal` takes `pool: "HP_or_VP"`; `use_move` takes `action`; `ignore_immunity`
takes `conditions`; `condition` takes `ignoreImmunity`.

## Open questions (answered per batch)

- `melee`: moves don't carry a melee marker yet. The engine will have to decide it from the
  move's range (`5ft.` / `Touch` / `Melee`) unless we add one.
- Weather from abilities (`Drizzle` etc.) says "outside battle" -- the engine asks the DM.
