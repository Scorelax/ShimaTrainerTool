# Move `effects` schema (v2)

`DnD_moves_categorized_draft.json` (real app data — read by `routes_combat.py`'s
`list-move-categories`, served to the client, exposed as `moveEffectsFor(name)`).
A move's `effects` list says **what the move applies, what triggers it, and how it ends**.
Tags in `categories` are *derived* from it — never hand-edit them (see the migration scripts
`build_move_effects.py` → `migrate_effects_v2.py`).

```jsonc
{
  "kind": "condition" | "stat" | "roll" | "temp_hp" | "reroll_damage" | "heal" | "block_attack" | "prevent_faint",
  // condition:  "apply": "<name>", optional "value" (type_changed → "Ghost")
  // stat:       "stat": "<stat>", "amount": -1 | "proficiency" | {"dice": "1d4"}  OR  "set": 0, optional "stacks": {"max": 5}
  // roll:       "roll": "advantage" | "disadvantage", "on": "<roll-on>", optional "ability" (saving_throws only)
  // temp_hp:    "amount": 10 -- a bonus-HP pool, see its own section below
  // reroll_damage: no extra fields -- see its own section below
  // block_attack: no extra fields -- see its own section below
  // prevent_faint: no extra fields -- see its own section below
  // heal:       "amount": {"dice": "2d6", "moveMod?": true, "pool?": "VP"}
  //                     | {"fractionOfDamage": 0.5, "capMultipleOfLevel?": 5, "pool?": "VP"}
  //                     | {"levelMultiple": 1, "pool?": "VP"}       -- see its own section below
  //             "repeat": "end_of_turn" | "start_of_turn"           -- heal-over-time only, see below
  "when":   { "type": ... },        // what triggers it — see below
  "target": "self",                 // only present when the USER is affected (default: the target)
  "ends":   [ ... ],                // how it stops — any ONE entry ending it removes it
  "choice": { "kind": "random", "die": "d6", "roll": 3 } | { "kind": "chosen" },
  "note":   "free text for anything the fields can't carry"
}
```

**`choice`** groups sibling effects (same `choice.kind`/`die` and identical `when`) into one pick in
the effects popup instead of offering them as independent checkboxes (`groupEffects` /
`effects-popup.js`): `"chosen"` is a plain radio pick (Bulk Up: attack OR AC); `"random"` with a
`die` and each option's own `roll` is a "type in what you rolled" table that auto-selects the
matching row (Acupressure's d6 table). Every sibling needs the *same* `choice.kind`/`die`/`when`
to end up in one group — a different `kind` (e.g. a `stat` row next to a `temp_hp` row) is fine,
the grouping never looks at that field.

**`temp_hp`** (Acupressure's "roll a 3: +10 temporary HP") is a real bonus-HP pool, not a stat --
`amount` is its starting size, and the server tracks how much is left as `remaining` on the stored
status (js/utils/move-effects.js's `tempHpRemaining` sums it up for display: a small light-blue
"+N" tag next to the HP number, same convention as a live stat buff's tag). Incoming damage drains
this pool FIRST (`routes_combat.py`'s `_absorb_temp_hp`, called from both damage-application paths)
before touching real HP; the status is removed once it empties. Re-applying the same source's same
move (Acupressure rerolled) replaces the pool outright (the existing non-stacking status path —
matches "any previous effect ends", never partial-carries-over or adds).

**`reroll_damage`** (Attract's "force the attacker to reroll their damage and take the lower
result") is a one-shot correction against an ALREADY-APPLIED damage log entry, never a stored
status — it ships with `ends: [{type:"instant"}]` (the same "announced, never stored" vocabulary
entry `forced_movement` uses) and no other fields; `target` is left unset, same as every other
effect, since it applies to whoever the `save_fail` resolved against (the attacker, not the
move's own user). `combat-wip.js`'s `_offerMoveEffects` special-cases this kind instead of
routing it through `apply-status`: it walks the shared log backwards for the most recent
`damage` entry from that attacker to the reactor, prompts a new roll
(`utils/reroll-damage-popup.js`), takes the lower of the two, and — if that's less than what
was already applied — refunds the reactor's HP by the difference via `update-stats`, the same
client-authoritative correction the Modify Stats buttons already use for HP (no new server
action). No log entry to find (a freeform PvE hit, or the window opened too late) just tells the
table to compare by hand, same fallback tone as every other "can't auto-detect" spot in this app.

**`block_attack`** (Protect, King's Shield, Shield Guardian, Quick Guard) cancels the incoming
attack that opened the reaction window it's used inside of, BEFORE the attack roll -- the first
`protect_negate`-family move actually built. `target: "self"`, `ends: [{type:"instant"}]`, no
other fields: the reactor is always the one applying it (even Shield Guardian, protecting an
ADJACENT ally -- see below), so there's nothing else to configure. `_offerMoveEffects` special-
cases it exactly like `reroll_damage`/`heal`: instead of `apply-status`, it calls a new
`block-pending-attack` action (`routes_combat.py`'s `_block_pending_attack`) which requires the
caller to actually be holding the floor via `reaction-start` for a live `pendingReaction` window
they were eligible for, and records `{windowId, anchorId, attackerId, blockerId, blockerName}`
on a new top-level `reactionBlock` session field -- deliberately separate from `pendingReaction`
itself, since a block can land well before `reaction-end` closes the window, and needs to
survive that close so the ATTACKER's own client (still polling in
`utils/reaction-window.js`'s `waitForReactionWindow`) can see it. That function now resolves to
`{blocked: false}` normally or `{blocked: true, blockerName}`, checked opportunistically every
poll (not just once at the end) and confirmed against the window's own id so a stale block from
an earlier, already-closed window can never bleed into a new one. Only `target-picker.js`'s
`'targeted'`-family caller acts on it (`_afterTargetSelected` closes the popup immediately with
`{blocked: true, ...}` instead of proceeding to the attack roll, and `_resolveOneHit` treats that
exactly like "nothing landed" -- no damage, no further effects, already logged server-side) --
a `'damaged'` reaction is already too late to block anything, and `pickTargetAgain`'s "hit
again?" continuation doesn't reopen a window at all (a multi-hit move's later hits against the
same target already had their one reaction opportunity on the first).

Because eligibility and blocking are both keyed off "who's reacting", not "who's the target",
Shield Guardian's ally-protection case needs no special handling at all: the guardian (not the
attacked ally) is who's eligible (their own `reactionRange: 5` puts them in range of the anchor,
same mechanism Sentinel Strike/Baby-Doll Eyes already use), the guardian is who ends up holding
the floor and applying the effect to themselves (`target: "self"`), and `_block_pending_attack`
reads the ORIGINAL anchor/attacker off the window itself, not off the blocker -- so the right
attack gets cancelled regardless of who actually blocked it.

**Parry** ("make a contested roll... on a higher roll, you take no damage") reuses `block_attack`
as-is rather than needing its own mechanism -- it just isn't auto-offered. `when: {type:
"special"}` (the vocab's own catch-all for "the human judges this entirely", `note` carrying the
contested-roll text) makes `evaluateEffect` return `'manual'` instead of `'yes'`, so the popup
shows it unchecked: the player only ticks it after actually declaring they won the roll, same
"the app shows the structure, a human supplies the outcome" trust model as every other roll in
this app that has no digital dice behind it. No new code, just this one `when` value used for
the first time on a `block_attack` effect.

**`ignoresProtect`** (top-level, alongside `reactionTrigger`/`reactionRange`) is the other half of
"Protect and Detect reactions may not be used when hit by this attack" (Aqua Phase, Fly,
Hyperspace Hole, Phantom Force, Phantom Tendril, Shadow Force, Astral Jet). `_eligible_reactors`
(`routes_combat.py`) now takes the ATTACKING move's own name and, when it carries this flag,
drops any candidate reaction move that has its own `block_attack` effect from the eligible set --
not the whole participant, who may still have some other eligible reaction that isn't
Protect-family. Feint is deliberately NOT one of these: it's the attacker reacting to the
DEFENDER's own declared Protect ("a reaction to a reaction"), a shape this app's turn-authority
model (one floor-holder at a time) doesn't support, so it stays unmigrated.

**Still deliberately left manual, same partial-implementation precedent as everywhere else in
this schema:** every Protect-family move's own escalating "roll over 15 on a d20" cost after the
first use in an encounter (no resource-tracking mechanism for that yet); King's Shield's own
"blocks ALL damage until your next turn", not just the one attack that opened the window (that's
a genuinely different, persisting "immune to damage" status this kind doesn't model, only the
immediate block); Quick Guard's "first round of combat only" gate (already `situational_use`-
tagged). Everything else under `protect_negate` still needs its own separate thing: custom math
on top of blocking (Wide Guard halves instead of negating -- and needs a reaction window inside
an AoE resolution, which `_handleMultiHitAoe` doesn't open at all yet; Spiky Shield reflects
damage back, needing a "deal damage" effect kind that doesn't exist anywhere in this schema; Nature's
Embrace redirects the avoided damage into a brand new attack roll against a different target, a
full reactive mini-attack-flow, not a status), or a third reaction TIMING neither `targeted` nor
`damaged` covers (Lucky Chant needs to intercept after the attack roll -- and whether it was a
crit -- is known, but before damage; crit itself isn't even determined until combat-wip.js's
`_resolveOneHit`, well after target-picker.js's own attack-roll step has already closed, so this
needs real restructuring, not just a new window).

**`prevent_faint`** (Endure's "instead fall to 1 HP") is `reroll_damage`'s own retroactive-
correction shape, not `block_attack`'s -- it fires on the `'damaged'` family (the damage already
landed by the time the reaction window even opens), so there's no attack left to cancel, only
its OUTCOME to override. `target: "self"`, `ends: [{type:"instant"}]`, no other fields.
`_offerMoveEffects` special-cases it the same way as every other one-shot kind: if the target's
`currentHP` is already at or below 0 (the only case "instead of fainting" means anything), it's
set to exactly 1 via `update-stats`, the same client-authoritative HP correction `reroll_damage`'s
own refund and every `heal` effect already use; above 0, it's a no-op (nothing to prevent) rather
than a genuine heal, so it never raises HP that wasn't already fatal. Same escalating "roll over
15 after the first use" cost as the whole Protect family, left manual for the same reason.

**`heal`** restores HP or VP. A ONE-SHOT heal (no `repeat` -- every drain, every plain
heal-on-use move) is never a stored status either, same `ends: [{type:"instant"}]` convention
as `reroll_damage` above, since there's nothing to hold onto after the number is applied. Three
`amount` shapes:
- `{dice: "2d6"}`, optionally `moveMod: true` -- a one-off roll the human enters, same "the app
  shows the structure, a human supplies the number" pattern as every other roll in this app.
  `moveMod: true` adds `pokemon-types.js`'s `bestMoveStatModifier` (the caster's best of the
  move's own allowed stats -- STR/DEX/etc, whichever the move's `moveStat` field names) --
  deliberately NOT `computedData.damageBonus`, which bakes in STAB/Ace Trainer/Type Master/
  held-item bonuses a heal's "+MOVE" text was never talking about (the old combat.js heal
  popups already drew this same line via a plain per-stat switch with no such extras).
- `{fractionOfDamage: 0.5}` -- a drain move's "heal for half the damage dealt": no roll needed,
  computed straight from the damage that was JUST applied (`Math.floor(fraction * damageDealt)`).
  `1.0` for a full-damage drain (Oblivion Wing). `capMultipleOfLevel: 5` (Parabolic Charge's "no
  more than 5x level") clamps the result against the caster's own level, when known.
- `{levelMultiple: 1}` -- no roll either, straight from the caster's own level (Aqua Ring's
  "regain HP equal to your level").

`amount.pool` ('HP', the default, or 'VP') picks which resource a heal updates -- Recompose's
"gain 2d4 + MOVE VP" is a `{dice, pool:"VP"}` heal, otherwise identical to any HP one.

`target` follows the usual convention: `self` for a move that only ever heals its own user
(unset, no picker), left unset for one that heals someone else (`_handleEffectsOnly`'s
multi-target picker, same self+ally split Baby-Doll Eyes/Celebrate already use, and -- since
`pickMultipleTargets` supports selecting several at once -- the same mechanism an "all allies"
AoE heal like Soothing Breeze uses too, no separate AoE heal shape needed) -- a move that can
heal EITHER (Recover, Milk Drink) ships as two separate `heal` effects, one of each, not a
`choice` group (both are independently useful, not mutually exclusive picks).

**`repeat`** ("end_of_turn" | "start_of_turn") turns a `heal` effect into heal-OVER-TIME (Aqua
Ring, Ingrain) -- the one case a `heal` effect DOES become a real stored status (a real `ends`,
e.g. `{type:"concentration"}` for Aqua Ring or `{type:"rounds", n:3}` for Ingrain's "next three
turns", never `instant`), re-triggering its own `amount` fresh every time the HOLDER's own turn
reaches that point while the status is still active -- `pendingTurnHeals`/`_promptTurnHeals`/
`_applyRecurringHeal` (combat-wip.js, mirroring the existing repeat-SAVE machinery,
`pendingTurnSaves`/`_promptTurnSaves`, at the same two turn-boundary hooks) handle it; the
status itself never expires early because of firing, only through its own `ends`. Always
anchored to the STATUS HOLDER's own turn -- a heal delayed to a DIFFERENT participant's turn
boundary (Wish: "at the end of MY [the caster's] next turn", healing someone else entirely)
isn't a shape this covers, see "Not covered yet" below.

`combat-wip.js`'s `_offerMoveEffects` special-cases a one-shot `heal` (`!effect.repeat`) exactly
like `reroll_damage`, intercepting it instead of routing through apply-status: dice/levelMultiple
amounts resolve immediately (a roll popup, or straight from the caster's level), fraction amounts
read `ctx.damageDealt` -- threaded through from whichever damage-application call site actually
hit (`_resolveOneHit`, `_handleSaveTriggered`'s damage branch, and `_handleMultiHitAoe`'s own
save-triggered branch, which SUMS it across every target the blast actually damaged and offers
a self-only fractionOfDamage heal once, after its whole target loop, rather than per target --
Parabolic Charge/Tera Drain heal off the AoE's total, not one target's own share). A `repeat`
heal skips this interception entirely and flows through the normal buildStatusSpec/apply-status
path instead, same as any `stat`/`roll`/`condition` effect. Either way, the eventual HP/VP change
clamps to the target's max and applies through `update-stats`, same client-authoritative
correction `reroll_damage`'s own refund already uses.

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
- **conditions** — standard: `blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained stunned unconscious`; Pokémon-style: `burned frozen asleep confused flinched`; custom: `slowed blink grounded taunted infested seeded cursed trapped drowsy disoriented infected insomnia bleeding type_changed resistance_upgrade granted_immunity removed_from_reality controlled_senses mind_captured watchful_embers perish_song abilities_suppressed forced_movement guaranteed_next_crit`. `guaranteed_next_crit` (Laser Focus) is a standalone flag, not a stat/roll effect — see `guaranteedCritStatusId` below. `type_changed`/`resistance_upgrade`/`granted_immunity` are the type-matchup family — see their own section below.
- **stat**: `ac crit speed attack_rolls damage_rolls saving_throws str dex con int wis cha all_abilities attack_rolls_or_saving_throws` -- `crit` is the number subtracted from 20 to get the crit threshold (see `critThreshold`; +1 = crits on 19-20 instead of just 20), applied like `ac` (a flat delta straight to `critMod`, no derived field). `attack_rolls_or_saving_throws` is a single bonus eligible for either roll type (Growth, Helping Hand) -- spending it on one consumes it for both.
- **roll `on`**: `attack_rolls` (the holder's own) · `attacks_against` (rolls made against the holder) · `saving_throws` (the holder's) · `saves_against_its_moves` · `ability_checks` · `all_rolls`
- **`ability`** (optional, `roll`/`stat` effects on `saving_throws` only): narrows to one ability's saves -- Hammer Arm's "disadvantage on DEX saves" (a plain `saving_throws` roll/stat with no `ability` still applies broadly, to every save, same as before this field existed). `saveRollContext`'s own `ability` param (already threaded through from the save popup) is what it's matched against; nothing analogous exists yet for `attack_rolls`/`ability_checks` (Nasty Plot's "advantage on WIS-power attacks", Study's "advantage vs one specific target" -- neither `attackRollContext` nor `ability_checks` rolls carry enough context to scope against yet, left unmigrated).

## Derived tags
`<family>_<name>` where the family is the guaranteed form for `always`/`on_hit` and `potential_<…>` for anything else, with a `self_` prefix when the user is affected:

- conditions — `status_condition_<c>` / `potential_status_condition_<c>`
- stat — `stat_buff_<stat>` / `stat_debuff_<stat>` / `potential_stat_…`
- roll — `advantage_<on>` / `disadvantage_<on>` / `potential_…`
- reroll_damage — `reroll_damage` / `potential_reroll_damage` (always the latter in practice — it only ever rides on a `save_fail`)
- heal — `heal` / `self_heal` (an `on_hit`-gated drain counts as guaranteed, same as any other `on_hit` effect — never gets a `potential_` prefix)
- block_attack — always `self_block_attack` (`target: "self"` on every move that has it so far, `when: "always"` so never `potential_`)
- prevent_faint — always `self_prevent_faint` (same reasoning as block_attack)

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

**Type matchups** (`_type_multiplier` in routes_combat.py — the server, since damage
resolution already lives there). Three condition names, checked against the DEFENDING
participant's live statuses right before/around the existing type-chart lookup:
- `type_changed` (`value`, optional `value2` — Camouflage, Conversion, Reflect Type)
  swaps in a different type1/type2 BEFORE the chart lookup runs, as if the holder
  actually were that type for the rest of the calculation.
- `resistance_upgrade` (`value`: a type name, or `"all"` — Iron Defense's `"all"` +6 AC,
  Mud Sport's `"Electric"`, Elemental Surge's rolled type) bumps the RESULT one step
  better (`_bump_one_step_better`: vulnerable → normal → resistant → immune) than
  whatever the chart already said — never a flat override, and several sources each
  bump their own step, compounding.
- `granted_immunity` (`value`: a type name — Magnet Rise's `"Ground"`) forces the
  result to 0 outright for that type, ignoring the actual matchup entirely (unlike
  `resistance_upgrade`, there's no baseline to escalate from).

A move whose own text doesn't specify a concrete type (Camouflage/Conversion/Reflect
Type's `type_changed`, Elemental Surge's `resistance_upgrade` — "roll a d20" with no
table given for what each result means) ships with `value` unset; effects-popup.js
shows a dropdown of every game type right there in the popup (`_needsTypeChoice`/
`_typeChoiceInput`, reusing `pokemon-types.js`'s `POKEMON_TYPES` list) and that's what
gets sent. `type_changed` gets a second dropdown too ("single type" by default) for
Reflect Type's dual-type case; `resistance_upgrade` only ever grants against one type
here, so it doesn't.

Not applied yet: `speed` (and conditions' own effects), with ONE exception -- `trapped` now actually
blocks movement: `routes_combat.py`'s `_move_token` (the shared system's only player-driven token
move, see its own module comment) rejects outright for a mover carrying any condition in
`_MOVEMENT_BLOCKING_CONDITIONS` (just `trapped` so far -- Ingrain, Thousand Waves). Everything
else about movement/positioning stays exactly as unbuilt as before: no distance/speed limits, no
terrain-blocking, and no shared switch-Pokemon mechanic at all (`trapped`'s own "cannot be
switched out" half is still only enforced by the legacy combat.js engine's own separate,
Ingrain-specific check) — deliberately scoped this narrow (migrate_effects_v14.py) rather than
opening the full movement/positioning category (~20 moves) or a distance/terrain rules pass.

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

*(Update, same week: `set`-based effects, a "choose which stat" mechanic, and temp-HP are no longer
gaps — see their own sections above. Laser Focus and Guard Split are both done; Power Trick/Power
Split still wait on a "one choice, two paired effects" extension. This paragraph is left as the
original scoping snapshot otherwise — treat the two lists above as current, this one as history.)*

*(Update, 2026-09-23: reaction-triggered effects are no longer a gap either — the reaction-window
mechanism (see its own module docstring in routes_combat.py) plus the new `reroll_damage` kind
above cover all 10 reaction moves now: Noble Roar, Sentinel Strike, and Attract first, then
Withdraw, Baby-Doll Eyes, Hold Hands, Celebrate, Luminous Veil, Conversion 2, and Skyward Soar
(migrate_effects_v11.py) — every one fully structured, though Celebrate and half of Hold Hands
("ally about to attack") only reach the player through the plain manual React button, not the
eligibility system's proactive prompt (see that script's own module docstring: neither trigger
event fits either existing reaction family). No new schema mechanism was needed for any of
these seven — they're all existing kinds (`stat`, `roll`, `condition`) combined with the
self + ally-via-multi-target-picker split Sentinel Strike's own effect first established.)*

*(Update, same day: `drain`/`heal_self`/`heal_target_or_aoe` are no longer a gap category either
— the new `heal` kind above (migrate_effects_v12.py's first 21 moves, migrate_effects_v13.py's
heal-over-time/VP-pool/AoE-summed-drain batch after it) covers plain heals, drains, VP heals, and
Aqua Ring/Ingrain's heal-over-time. Still explicitly NOT covered, each for its own reason (see
migrate_effects_v13.py's own module docstring for the full per-move reasoning): a heal DELAYED to
a different participant's future turn boundary (Wish -- `repeat` only ever anchors to the status
HOLDER's own turn, never the caster's); VP damage doesn't have an application mechanism AT ALL
yet, so a drain reading VP damage dealt has nothing to read (Enervation Ray, Energize, Spite,
Grudge -- the latter two also bundle their own escalating-cost mechanics); a heal conditional on
another not-yet-built mechanic (Purify needs the cure-status action this pass deliberately left
out, see its own note below; Strength Sap needs a "negate an incoming buff and convert its value"
mechanic with zero precedent); a heal that BRANCHES on something this schema can't express
(Present: crit vs. a natural roll ≤2, no "at most" threshold exists, only "at least"; Pollen Puff:
damage-or-heal depending on whether the target is an ally; Harmony Breath: damages enemies AND
heals allies off one shared AoE roll, needs a per-target ally/enemy branch _handleMultiHitAoe
doesn't have); a heal whose amount depends on ANOTHER status's own stack count (Swallow, scaling
with Stockpile); and the pure status-cure moves (Aromatherapy, Heal Bell, Refresh, Scrub Down),
which restore no HP/VP at all -- a different mechanic (removing OTHER participants' statuses
programmatically) entirely out of scope for a heal-amount pass, already reachable by hand via
each status badge's own Remove button.)*
