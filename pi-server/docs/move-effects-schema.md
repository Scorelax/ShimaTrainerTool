# Move `effects` schema (v2)

`DnD_moves_categorized_draft.json` (real app data — read by `routes_combat.py`'s
`list-move-categories`, served to the client, exposed as `moveEffectsFor(name)`).
A move's `effects` list says **what the move applies, what triggers it, and how it ends**.
Tags in `categories` are *derived* from it — never hand-edit them (see the migration scripts
`build_move_effects.py` → `migrate_effects_v2.py`).

```jsonc
{
  "kind": "condition" | "stat" | "roll",
  // condition:  "apply": "<name>", optional "value" (type_changed → "Ghost")
  // stat:       "stat": "<stat>", "amount": -1 | "proficiency"  OR  "set": 0, optional "stacks": {"max": 5}
  // roll:       "roll": "advantage" | "disadvantage", "on": "<roll-on>"
  "when":   { "type": ... },        // what triggers it — see below
  "target": "self",                 // only present when the USER is affected (default: the target)
  "ends":   [ ... ],                // how it stops — any ONE entry ending it removes it
  "choice": { "kind": "random", "die": "d6", "roll": 3 } | { "kind": "chosen" },
  "note":   "free text for anything the fields can't carry"
}
```

## `when`
| type | meaning |
|---|---|
| `always` | no roll or save needed |
| `on_hit` | the attack roll hitting is the only requirement |
| `natural_roll` `{min}` | natural attack roll ≥ `min` |
| `crit` | on a critical hit |
| `save_fail` `{ability, failBy?, requires?}` | target fails a save; `failBy` = fail by at least N (absent = any failure); `requires` = `"hit"` \| `"crit"` \| `{type:"natural_roll",min}` when the save only happens after that |
| `special` | see `note` (speed reduced to 0, HP-pool sleep, on a miss, …) |

## `ends` (OR semantics — no `ends` key = removed manually)
| entry | meaning |
|---|---|
| `{type:"rounds", n}` | after `n` rounds (1 minute = 10). Also `{dice:"1d4", unit?}` — rolled by a human at apply time (`unit` = minute/hour, default round) |
| `{type:"until_turn", whose:"holder"\|"source", point:"start"\|"end", count?}` | until that turn point of the status holder / the one who applied it (next occurrence; `count` = how many) |
| `{type:"save", ability, timing:"start_of_turn"\|"end_of_turn"\|"action"}` | holder repeats a save against the source's Move DC; a success ends it. `action` = attempted by spending an action (button on the badge, no auto-prompt) |
| `{type:"concentration"}` | while the source concentrates (removed manually) |
| `{type:"encounter"}` | rest of the battle |
| `{type:"long_rest"}` | until a long rest |
| `{type:"uses", n}` | consumed by the next `n` applicable rolls (see `on`) |
| `{type:"instant"}` | announced only, never stored (e.g. `forced_movement`) |
| `{type:"other", text}` | anything else — shown, removed manually |

## Vocabularies
- **conditions** — standard: `blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained stunned unconscious`; Pokémon-style: `burned frozen asleep confused flinched`; custom: `slowed blink grounded taunted infested seeded cursed trapped drowsy disoriented infected insomnia bleeding type_changed removed_from_reality controlled_senses mind_captured watchful_embers perish_song abilities_suppressed forced_movement`.
- **stat**: `ac speed attack_rolls damage_rolls saving_throws str dex con int wis cha all_abilities`
- **roll `on`**: `attack_rolls` (the holder's own) · `attacks_against` (rolls made against the holder) · `saving_throws` (the holder's) · `saves_against_its_moves` · `ability_checks` · `all_rolls`

## Derived tags
`<family>_<name>` where the family is the guaranteed form for `always`/`on_hit` and `potential_<…>` for anything else, with a `self_` prefix when the user is affected:

- conditions — `status_condition_<c>` / `potential_status_condition_<c>`
- stat — `stat_buff_<stat>` / `stat_debuff_<stat>` / `potential_stat_…`
- roll — `advantage_<on>` / `disadvantage_<on>` / `potential_…`

## How live modifiers are applied (`js/utils/move-effects.js`, shown by the attack / save popups)
The dice are rolled at the table, so the popups only *show* what applies and fold numbers into totals.

| status on… | effect |
|---|---|
| the attacker: `roll` on `attack_rolls` / `all_rolls`, `stat` `attack_rolls` | advantage/disadvantage banner; bonus added to the attack total |
| the target: `roll` on `attacks_against`, `stat` `ac` | advantage/disadvantage banner; AC changed in the hit/miss hint |
| the saver: `roll` on `saving_throws` / `all_rolls`, `stat` `saving_throws`, ability or `all_abilities` stat | advantage/disadvantage banner; save modifier changed (an ability-score change moves the modifier by the difference of `floor((score-10)/2)`; needs the score on the sheet) |
| the move's user: `roll` on `saves_against_its_moves` | advantage/disadvantage for the saver (Night Daze) |

Advantage and disadvantage from different sources cancel to a normal roll (both are still listed). A status with a `uses`
end is used up (`use-status`) when the roll is confirmed — not when a popup is cancelled.

**Stat statuses on the card.** `stat` statuses on AC and the six ability scores (incl. `all_abilities`) move the
combatant card's *current* AC / scores — the same values the Modify Stats buttons edit — so the card, the move popup's
attack bonus, damage bonus and Move DC all follow (`statDeltas` / `reapplyStatDeltas` in `move-effects.js`, applied in
`combat-wip.js`'s `_syncLocalCombatState`). Only the change since the last sync is applied, so manual edits stay and a
removed status gives its points back; the card shows a small +/- next to each modified value. An ability's modifier
moves by the change in its `floor((score-10)/2)` step. Server-record calculations (a reactive save's Move DC) use
`effectiveStats`.

**Scores vs modifiers.** Only the *score* is buffed; the modifier is always derived from it in steps of 2 from 10
(`floor((score-10)/2)`), so a +1 to all abilities moves a modifier — and a Move DC (`8 + proficiency + modifier`) — only
where the score crosses a step (DEX 11→12 gains +1, 10→11 doesn't).

**Manual edits are shared.** The Modify Stats buttons (AC, scores, modifiers, crit modifier) only touch the owner's card, so
they're pushed to the server (`update-base-stats`, `utils/stat-sync.js`) as **base** values — the card's numbers minus the live
status deltas. Every reader (target AC hint, a saver's modifier, an attacker's Move DC and crit range) adds the participant's
`statuses` on top itself (`effectiveStats`), so nothing is counted twice.

Not applied yet: `speed` (and conditions' own effects) — deliberately left for when the condition rules are written.

## Not covered yet
The other stat/advantage moves in the file (`stat_buff_self`, `stat_buff_ally`, `stat_debuff_enemy`,
`potential_disadvantage`, `advantage_on_attack_roll`, …) still use their old flat tags and have no
`effects`. Main-game statuses (burned, poisoned, paralyzed, …) have no `ends`: their removal rules
live in the rulebook, not the move text.
