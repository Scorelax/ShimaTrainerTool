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
  // stat:       "stat": "<stat>", "amount": -1 | "proficiency" | {"dice": "1d4"}  OR  "set": 0, optional "stacks": {"max": 5}
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
- **conditions** — standard: `blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained stunned unconscious`; Pokémon-style: `burned frozen asleep confused flinched`; custom: `slowed blink grounded taunted infested seeded cursed trapped drowsy disoriented infected insomnia bleeding type_changed removed_from_reality controlled_senses mind_captured watchful_embers perish_song abilities_suppressed forced_movement guaranteed_next_crit`. `guaranteed_next_crit` (Laser Focus) is a standalone flag, not a stat/roll effect — see `guaranteedCritStatusId` below.
- **stat**: `ac crit speed attack_rolls damage_rolls saving_throws str dex con int wis cha all_abilities attack_rolls_or_saving_throws` -- `crit` is the number subtracted from 20 to get the crit threshold (see `critThreshold`; +1 = crits on 19-20 instead of just 20), applied like `ac` (a flat delta straight to `critMod`, no derived field). `attack_rolls_or_saving_throws` is a single bonus eligible for either roll type (Growth, Helping Hand) -- spending it on one consumes it for both.
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

**Dice-based bonuses (`amount: {dice: "1d4"}`).** Sharpen/Growth/Aromatic Mist/Helping
Hand-style moves ("you may add 1d4 to..."): the bonus is rolled at the table when the
player actually chooses to spend it, not folded into every roll automatically like a
flat number or `'proficiency'` (`statDeltas`/`attackRollContext`/`saveRollContext`
skip it entirely — see `move-effects.js`'s `_isDiceAmount`). `diceBonusOptionsFor
(participant, rollType)` lists what's available for an `'attack_rolls'` or
`'saving_throws'` roll; the target-picker's attack-roll step and the save-picker's
save-roll step each show a button per option ("Add Sharpen (+1d4)"), which expands to
a small inline input for what was rolled, folds it into the total shown, and — only
if the status has a `uses` end (Helping Hand) — consumes it once the roll is
confirmed. No `uses` end (Sharpen/Growth/Aromatic Mist) means it just stays available
for the rest of its duration, offered again next time an eligible roll comes up; the
player is never forced to spend it on the first opportunity.

**Concentration grouping.** Any status whose `ends` includes `{type:'concentration'}`
(`isConcentration`) is pulled into one "🧠 Concentration" badge on the card/focus panel
instead of showing as its own separate badge, so every concentration effect currently
being maintained reads as one umbrella at a glance — each one underneath is still its
own clickable badge (same detail popup, same use-status wiring), this is display
grouping only, no schema change.

**`set` on a `stat` effect** (Superpower's "STR and DEX set to 10", Guard Split's AC
averaged with the target) FORCES the field to an exact value instead of shifting it by
an amount — `statSetOverrides(participant)` reads it (parallel to `statDeltas`, never
combined with it), and `reapplyStatDeltas`/`baseStats`/`effectiveStats` all have a
dedicated path for it: while active the card/record shows exactly that number, no
matter what any delta on the same field would otherwise add up to; the pre-override
value (and a score's modifier, preserving any sheet offset) is snapshotted the instant
the override starts and restored the instant it ends, with that round's own delta (if
any) applied on top of the restored value, same as normal. The number itself is always
resolved to a plain literal ONCE, at apply time — never a live formula re-evaluated
later. A literal (`set: 10`) needs nothing further; a sentinel object is resolved by
combat-wip.js's `_offerMoveEffects` right before the status is sent: `{avgWithTarget:
"ac"}` (Guard Split) reads the caster's and the chosen target's CURRENT effective value
and floors the average, applied to the caster (`target: 'self'`) — from that point on
it's stored as the same plain number as everything else. Superpower needed nothing but
the literal; Power Trick (swap AC with an ability score) and Power Split (replace a
CHOSEN score with an average) both also need a "player picks which stat" mechanic that
doesn't exist yet — held for that category rather than guessed here.

Not applied yet: `speed` (and conditions' own effects) — deliberately left for when the condition rules are written.

## Not covered yet (2026-09-22 scoping pass over the ~597 remaining moves)
Of the moves still on their old flat tags, only a subset (~172) are stat/advantage moves that fit this schema
at all (`stat_buff_self/ally`, `stat_debuff_enemy/self`, `advantage_on_attack_roll`, `potential_disadvantage`,
`crit_range_mod`, `boosted_attack_rolls`, `boosted_damage_rolls`, `advantage_on_saving_throws`,
`potential_stat_increase`, `increase_stab`) — and even most of those need something this schema doesn't have
yet: reaction-triggered effects (Attract, Noble Roar, Celebrate, …), once-per-rest resource tracking
(Roar of Time, Overheat, …), `set`-based stat effects (see above), a "choose which stat" mechanic (Power
Trick, Guard Split), type-changing, resistance/immunity, temp-HP/shields, and VP-cost modifiers. `crit_range_mod`
alone split into two unrelated things: ten moves whose own fixed "crits on 19-20" is already fully handled by
the existing `base_crit` tag (no `effects` needed at all), and Focus Energy/Laser Focus, genuine live crit-range
buffs (Focus Energy done above; Laser Focus deferred, needs `set`). The other ~380 moves (`counter_reaction_effect`,
`protect_negate`, `heal_self`/`heal_target_or_aoe`, `drain`, `positioning`, `field_terrain`/`field_weather`,
`recoil`, `attack_suppression`, `shield_temphp`, cumulative-damage-on-consecutive-turns like Rollout/Ice Ball) need
new effect kinds entirely, or already work through a separate, older mechanism (e.g. move-popup.js's
description-regex drain/direct-heal detection) that isn't part of this schema. Main-game statuses (burned,
poisoned, paralyzed, …) have no `ends`: their removal rules live in the rulebook, not the move text.
