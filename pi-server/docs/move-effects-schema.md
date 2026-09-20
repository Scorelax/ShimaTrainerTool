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

## Not covered yet
The other stat/advantage moves in the file (`stat_buff_self`, `stat_buff_ally`, `stat_debuff_enemy`,
`potential_disadvantage`, `advantage_on_attack_roll`, …) still use their old flat tags and have no
`effects`. Main-game statuses (burned, poisoned, paralyzed, …) have no `ends`: their removal rules
live in the rulebook, not the move text.
