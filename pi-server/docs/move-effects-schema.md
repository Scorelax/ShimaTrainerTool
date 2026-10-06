# Move `effects` schema (v2)

`DnD_moves_categorized_draft.json` (real app data — read by `routes_combat.py`'s
`list-move-categories`, served to the client, exposed as `moveEffectsFor(name)`).
A move's `effects` list says **what the move applies, what triggers it, and how it ends**.
Tags in `categories` are *derived* from it — never hand-edit them (see the migration scripts
`build_move_effects.py` → `migrate_effects_v2.py`).

```jsonc
{
  "kind": "condition" | "stat" | "roll" | "temp_hp" | "reroll_damage" | "heal" | "block_attack" | "prevent_faint" | "stat_transfer" | "damage_note",
  // condition:  "apply": "<name>", optional "value" (type_changed → "Ghost")
  // stat:       "stat": "<stat>", "amount": -1 | "proficiency" | {"dice": "1d4"}  OR  "set": 0, optional "stacks": {"max": 5}
  // roll:       "roll": "advantage" | "disadvantage", "on": "<roll-on>", optional "ability" (saving_throws only)
  // temp_hp:    "amount": 10 -- a bonus-HP pool, see its own section below
  // reroll_damage: no extra fields -- see its own section below
  // block_attack: no extra fields -- see its own section below
  // prevent_faint: no extra fields -- see its own section below
  // stat_transfer: "mode": "dispel" | "dispel_all" | "copy" | "swap" | "steal" -- see its own section below
  // damage_note: "condition": {...}, "diceMultiplier?"/"totalMultiplier?"/"flatBonus?"/
  //              "scalingBonus?"/"advantage?" -- see its own section below; NOT a when/target/ends
  //              effect at all, see why there
  // heal:       "amount": {"dice": "2d6", "moveMod?": true, "pool?": "VP"}
  //                     | {"fractionOfDamage": 0.5, "capMultipleOfLevel?": 5, "pool?": "VP"}
  //                     | {"levelMultiple": 1, "pool?": "VP"}       -- see its own section below
  //             "repeat": "end_of_turn" | "start_of_turn"           -- heal-over-time only, see below
  //             "healTargetId?": "<participantId>"                  -- Wish only, see below
  "when":   { "type": ... },        // what triggers it — see below (damage_note has no `when` at all)
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
`amount` is its starting size, either a plain number or `{fractionOfMaxHP: 0.5}` (Divine Noodle
Form's own "half of your current max HP", resolved against the holder's own live `maxHP` in
`_offerMoveEffects`, same dynamic-value-resolution convention `avgWithTarget`/
`fromPendingReactionMove` already use). The server tracks how much is left as `remaining` on the stored
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

**`stat_transfer`** (Clear Smog/Psych Up/Heart Swap/Spectral Thief/Haze) reads the currently active
statuses on one or two participants and removes/copies/swaps/steals them -- never stored as a status
itself, a one-shot bulk operation against whatever's already live, same "intercepted before
`apply-status`" treatment as `reroll_damage`/`block_attack`/`prevent_faint`. `mode` picks the shape:
`"dispel"` (Clear Smog -- remove every one of the target's own `kind:'stat'` statuses only),
`"dispel_all"` (Haze -- broader: remove EVERY status regardless of kind, "stat bonuses, status
effects, shields ... are removed"), `"copy"` (Psych Up -- recreate the target's `kind:'stat'`
statuses onto the user, target's own copy untouched), `"swap"` (Heart Swap -- exchange BOTH sides'
current `kind:'stat'` ones), `"steal"` (Spectral Thief -- move only the target's POSITIVE
`kind:'stat'` ones onto the user, removed from the target). `combat-wip.js`'s `_handleStatTransfer`
does the actual work via plain `apply-status`/`remove-status` calls -- a recreated status keeps its
ORIGINAL `sourceId`/`sourceName`/`moveName`/`dc` (a copied Focus Energy still reads "from Focus
Energy", not from the transfer move itself), only the delta moves. Remaining duration isn't preserved
exactly -- a recreated status restarts from its own authored `ends` (e.g. a fresh 10 rounds) rather
than however many were actually left on the original, a documented simplification. `no other fields`
beyond `mode`/`when`/`ends: [{type:"instant"}]`/`target`. `target` is usually left unset (shown under
the target section, same convention as any other move that does something TO the target) but
`dispel_all` is the one mode that CAN be authored `target:"self"` too (Haze hits its own blast
radius, caster included) -- `_offerMoveEffects`'s own call site reads `pick.targetId`, not a closure
variable, specifically so a single-participant mode correctly resolves to the caster for a
`target:"self"` effect and to the real target otherwise (`swap` is unaffected, it always reads both
sides regardless).

Deliberately NOT this kind: moving or copying a SINGLE CHOSEN stat (Guard Swap/Power Swap/Role
Play -- these need a small "which one" picker first, not built yet) or transferring a named
CONDITION rather than a stat (Psycho Shift) -- both real, both held for their own slice.

**`damage_note`** is a genuinely different shape from every other kind, and the user's own
correction of an earlier, wrong call in this schema's history: `conditional_damage`-tagged moves
(Facade, Flail, Water Spout, ...) were first written off as "nothing to model, the human already
does the damage math when they enter their roll" -- true for the ARITHMETIC, but not the point.
The app has no digital dice and never will, but forgetting a move's own damage bonus applies at
all, mid-battle, against a table full of opponents, is exactly the kind of thing this app's other
reminders (an advantage banner, an AC hint, a dice-bonus button) already exist to prevent. So
`damage_note` doesn't touch the dice roll itself -- it changes what the move-use popup SHOWS
before the human ever rolls, the same "the app surfaces the number, a human acts on it" pattern as
everywhere else, just for the damage-formula text instead of a roll banner.

Not a `when`/`target`/`ends` effect at all, and evaluated in TWO different places depending on
whether `condition` needs a target or not:
- Self-conditional (`self_*`) -- `combat.js`'s own `showCombatMoveDetails` (`_evaluateDamageNotes`),
  at move-popup display time, against the ATTACKER's own already-known HP/status -- no target
  needed yet.
- Target-conditional (everything else) -- `target-picker.js`'s own `_showStep3`
  (`move-effects.js`'s `targetDamageNoteResult`), once a target is actually picked, in its damage-
  roll step instead of the move-popup.

Neither ever goes through `_offerMoveEffects`'s post-attack confirmation flow every other kind
goes through -- there's nothing to confirm AFTER the fact here, the whole point is showing it
BEFORE the roll.

`condition` is one of:
- `{type: "self_hp_below", fraction: 0.5}` / `{type: "self_hp_at_or_below", fraction: 0.1}` --
  strict-less-than vs at-or-below, matching each move's own exact wording (Flail's two tiers use
  both: "below 50%" for the ×2 tier, "at 10% or below" for the ×3 one).
- `{type: "self_status", any: ["Poison", "Paralysis", "Burn"]}` -- checked against the same legacy
  display names both engines' own status badges already use (`combat-wip.js`'s
  `LEGACY_BADGE_NAMES` maps a structured `poisoned`/`burned`/`paralyzed` condition to these exact
  strings), so this works identically whether the attacker came from the shared system or the old
  local engine.
- `{type: "target_hp_below"|"target_hp_at_or_below"|"target_hp_above", fraction: 0.5}` -- the
  target-conditional counterpart to `self_hp_*` (Brine's "target below 50%", Crush Grip's "target
  ABOVE 50%" -- the one case that needed a third comparison direction self-conditional moves
  never did).
- `{type: "target_status", any: ["poisoned", "paralyzed"]}` -- the target-conditional counterpart
  to `self_status`, but checked against real `apply` values directly (lowercase), not legacy
  display names: `target-picker.js` only ever has the RAW structured session participant to work
  with (`_selectedTarget`/`_attacker`, straight off `session.participants`), unlike a self-check
  that might be reading a legacy-engine `c.statusEffects` badge -- there's no second shape to
  reconcile with here, so the cleaner form is used instead of matching self_status's convention.
- `{type: "target_has_any_status"}` -- Hex's "affected by A status condition" (no specific list),
  true whenever the target's own `statuses` array is non-empty.
- `{type: "attacker_stat_below_target", stat: "dex"}` -- Gyro Ball's own stat comparison; checked
  against each participant's raw score (`attacker.dex`/`target.dex`), not a live-buffed one.
- `{type: "target_hp_at_or_above", fraction: 0.5}` -- Wring Out's "50% or more", the missing fourth
  comparison direction alongside `target_hp_below/at_or_below/above`.
- `{type: "self_hp_at_or_above", fraction: 1.0}` -- Eruption's own "if at full health", the
  self-conditional side's missing counterpart to `target_hp_at_or_above` (had never come up before).
- `{type: "attack_roll_at_least", min: 10}` (target-conditional only) -- Charge Beam's own "if the
  natural attack roll is 10 or higher (and it hits)" -- the natural d20 already entered in the
  attack-roll step (target-picker.js's own `_attackRoll`), threaded into `targetDamageNoteResult` as
  `attackRoll` since the damage-roll step (where `damage_note` effects are evaluated) comes after it.
  `null` (a guaranteed-hit attack that skipped the roll entirely) never meets this.
- `{type: "self_active_buff_count"}` / `{type: "target_active_buff_count", statFields?: [...]}` --
  Power Trip's "add a damage die for each positive stat change affecting you" / Punishment's target-
  side mirror ("... boosting the target's attack, damage, or AC"), via a new
  `activeBuffCount(participant, statFields)`: counts the holder's own active `kind:'stat'` statuses
  with a positive resolved amount (stacks applied); `statFields` (target-side only so far) narrows to
  specific `stat` names. A `set` override never counts -- no baseline to compare it against (same
  reasoning `statSetOverrides` itself documents). The self-conditional side needed a small bridging
  addition: `combat.js`'s own evaluator only ever sees the LOCAL merged combatant, which has no raw
  `.statuses` list to count from (unlike the target-conditional side, which already reads the raw
  session participant directly) -- fixed the same way Archive Blast's own `witnessedMoveTypes` did, a
  WIP-only `merged.activeBuffCount` field bridged on in `combat-wip.js`'s `_syncLocalCombatState`
  (quietly reads 0 on the legacy standalone engine, same limitation `witnessedMoveTypes` already has).
- `{type: "self_consecutive_move_hits", cap?: <number>, maxStreak?: <number>}` (self-conditional
  only) -- Fury Cutter/Ice Ball/Rollout's own "double the dice each consecutive [turn/round] you hit
  with this move". Magnitude IS the final, already-capped multiplier (fed straight into
  `diceMultiplierFromMagnitude` above), from a new `_lastHitMoveStreak(session, pid)` log-scan
  (`combat-wip.js`) bridged onto the combatant as WIP-only `merged.lastHitMoveStreak` (same pattern as
  `activeBuffCount`/`witnessedMoveTypes`): a miss never reaches the damage-logging step, and an
  incapacitated participant can't have used a move at all, so the mere ABSENCE of a matching `damage`
  log entry for a given round already covers those two reset conditions for free. Two cap shapes, per
  each move's own text, both resolved through a shared `_consecutiveHitPosition(rawCount, cond)`
  helper so the damage multiplier and the VP-cost escalation below always agree on where in the streak
  a given use actually is: `cap` (Fury Cutter/Ice Ball -- position never wraps, the multiplier itself
  tops out and stays there, but VP cost keeps climbing right along with it, matching the move's own
  text stating no VP cap) or `maxStreak` (Rollout -- position wraps every `maxStreak` hits: reaching it
  is the last escalated hit of one cycle, VP cost included, and the next hit restarts a fresh cycle
  from position 0 rather than getting stuck at the reset value forever). Also drives the escalating VP
  cost itself (+1 per position, `combat.js`'s own `showCombatMoveDetails` computing it independently of
  the dice-override branch and passing it to `move-popup.js` as a new `vpCostOverride` param, shown and
  deducted in place of the move's own flat `vpCost`). NOT checked: Ice Ball/Rollout's own "also resets
  if speed is reduced to 0" (a narrow edge case) -- surfaced as a plain `note` reminder instead of
  silently dropped.
- `{type: "self_move_used_this_round", anyOf: [...]}` -- Fusion Bolt/Fusion Flare's own "if [either
  move in this pair] was already used this round, double the damage". `c.movesUsedThisRound` is
  WIP-only (`combat-wip.js`'s `_movesUsedThisRound` -- every move name used by ANYONE so far this
  round, straight off `'move-used'` log entries), same bridging pattern as `activeBuffCount`/
  `witnessedMoveTypes`/`lastHitMoveStreak`.
- `{type: "self_last_attack_missed"}` -- Stomping Tantrum's own "if your last attack missed, double
  the dice". `c.lastAttackMissed` is WIP-only (`_didLastAttackMiss` -- walks the log backward for
  this participant's own most recent `'damage'` or `'miss'` entry, whichever comes first; not
  bounded by round, since "your last attack" means whenever that actually was, even earlier the
  same round).
- `{type: "target_damaged_me_this_round"}` (target-conditional only) -- Avalanche/Payback's own "if
  the target has damaged you [since the end of your last turn / earlier this round], double the
  damage". The one target-conditional check that needs the shared LOG, which
  `_targetConditionMet`/`targetDamageNoteResult` deliberately never reach into themselves (pure
  functions over explicit params) -- resolved by the CALLER instead (`target-picker.js` keeps its
  own one-time `log`/`round` snapshot, taken alongside `_attacker` at `pickTarget`'s own start, and
  passes a plain computed boolean through as `targetDamagedMeThisRound`). Avalanche's own "since the
  end of your last turn" is approximated as "this round" -- correct when each combatant acts once
  per round, a documented simplification rather than tracking exact turn boundaries per participant.
- `{type: "target_type", any: ["poison"]}` -- Solvent Spray's "double damage to Poison-type
  Pokémon", checked against the target's `type1`/`type2` (case-insensitively), not a live matchup
  chart lookup -- this is about the target's own species type, not effectiveness.
- `{type: "attacker_max_speed_above_target"}` -- Electro Ball's own "compare the target and user's
  highest speed type": the FASTEST of each participant's own `speeds` (walking/flying/swimming/...,
  the movement-tracking field from the battle map's own work this session), not a single flat stat
  like `attacker_stat_below_target` reads.
- `{type: "attacker_size_above_target"}` -- Heavy Slam's own size comparison, on the move's own
  named scale (Tiny/Small/Medium/Large/Huge/Gigantic -- `move-effects.js`'s own `_SIZE_RANK`), not
  `footprintForSize`'s cruder Tiny/Small/Medium-vs-Large/Huge grid-footprint split. Blank/
  unrecognized (every trainer, who carries no `size` at all) defaults to Medium. Also the
  `scalingBonus` magnitude source for this condition (see below) -- however many size levels the
  attacker outranks the target by.
- `{type: "self_weather_contains", any: ["sun"]}` -- Solar Beam/Solar Blade's own "if used in
  harsh sunlight", checked against the shared session's `weather` field (`{name, effect}`, freeform
  DM-typed text, `routes_combat.py`'s `set-weather` -- moved onto the session from a single
  device's own local storage specifically so a check like this is visible to whoever's USING the
  move, not just the DM's own screen). A loose case-insensitive SUBSTRING match, not an exact
  name -- same "close enough" trust level as everything else freeform in this app.
- `{type: "self_vp_spent_per", per: 10}` / `{type: "self_loyalty_below_zero"}` /
  `{type: "self_loyalty_above_zero"}` -- the three `scalingBonus` conditions (see below): each
  reports a MAGNITUDE (how many "units" apply), not just met/not-met. VP spent is approximated as
  `maxVp - currentVp` (Trump Card's own wording, same approximation level as everything else
  derived in this app); Loyalty is a plain signed number already on the sheet (`pokemonData[33]`),
  read straight onto the combatant as `loyalty`.

Result fields (not all mutually exclusive -- `flatBonus`, `scalingBonus` and `advantage` all
accumulate/OR across every MET effect on a move, since nothing needs the "only the most severe
tier" reasoning `diceMultiplier` does; a move only ever uses ONE of `diceMultiplier`/`diceOverride`/
`totalMultiplier`/`flatBonus`/`scalingBonus`/`advantage` per effect, but different effects on the
same move could combine them in principle):
- `diceMultiplier: 2` recomputes the shown dice STRING itself ("2d8" → "4d8",
  `move-effects.js`'s exported `multiplyDiceString`, shared by both the self- and target-
  conditional sides) -- multiplying the leading number is the same arithmetic as rolling that many
  more of the same die, which is what "double/triple the dice" consistently means across this
  dataset's own move text (Facade's "double the dice", Smelling Salts/Venoshock/Gyro Ball's
  "double the dice roll"). Several tiers on one move (Flail) resolve to whichever MET condition
  has the highest multiplier, never stacked -- being at 10% HP already implies being below 50%
  too, so both conditions are "met" at once and only the more severe one should show. On the
  target-conditional side this is shown as a REMINDER only (`target-picker.js`'s damage-roll step
  never had a base-dice display to literally change, unlike the move-popup's own `diceOverride`
  hook) -- "Roll 4d10 instead of 2d10" next to the plain roll input.
- `diceMultiplierFromMagnitude: true` (self-conditional only, Fury Cutter/Ice Ball/Rollout) -- same
  `diceMultiplier` display/application path, but sourced from the condition's own magnitude instead
  of a fixed per-effect number: `self_consecutive_move_hits` (see its own section below) already
  resolves that magnitude to the final, already-capped multiplier, so this field just says "use it."
- `nextTierOrDouble: true` (target-conditional only, Electro Ball) -- a different kind of dice
  change from `diceMultiplier`: swaps in the move's own NEXT damage tier (the caller's
  `computedData.nextTierDice`, `pokemon-types.js`'s `nextTierDamageDice` -- the smallest scaling
  threshold ABOVE the attacker's current level, e.g. 2d6 → 2d8) via the result's own `diceOverride`
  field, since multiplying the current dice would give the wrong number (2d6 doubled is 4d6, not
  the real next tier 2d8). Once already at the highest tier (`nextTierDice` is null -- there's
  nothing left to swap to), falls back to a plain `diceMultiplier: 2` instead -- the move's own
  two sentences ("roll the next tier's dice" / "level 17+: double the damage dice") turn out to be
  the SAME rule with a different mechanic depending on whether a higher tier still exists, not two
  independent conditions.
- `totalMultiplier: 0.5` (self-conditional only so far) shows as a plain note instead (the popup's
  existing `noteText` banner, previously Stockpile-only) rather than touching the dice string at
  all -- Water Spout's own text says "halve the TOTAL damage done", not the dice, and those aren't
  the same thing: a flat MOVE modifier doesn't halve along with a halved die count, and the two
  produce different distributions even at the same average. Safer to say so in words than assert a
  recomputed number that might be wrong.
- `flatBonus: "proficiency"`, `"moveModifier"`, or a plain number -- Crush Grip's own "add your
  proficiency bonus to the damage roll" (target-conditional only); `"moveModifier"` is one more
  copy of the move's own stat modifier (`computedData.highestMod`) and works on EITHER side now:
  Wring Out (target-conditional, "double your move modifier" if the target's above 50% HP,
  threaded through `pickTarget`/`pickTargetAgain` as `moveModValue`) and Solar Beam/Solar Blade
  (self-conditional, "double your move modifier" in harsh sunlight, passed straight into
  `_evaluateDamageNotes`) both read the exact same value the move-popup's own dice breakdown
  already showed, never re-derived; a plain number works on either side too. Target-conditional:
  folded straight into the returned `rawRoll` the same way `target-picker.js`'s existing
  `damageModifier` param already was. Self-conditional: folded into the popup's own
  `diceOverride`/`diceBreakdownOverride`, alongside `computedData.damageBonus`.
- `scalingBonus: {amountPerUnit: "moveModifier" | <number>, cap?: <number>}` -- a bonus that scales
  with the condition's own MAGNITUDE rather than a fixed amount: `bonus = magnitude * amountPerUnit`,
  clamped to `cap` when given. Self-conditional (combat.js's own evaluator): Trump Card's
  `magnitude` is VP spent ÷ 10 (rounded down), `amountPerUnit: "moveModifier"`, `cap: 10` ("up to a
  maximum of +10"); Frustration/Return's `magnitude` is the Loyalty Chart distance from zero,
  `amountPerUnit: 1`, no cap (the move text states none) -- both of these also read "add this to
  your ATTACK roll too, not just damage", folded into `note` as a reminder instead since
  `scalingBonus` only ever touches the damage total, same "the app can't auto-apply it, so it says
  so" pattern as `totalMultiplier`. Target-conditional (`move-effects.js`'s own
  `_targetConditionMagnitude`): Heavy Slam's `magnitude` is however many size levels the attacker
  outranks the target by (`attacker_size_above_target`'s own magnitude), `amountPerUnit:
  "moveModifier"`, no cap.
- `advantage: true` (both sides) -- Cross Poison/Hex's "damage is rolled with advantage": shown as
  its own banner ("roll damage twice, take the higher"), the same "the app surfaces the instruction,
  the human rolls accordingly" pattern as every other advantage/disadvantage banner in this app, just
  for a damage roll instead of an attack/save one (this schema's `roll` kind has no `damage_rolls`
  target at all -- `damage_note`'s own `advantage` field is what covers it instead, display-only,
  same as everything else here). Self-conditional support (Eruption, "if at full health") came later
  than the target-conditional side (Cross Poison/Hex) -- shown as a plain `noteText` banner, the same
  slot `totalMultiplier`'s own note already uses.
- `extraDice: {amountPerUnit: <number>, cap?: <number>}` -- Power Trip/Punishment's own "add an
  additional damage die [of the move's own size] for each...", via a new `addDiceString(dice, n)`
  helper ("1d4" + 2 -> "3d4"). Deliberately NOT `scalingBonus` -- that adds a flat NUMBER per unit,
  which would silently substitute a fixed number for real extra dice and distort both the average
  and the variance, especially for a small die. Self-conditional (Power Trip, magnitude from
  `self_active_buff_count`): actually recomputes the popup's own dice string/breakdown, same as
  `diceMultiplier` already does, composing with it if a move ever had both (none do yet -- multiply
  first, then add). Target-conditional (Punishment, magnitude from `target_active_buff_count`):
  shown as a reminder only in target-picker.js's damage-roll step, same treatment `diceMultiplier`
  already gets there (that popup never had a live dice-override slot to begin with).

`note` is shown alongside whichever of the above applies (the dice breakdown line, or the note
banner directly, for `totalMultiplier`). A ONE-SHOT heal (no `repeat` -- every drain, every plain
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
| `natural_roll` `{min}` | natural attack roll ≥ `min`, only on a hit |
| `natural_roll_at_most` `{max}` | natural attack roll ≤ `max`, regardless of hit or miss (Present) |
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
- **conditions** — standard: `blinded charmed deafened exhaustion frightened grappled incapacitated invisible paralyzed petrified poisoned prone restrained stunned unconscious`; Pokémon-style: `burned frozen asleep confused flinched`; custom: `slowed blink grounded taunted infested seeded cursed trapped drowsy disoriented infected insomnia bleeding type_changed resistance_upgrade granted_immunity removed_from_reality controlled_senses mind_captured watchful_embers perish_song abilities_suppressed forced_movement guaranteed_next_crit guaranteed_next_hit mist safeguard mat_block testudo_formation move_disabled move_locked_to speed_override granted_flight_speed stab_doubled aurora_veil damage_reduction no_proficiency_attacks`. `guaranteed_next_crit` (Laser Focus) and `guaranteed_next_hit` (Lock-On, Mind Reader — `guaranteedHitStatusId`, same shape/wiring as `guaranteedCritStatusId` but never forces a crit) are standalone flags, not stat/roll effects. `stab_doubled` (Calm Mind, Tail Glow) is likewise standalone, read by `computeMoveData`'s own `stabMultiplier` param. `type_changed`/`resistance_upgrade`/`granted_immunity` are the type-matchup family — see their own section below. `mist`/`safeguard` are standing immunity shields checked by `blocking_shield()`; `mat_block`/`testudo_formation`/`aurora_veil` are standing incoming-damage-MULTIPLIER conditions checked by `incoming_damage_multiplier`/`outgoing_damage_multiplier`; `damage_reduction` (Harden, `value` = a rolled flat number) is a standing FLAT-subtraction sibling, checked by `incoming_flat_reduction` — see the `protect_negate`/35-move-batch updates below. `move_disabled`/`move_locked_to` (`value` = a move name) are checked by `disabled_moves()`/`move_lock()`; `no_proficiency_attacks` (Feather Dance) is checked directly in `attackRollContext`.
- **stat**: `ac crit speed attack_rolls damage_rolls saving_throws str dex con int wis cha all_abilities attack_rolls_or_saving_throws` -- `crit` is the number subtracted from 20 to get the crit threshold (see `critThreshold`; +1 = crits on 19-20 instead of just 20), applied like `ac` (a flat delta straight to `critMod`, no derived field). `attack_rolls_or_saving_throws` is a single bonus eligible for either roll type (Growth, Helping Hand) -- spending it on one consumes it for both. `speed` (Agility et al, see the 35-move-batch update below) is a different shape from every other stat -- `speeds` is a whole array of movement TYPES, not a flat scalar, so its own `amount` is either a plain number (additive, `speed_bonus_entries`) or `{multiplier}` (`speed_multiplier_entries`), with an optional `appliesTo` field (one speed `type` string, or `'all'` by default) scoping either to a single movement type.
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
- damage_note — always plain `damage_note`, no `self_`/`potential_` variants (it has no `when` or `target` field for that logic to read at all)

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

*(Update, 2026-09-24: `conditional_damage` turned out not to be a gap at all, once actually read
move-by-move (all 26 -- migrate_effects_v22.py). Every one is a damage FORMULA variation (target/
self HP%, a visible status already shown as a badge, a stat comparison, VP spent so far) the
human already computes themselves when entering their damage roll -- same as every other damage
move in this app, since there's no digital dice and no "damage formula" effect kind anywhere in
this schema, on purpose. The category was never really asking for a new mechanism; it was asking
"does the app need to remember something for later", and the answer was almost always no. Beat
Up was the one real exception (a stored consequence for a FUTURE roll -- "disadvantage on the
target's next attack, if it was surrounded" -- isn't visible anywhere the way "the target is
poisoned" already is), and got a real effect. `generate_unmigrated_moves.py` (now a committed
script, replacing the ad-hoc python one-liner this got rebuilt from by hand after nearly every
migration script since v9) reflects this: `conditional_damage` moved from NEEDS_NEW_TAGS into
NO_EFFECT_NEEDED_TAGS. `potential_damage_increase` is very likely the same story but hasn't
actually been read move-by-move yet -- left alone until it has, not moved on a guess.)*

*(Correction, same day: the paragraph above was wrong about WHY conditional_damage didn't need
anything -- "the human does the arithmetic" is true, but conflated two different things. The new
`damage_note` kind (its own section above) is the fix: the app was never meant to roll the dice,
but forgetting a move's own damage bonus applies at all, mid-battle, is exactly what this app's
other reminders already exist to prevent, and the move-popup already had an unused override hook
(`diceOverride`) sitting there for exactly this. Facade/Flail/Water Spout (migrate_effects_v23.py)
are the self-conditional slice.)*

*(Update, next day: the target-conditional half is built too now (migrate_effects_v24.py) --
Brine, Crush Grip, Cross Poison, Gyro Ball, Hex, Smelling Salts, Venoshock, wired into
target-picker.js's own damage-roll step instead of the move-popup (see damage_note's own section
above for exactly how). That included Gyro Ball's stat comparison after all
(`attacker_stat_below_target`) -- the "a stat comparison... already visible elsewhere" reasoning
in the ORIGINAL finding undersold it: the target's own DEX score isn't necessarily visible to the
human the way their OWN stats are, so a reminder is exactly as valuable there as for HP/status.
What's left under conditional_damage now (Archive Blast, Formation Strike, Trump Card, Stored
Power, Heavy Slam, Electro Ball, Spit Up, Frustration, Return, ...) is countable/comparable but
needs its own tracking this schema doesn't have yet (adjacent-ally count, VP spent, active buff
count, a narrative Loyalty Chart stat, Stockpile's own stacks) -- each a further, separate slice,
not folded into this one.)*

*(Correction, another day later: `generate_unmigrated_moves.py`'s own classification had drifted
back to the WRONG conclusion above (`conditional_damage` in NO_EFFECT_NEEDED_TAGS) and never got
updated after the Correction two paragraphs up -- so the remaining 15 moves under it were silently
reading as "nothing to do" again, the exact failure mode this whole doc's history is a record of.
Moved back into NEEDS_NEW_TAGS. Five of those 15 turned out to fit existing or lightly-extended
mechanisms after all (migrate_effects_v25.py): Solvent Spray/Wring Out are plain damage_note
(`target_type`, `target_hp_at_or_above`, and a new `flatBonus: "moveModifier"` source); Trump
Card/Frustration/Return needed one genuinely new shape, `scalingBonus` (a bonus proportional to a
COUNTED value -- VP spent/10, Loyalty distance from zero -- rather than a fixed amount, see
damage_note's own section above). Bide also got built, but NOT through this schema at all --
two-phase (track damage taken, then a LATER use computes 2x it as a fixed, non-rolled damage
number) is fundamentally different from every damage_note case, which only ever changes what
gets SHOWN before a roll the human still makes; Bide has no roll to show a note next to. Bespoke
code instead (combat.js's `_handleBideClick`, combat-wip.js's `_handleBideResolve`,
routes_combat.py's `_bide_use`/`_damage_taken_since`), and excluded from
`generate_unmigrated_moves.py`'s report entirely (`HANDLED_OUTSIDE_SCHEMA`) rather than left to
reappear as a false gap the way this whole correction started. Archive Blast, Electro Ball,
Formation Strike, Heavy Slam, Self-Destruct, Solar Beam, Solar Blade, and Spit Up remain -- each
needs its own real sub-system (witnessed-move-type tracking, a formation concept, a size-rank
comparison, a forced-death-save state, the weather system, Stockpile's own stacking), not a
schema extension.)*

*(Update, same day: Bide's own "at 10th level, hold for a second turn" option is built too --
`_bide_use` takes an optional `hold` flag (a new `bideHeld` participant field, allowed once per
charge, reset on the NEXT activation) that leaves the charging marker untouched instead of
resolving, so more damage keeps accumulating -- the move's own "chance to add additional damage"
falls out of the existing 2x-damage-taken math for free, nothing new to compute. combat.js offers
the choice via two sequential yes/no prompts rather than repurposing one, so dismissing either is
always a safe no-op instead of silently committing to whichever action happened to be "no".)*

*(Update, next day: Electro Ball also fits damage_note after all (migrate_effects_v26.py), via two
new pieces -- the `attacker_max_speed_above_target` condition and the `nextTierOrDouble` result
field (both documented in their own sections above). Archive Blast, Formation Strike, Heavy Slam,
Self-Destruct, Solar Beam, Solar Blade, and Spit Up remain -- each still needs its own real
sub-system, not a schema extension.)*

*(Update, same day: Heavy Slam too (migrate_effects_v27.py) -- `scalingBonus` (previously
self-conditional only, Trump Card/Frustration/Return) now works target-conditionally as well, its
magnitude read from a new `attacker_size_above_target` condition (however many size levels the
attacker outranks the target by, on the move's own named scale). Archive Blast, Formation Strike,
Self-Destruct, Solar Beam, Solar Blade, and Spit Up remain.)*

*(Update, next day: Self-Destruct's damage aspect is built too (migrate_effects_v28.py) -- the
user's own explicit call: the forced-death-save/no-potions/recovery-days chain stays out entirely,
just the self-faint and the AoE damage. Two pieces outside the `effects` schema itself: (1) a new
generic `self_faint` handler in combat.js's own `onUseMove` (0 HP, nothing more, for any move
carrying that category -- Lunar Dance, Memento, Final Gambit, Self-Destruct, Healing Wish, not
just this one), and (2) `save-picker.js` gained an opt-in `damageOnPass` (default false, every
other save-triggered move still deals zero damage on a pass) since this app's save flow never had
ANY way to enter a damage roll on a passed save before -- Self-Destruct's own "half as much on a
success" needed one. Once that exists, "half on a success" is the same unautomated assumption
every other save-triggered move already makes (the human enters half by hand); the move's OWN
damage_note only needs the low-HP tier's further halving on top, `totalMultiplier: 0.5` below 50%
HP -- the exact same shape Water Spout already uses, just now also reachable from a passed save's
own damage step. Archive Blast, Formation Strike, Solar Beam, Solar Blade, and Spit Up remain.)*

*(Update, next day: Solar Beam and Solar Blade too (migrate_effects_v29.py) -- identical mechanics
between the two (one ranged/AoE, one melee), so one shared effect. The two-turn "charge, then
attack" structure is deliberately unmodeled, same as the existing "vanish, then attack next turn"
family (Aqua Phase, Dig, Dive, Fly, Phantom Force, Shadow Force) -- the human just uses the move's
own attack half on their actual attack turn. The only real gap was the harsh-sunlight check, which
needed weather to actually be shared: `routes_combat.py` gained `weather`/`terrain` fields on the
session itself (`set-weather`/`set-terrain`), moved off combat.js's own global-conditions bar,
which had been a single DEVICE's local storage only -- invisible to every other player, which
would have made this move's own bonus silently never trigger for anyone except whoever's device
happened to set the weather. New `self_weather_contains` condition (a loose substring match
against the freeform weather name) and `flatBonus: "moveModifier"` now working self-conditionally
too (previously target-conditional only, Wring Out). Archive Blast, Formation Strike, and Spit Up
remain.)*

*(Update, same day: the last three, plus Swallow along with them (the user's own call, since it's
the same Stockpile mechanic as Spit Up, just self_heal). None of the four got an `effects` entry
-- all bespoke, name-matched code in combat.js, same as Ingrain/Bide -- and are now listed in
`generate_unmigrated_moves.py`'s own `HANDLED_OUTSIDE_SCHEMA` so they can't silently reappear as
"needs work":
- **Swallow** turned out to already be fully built (`_isDirectHeal`'s own `_healStacks`, reading
  `c.stockpileStacks`) -- found while reading the existing code for Spit Up, not new work.
- **Spit Up** was 90% there already (the same `c.stockpileStacks`, the "×N Stockpile stacks" note,
  Stockpile's own increment, Spit Up's own reset on use) -- missing only the one line actually
  multiplying the DAMAGE dice by the stack count, Swallow's own sibling case.
- **Formation Strike** ("1d6 ... for EACH creature in your formation") has no roster/formation
  concept anywhere in this app to count from, so it just asks -- a new `showCombatPrompt` (a
  numeric-input sibling to `showCombatConfirm`, `combat-alert.js`) once per use, not tracked as
  state. Cancelling/leaving it blank cancels the move.
- **Archive Blast** ("every type of move you have witnessed... since the user was sent out") reads
  distinct move TYPES from the shared log, from this participant's own 'join' entry onward
  (`combat-wip.js`'s new `_witnessedMoveTypesSince`) -- WIP-only, same limitation as Bide (no log
  on the legacy engine). Only 'damage' log entries actually carry a moveType, so this really means
  "witnessed dealing damage", a deliberate approximation of "witnessed" given what's reliably
  loggable today.)*

*(Update, 2026-09-30: a full re-read of the "fits the schema already" bucket
(migrate_effects_v30.py) found only 3 of its 40 moves have a genuine,
non-lossy fit -- Artifact Light (doubled proficiency on attack rolls via a
second `amount:'proficiency'` stat effect, gated `when:'special'` since the
precondition is a human judgment call; the damage-rolls half of its own
text has no live consumer -- `damage_rolls` is in this doc's own `stat`
vocabulary but nothing in `move-effects.js` reads it), Omen Sense
(disadvantage on attacks against the holder for 1 round -- its own reactive
retaliation-attack clause needs a full counter-attack flow, left
unmodeled), and Radiant Hope (heal + advantage-on-next-attack for allies,
both existing shapes -- its own self-recoil-equal-to-healing clause has no
mechanism). The other 37 are each blocked on a real, specific gap --
`speed` as a flat/multiplicative buff (still never implemented anywhere,
despite being listed in the `stat` vocabulary below -- Agility, Autotomize,
Kinesis, Flame Charge, Surface Glide, Tailwind), STAB doubling
(`increase_stab` has never had a backing mechanism -- Calm Mind, Tail
Glow), a "guaranteed hit" grantable status (the `guaranteed_next_crit`
precedent's un-built sibling -- Lock-On, Mind Reader, Thunderstorm Dance),
ability/target-specific attack-roll scoping (the `ability` field only
narrows `saving_throws`, not `attack_rolls` -- Nasty Plot, Study), damage
reduction on defense, VP-cost modifiers, the already-flagged "choose which
stat" gap (Power Trick/Power Split), stealing or inverting an existing
effect, reactive/retaliatory damage, tracked amounts with no tracking
mechanism, and field/terrain AoE-over-time (no "who's standing in this map
area" concept exists). Full per-move reasoning in
`migrate_effects_v30.py`'s own module docstring -- not repeated here.)*

*(Update, 2026-09-30: the "guaranteed hit" gap named above is closed for
Lock-On and Mind Reader (migrate_effects_v31.py) -- a new
`guaranteed_next_hit` condition, `guaranteedHitStatusId()` mirroring
`guaranteedCritStatusId()` exactly (same standalone-flag shape, same
target-picker.js wiring, same use-status consumption once the attack
resolves), just never forcing a crit. Both moves' own "you may still roll
to check for a crit" clause isn't modeled -- the guaranteed-hit path skips
the roll step entirely, so keeping the roll around for crit-fishing only
would need a materially different code path. Thunderstorm Dance ("while
concentrating, ALL electric-type moves guaranteed to hit") is NOT
included -- it's an ongoing, move-TYPE-scoped effect, not a one-shot "next
attack" flag, and this mechanism has no concept of narrowing to a specific
move type at all; left for its own slice. Also fixed a real latent bug
found while wiring this in, pre-dating this change: the "hit again?" loop
for multi-hit moves (multi_hit_same_target/multi_hit_choice) reused a
single `guaranteedHit` value computed once before the first hit, across
every subsequent hit — a one-shot status (Laser Focus's crit, or this new
hit-guarantee) would incorrectly stay "guaranteed" for later hits too, even
after being consumed by the first one. Fixed with a new
`_guaranteedHitFor(combatantId, categories)` helper (combat-wip.js) that
re-checks the live session state fresh on every call.)*

*(Update, 2026-09-30: moved on to the next unmigrated category,
`potential_damage_increase` (13 moves) -- same "read it fully before
trusting the label" discipline as the `migrate_effects_v30.py` pass. 4 of
the 13 fit with small, genuinely new but reusable additions
(migrate_effects_v32.py): `attack_roll_at_least` (Charge Beam),
`self_hp_at_or_above` + self-conditional `advantage` support (Eruption),
and a new `extraDice` result field + `self_active_buff_count`/
`target_active_buff_count` conditions + `activeBuffCount()` (Power Trip,
Punishment) -- see their own sections above for the full reasoning. The
other 9 each need something genuinely different: a battle-log scan for a
time-windowed "did the target hit me recently" condition (Avalanche,
Payback, both same shape, different windows) or "was a specific move
already used this round" (Fusion Bolt) or "did my last attack miss"
(Stomping Tantrum); a real resource-tracking mini-system shared by Fury
Cutter/Ice Ball/Rollout (cumulative same-move-consecutive-turn stacking,
closer to Stockpile's own stacking than anything damage_note does); and
two genuinely novel shapes with no shared mechanism worth building
alongside anything else (Echoed Voice's cross-creature stacking counter,
Round's reaction-injected bonus into someone ELSE's in-progress roll).
Full reasoning in `migrate_effects_v32.py`'s own module docstring.)*

*(Update, same day: the Fury Cutter/Ice Ball/Rollout consecutive-hit group
flagged above as "its own mini-system" turned out to fit the existing
damage_note mechanism after all (migrate_effects_v33.py) -- no new effect
kind, just a new log-scan (`_lastHitMoveStreak`, same WIP-only bridging
pattern as `activeBuffCount`), a new condition
(`self_consecutive_move_hits`, magnitude already the final capped
multiplier), and a new `diceMultiplierFromMagnitude` result field reusing
the existing `diceMultiplier` display/application path end to end. See
their own sections above. VP-cost escalation and the speed-reduced-to-0
reset clause are noted, not modeled -- see the condition's own section.)*

*(Update, 2026-09-30: moved to `steal_disrupt` (23 moves, the largest
remaining category) -- same "read every move fully before trusting the
label" discipline. Most are genuinely blocked (item theft with no
held-item field anywhere in this app; a Pokemon "Ability" subsystem that
doesn't exist; the already-known "choose which stat" gap; three other
not-yet-built categories; five DIFFERENT reactive-theft mechanics with no
shared mechanism). Four share one real mechanism -- a new `stat_transfer`
kind, see its own section above -- migrated in `migrate_effects_v35.py`:
Clear Smog (dispel), Psych Up (copy), Heart Swap (swap), Spectral Thief
(steal, partial -- its own teleport clause needs the positioning category).
Required a new `tag_for` branch (`migrate_effects_v2.py`) since an
unrecognized effect `kind` would otherwise crash there. Guard Swap/Power
Swap/Role Play (swap or copy ONE CHOSEN stat) and Psycho Shift (transfer
ONE named condition) are real and buildable but need their own small
"choose which" picker -- deliberately held for a separate slice. Verified
with 12 checks against a reimplementation of `_handleStatTransfer`'s exact
logic (dispel/copy/steal/swap, including that `steal` correctly leaves a
negative stat untouched and `swap` snapshots both sides before mutating
either).)*

*(Update, same day, a real correction: Haze was identified during the pass
above as fitting the same `stat_transfer` mechanism but never actually
migrated or flagged as excluded -- a gap in that commit's own reporting,
caught when the user asked for a plain yes/no on what was actually
implemented. Fixed (`migrate_effects_v36.py`) with a new `dispel_all` mode
(see its own bullet above) plus a real bug fix this exposed: Haze is the
first move authored with a `target:"self"` `stat_transfer` effect (it hits
its own blast radius too), which revealed `_offerMoveEffects`'s call site
was reading `targetId`/`attackerId` from its enclosing closure instead of
`pick.targetId` -- harmless for the four already-shipped moves (none of
them are ever self-targeted, so the two values were always equal) but
wrong in general. Fixed by reading `pick.targetId` instead. Verified with
6 checks, including that `dispel_all` removes a `condition`-kind status
(not just `kind:'stat'`) and that self-targeting now actually reaches the
caster's own statuses.)*

*(Update, 2026-09-30: a correctness review of everything shipped so far (all
of status conditions plus every move-effects category up through
`steal_disrupt`), requested after several rounds each turning up its own new
bug -- two independent passes, one per body of work, ~19 findings between
them. Confirmed and fixed:
- **`_resolveOneHit`'s stale `guaranteedHit`** (`combat-wip.js`): read only
  `categories.includes('guaranteed_hit')`, never the status-granted guarantee
  (Laser Focus/Lock-On/Mind Reader) that `_guaranteedHitFor` already checks
  correctly at the pickTarget call site earlier in the same flow -- so a
  status-guaranteed hit fed `crit: undefined` and `ctx.guaranteedHit: false`
  into `evaluateEffect`, which made its `natural_roll`/`crit` cases fall
  through to `'manual'` (ask a human) instead of the correct `'no'` (there
  was never a roll to have crossed a threshold on). Fixed by reusing
  `_guaranteedHitFor` instead of re-deriving the category-only check.
- **`activeBuffCount` skipped dice-shaped amounts** (`move-effects.js`):
  Sharpen/Growth/Aromatic Mist/Helping Hand's `amount: {dice: "1d4"}` shape
  (see "Dice-based bonuses" above) never satisfied `typeof s.amount ===
  'number'`, so a target buffed by Growth or Helping Hand never counted
  toward Power Trip's or Punishment's own buff count at all. Fixed: a
  dice-based amount now always counts (unconditionally positive by
  construction, no sign or `_stackCount` to check the way a flat number
  needs).
- **Punishment's `statFields` missing `attack_rolls_or_saving_throws`**
  (`DnD_moves_categorized_draft.json`, `migrate_effects_v32.py`): the filter
  list (`attack_rolls`, `damage_rolls`, `ac`) left out Growth/Helping Hand's
  own dual-purpose stat field, so even with the `activeBuffCount` fix above,
  a target buffed via Growth still wouldn't count for Punishment specifically
  (Power Trip has no filter, so it was unaffected). Added to the list in both
  the live data and the migration script (for reproducibility).

Also reviewed and fixed, from the status-conditions pass specifically (all in
`routes_combat.py`/`conditions.py`/`combat-wip.js`, unrelated to the
move-effects schema this doc covers, noted here only for a single
changelog): Confused's `until_turn`/`point:'end'` status applied while the
holder is already active was tripping `_prime_end`'s skip logic (built for a
different case), adding a spurious extra round of incapacitation -- fixed
with a new `noSkip` opt-out. Grappled/Restrained's speed-0 enforcement lived
entirely inside `_move_token`'s speeds-gated budget check, so a participant
with no `speeds` data at all (a DM's freeform enemy) was unrestricted despite
holding the condition -- fixed with a new unconditional `zero_speed_condition`
check. `_promptConfusionCheck` re-read a stale HP value across an await
(race), and `_promptParalysisCheck`/`_promptConfusionCheck`/
`_promptSleepCheck` had a few apply/remove-status calls whose rejection
wasn't handled, desyncing local state from a failed server write -- all
given explicit try/catch or `.catch()` handling. `_stand_up`'s error message
had inconsistent float formatting between its two numbers -- given a shared
`_fmt_ft()` helper. The save-picker's own auto-fail support (Phase 3 of
status conditions) had regressed the plain "suggest Fail on an ordinary
failed save" case; fixed same session (`3518d4c`).

Nothing else in either review's findings list turned out to be a real
correctness bug -- the rest were either already-documented simplifications
(the `set`-override-never-counts case `activeBuffCount` still doesn't cover,
Charmed/Frightened's targeting-restriction clauses still deferred) or
genuinely low-priority dormant gaps (a `damage_note` result combining
`advantage` with a totalNote, or `diceMultiplier` with `extraDiceCount`, in
the same effect -- no shipped move does both, so no note-composition code
path for it exists yet; left as-is until a move actually needs it).)*

*(Update, 2026-09-30: moved to `protect_negate` (20 moves). 7 of them (Aqua
Phase, Astral Jet, Fly, Hyperspace Hole, Phantom Force, Phantom Tendril,
Shadow Force) already carry `ignoresProtect: true` from an earlier pass --
that already fully covers this category's own concern for them, same
documented-manual treatment the already-migrated Bounce and the
never-migrated Dig/Dive give their own semi-invulnerable-turn-plus-advantage
shape; nothing else to add. 4 more shipped this pass (`migrate_effects_v37.py`):

- **Captivate** / **Hover**: both reused Parry's own `block_attack` +
  `when:"special"` pattern as-is (a contested/conditional outcome the human
  judges and ticks after the fact) -- zero new code. Along the way, found
  that NONE of this category's 10 reaction-shaped moves (the ones whose own
  text says "you may use a reaction") had `reactionTrigger`/`reactionRange`
  set at all -- an original-categorization gap, not a schema gap, since
  without it `_eligible_reactors` never offers the reaction regardless of
  what `effects` say. Backfilled for these two (`targeted`/0, matching
  Parry/Protect); still missing on the other 8 (Crafty Shield, Feint, Lucky
  Chant, Mat Block [not itself a reaction, see below], Nature's Embrace,
  Spiky Shield, Testudo Formation, Wide Guard) -- flagged for whoever
  migrates each one, not fixed blanket here since some of those still need
  their own new mechanism first regardless. Hover's second effect reuses
  `granted_immunity` (Magnet Rise's own mechanism, read generically off
  whatever's currently active -- no code cared that it had only ever shipped
  with an `encounter`-length `ends` before) with a `until_turn`/start/1 end
  for "dodging Ground moves until the beginning of your next turn" -- also
  zero new code.
- **Mist** / **Safeguard**: a real new mechanism, `blocking_shield()`
  (`conditions.py`) -- the apply-name of a `mist`/`safeguard` condition
  already active on a target that blocks an incoming status `spec` outright,
  checked from `_apply_status` (`routes_combat.py`) before anything lands,
  raising the same plain `ValueError` every other blocked action in this
  file already raises (shown correctly by every existing call site's error
  handling with no client changes). Mist scopes to `kind:'stat'` with a
  negative flat `amount` (a dice-shaped bonus is never negative by
  construction, so it's unaffected); Safeguard scopes to its own named
  condition list (asleep/burned/confused/frozen/paralyzed/petrified/
  poisoned/slowed), not every condition or `INCAPACITATING_CONDITIONS`.
  Neither blocks a self-sourced apply (`sourceId` unset or equal to the
  target's own id) -- both moves protect against an ENEMY's incoming effect,
  and this app has no team/faction concept anywhere to check that
  properly against; a documented simplification, same spirit as
  `granted_immunity` having no team check either. Verified with 11 direct
  calls against `blocking_shield` (blocks/allows on both moves, self-sourced
  and sourceless applies passing through untouched, a dice-shaped amount
  never counting as negative, an unrelated status on the same participant
  not confusing the scan).

The remaining 9 stay unmigrated, each for a real, different reason (5 already
scoped above, 4 assessed fresh this pass): Feint (reaction to a DEFENDER's
own declared reaction -- this app's one-floor-holder turn model has no shape
for that), Wide Guard (halves rather than negates, needs a reaction window
INSIDE an AoE resolution `_handleMultiHitAoe` doesn't have), Spiky Shield
(reflects damage back -- no "deal damage" effect kind exists anywhere in this
schema), Nature's Embrace (redirects the avoided damage into a brand new
attack roll against a different target -- a full reactive mini-attack-flow,
not a status), Lucky Chant (needs a third reaction timing, after the attack
roll but before damage -- crit itself isn't determined until well after
target-picker.js's own attack-roll step has closed); and, assessed this
pass: **Crafty Shield** (blocks only the CONDITION half of an incoming
attack, never any accompanying damage -- reusing `block_attack` as-is would
over-block a damage+condition combo move like Thunder Punch, a real gap, not
an acceptable approximation), **Mat Block** (not a reaction at all -- a
proactively-cast, multi-turn, AoE "immune to damage from damaging moves"
shield needing a check at DAMAGE-APPLICATION time, parallel to `temp_hp`'s
own `_absorb_temp_hp` hook, not a reaction-window block), **Shield Dome** (a
physical terrain barrier blocking movement and ranged line-of-sight through a
fixed radius -- needs real wall/LOS geometry this app's grid has no
representation of, unrelated to the Protect-family reaction-block shape
entirely), **Testudo Formation** (compounds King's Shield's own
already-deferred "blocks ALL damage, persists past the one triggering
attack" gap with Wide Guard's halve-math-inside-an-AoE gap AND a
formation-membership concept this app tracks nowhere -- not a small
increment on anything already built).)*

*(Update, 2026-09-30: the user pushed back on how much of `protect_negate`
got deferred above, specifically naming Feint and Wide Guard as moves that
didn't need nearly as much new work as their write-ups implied. Re-examined
both with that in mind -- Feint built this pass (`migrate_effects_v38.py`),
Wide Guard next.

**Feint**'s own deferral reasoning ("a reaction to a DEFENDER's own declared
reaction -- this app's one-floor-holder turn model has no shape for that")
was too literal: the tabletop flavor text describes a nested interrupt, but
the actual GAME OUTCOME only needs the attacker to undo an already-recorded
block after the fact -- by the time Feint could ever apply,
the blocker's own reaction has already fully resolved (`reactionBlock` is
set, possibly after its window even closed). So Feint is authored as a
plain follow-up action the attacker takes, checked by IDENTITY against the
block record, not through the reaction-floor machinery every other reaction
uses -- no interrupt nesting needed at all.

New pieces: `_block_pending_attack` (routes_combat.py) now takes the
blocker's own move name and stores it on `reactionBlock`; a new
`_negate_reaction_block` (`negate-reaction-block` action) lets the recorded
ATTACKER (never the blocker) mark it negated once, charging Feint's own
`vpCost` against themselves (same VP-floors-at-0-overflows-into-HP rule
`_apply_move` already uses) and refunding half the blocker's move's own
`vpCost` to them. Verified with 9 direct calls (charge/refund math, can't
negate twice, only the recorded attacker may, no-block-yet raises, VP
overflow into HP, moveName round-trips onto the record).

Also new: `_list_move_categories` gains a `flags` map alongside
`categories`/`effects` -- the first thing in this schema that isn't shaped
like an `effects` entry at all but still needs a client-side read. Feint's
own `negatesProtectBlock: true` is the first (and so far only) entry;
`ignoresProtect`/`reactionTrigger`/`reactionRange` stay server-only (only
`_eligible_reactors` reads them). Client-side, `combat.js` exposes it as
`moveFlagsFor(moveName)`, same shape/convention as `moveEffectsFor`.
target-picker.js's `_afterTargetSelected` -- the one place a `block_attack`
result is already handled -- now offers a confirm dialog on a block if the
attacker knows a `negatesProtectBlock` move, and on accepting, calls
`negateReactionBlock` and proceeds exactly as if `blocked` had been false
all along. target-picker.js still has zero dependency on combat.js (its own
stated design constraint, preserved) -- the move name is resolved by the
CALLER (combat-wip.js's new `_feintMoveNameFor`, scanning the attacker's
whole moveset by FLAG rather than hardcoding "Feint" by name, so a future
homebrew move with the same shape works with no code change) and passed in
as a plain `feintMoveName` string, same layering every other combat.js-
derived value (categories, guaranteedHit) already respects at that
boundary. Feint itself gets no `effects` entry at all -- there's no attack
of its OWN to roll; what it acts on is already fully specified by the
just-recorded block -- its `categories` are left exactly as originally
hand-assigned, same treatment as the 7 `ignoresProtect` moves.)*

*(Update, 2026-09-30: Wide Guard built (`migrate_effects_v39.py`), the second
of the pushback list. Its own deferral had two stated reasons -- it halves
rather than negates, and the reaction window would need to open INSIDE an
AoE resolution, which `_handleMultiHitAoe` didn't have at all -- both
addressed, at the cost of one simplification the user explicitly signed off
on: a human eyeballing who's actually in range of the blast is fine (same
trust model as every other AoE-membership check in this app already), so no
new positional/radius system was needed, only the halving mechanic and a
place for the reaction to happen.

New `kind: "damage_multiplier"` effect ({multiplier, target:"self",
when:"special" -- the Protect family's own escalating "roll over 15 after
the first use" cost stays a manual human judgment call, same treatment
Parry/Captivate/Hover already get). Wired into `_offerMoveEffects` exactly
like `block_attack` -- a one-shot signal to the ATTACKER's client instead of
a stored status, just scaling the damage that still lands instead of
cancelling it (`_apply_reaction_damage_multiplier`, a new top-level
`reactionDamageMultiplier` session field structurally identical to
`reactionBlock`). `reaction-window.js`'s `waitForReactionWindow` now watches
both fields, resolving to `{blocked}` or `{blocked: false, multiplier,
reactorName}`.

`_handleMultiHitAoe` now opens ONE 'targeted' window right after targets are
picked, anchored on the first one selected (the closest stand-in this app
has for "is the reactor in range of the blast"). A `block_attack` reactor
(also eligible here, since it rides the same 'targeted' family) only ever
protects its own user, so it's filtered OUT of the AoE's target list rather
than aborting the whole resolution; a `damage_multiplier` reactor instead
scales every remaining target's own damage, threaded through both of this
function's branches (the save-triggered one inline, the guaranteed-hit one
via a new optional `damageMultiplier` param on `_resolveOneHit`, defaulted
to 1 everywhere else). New `waitForTargetedAoeReactions`
(reaction-wait-overlay.js, generalized from the 'damaged'-only
`waitForDamagedReactions` it already shared code with) gives this its own
"waiting..." overlay, since this loop -- unlike target-picker.js's
single-target flow -- has no existing popup step to pause inside of.
Verified with 4 direct calls against `_apply_reaction_damage_multiplier`
(records correctly, requires floor-holding, requires a live pending
reaction) plus the 9 existing `_negate_reaction_block`-family checks
re-confirming Feint's own mechanism is untouched by this change.)*

*(Update, 2026-09-30: Lucky Chant built (`migrate_effects_v40.py`), the
third of the pushback list. Its own deferral reasoning ("needs a third
reaction timing neither `targeted` nor `damaged` covers -- crit isn't
determined until well after target-picker.js's attack-roll step has
closed") was solving the wrong problem: instead of intercepting BEFORE
damage, this reuses `reroll_damage`'s own RETROACTIVE-correction shape
(the 'damaged' family Attract already rides) -- "treats it like a normal
hit" becomes "refund half the crit's own final total", the same halving
approximation Wide Guard/Nature's Embrace's own rules text already leans on
(no digital dice anywhere in this app, so there's no real non-crit roll to
recompute from, only the crit's own total to work backward from).

The one genuinely missing piece: a 'damaged' reactor had no way to know
whether the hit that just landed on THEM was a crit at all -- only ever
computed on the ATTACKER's own device (`_resolveOneHit`), never reaching the
shared log. Fixed by reordering `_resolveOneHit`'s own crit computation to
run BEFORE `CombatAPI.applyDamage` instead of after (nothing it depends on
comes from the damage result, so this is a safe reorder -- status
CONSUMPTION, the Laser Focus/Lock-On/Mind Reader `useStatus` calls, stays in
its original post-damage spot; only the pure `crit` boolean moved), and
threading a new `crit` param through `applyDamage` -> the `apply-damage`
action -> `_apply_damage`/`_apply_damage_to_target` -> the `'damage'` log
entry itself. Arrives as the string `"true"`/`"false"` like every other
query-string param this app already parses explicitly.

New `kind: "undo_crit_damage"` effect (`target:"self"`, `when:"always"` --
deterministic, NOT a human judgment call like Parry/Captivate/Hover's own
`"special"`: the log entry either says `crit:true` or it doesn't).
`_handleUndoCritDamage` differs from `_handleRerollDamage` in one way worth
noting: it takes no `attackerId` at all. `reroll_damage` rides a `save_fail`
and gets its "who's the attacker" from that save's own targeting flow;
Lucky Chant has no save and is offered through `_handleEffectsOnly`'s plain
self-only path, which passes no `targetId` whatsoever. So the attacker is
instead read straight off the most recent damage log entry against the
reactor (`entry.actorId`/`actorName`) -- no second lookup needed, this app
already logs everything required. Verified with 3 direct calls against
`_apply_damage_to_target` (crit recorded true/false correctly, damage math
unaffected) plus 6 against a reimplementation of `_handleUndoCritDamage`'s
own log-scan/refund logic (finds the right entry, floors an odd refund,
picks the MOST RECENT entry not an earlier one, ignores unrelated
targets/non-damage entries).)*

*(Update, 2026-09-30: Spiky Shield built (`migrate_effects_v41.py`), the
fourth of the pushback list. Its own deferral reasoning ("needs a deal
damage effect kind that doesn't exist anywhere in this schema") was true in
the narrow sense that no move had ever AUTHORED one, but the underlying
PRIMITIVE (`CombatAPI.applyDamage` -- attacker, target, amount, type,
species, moveName) already existed and works generically for any
(source, target) pair; nothing stopped a reaction handler from calling it
with the reactor and the original attacker's roles swapped. Building the
kind was mostly writing the handler, not inventing new server plumbing.

Two new effect kinds, both `target:"self"` (Spiky Shield, like Lucky Chant,
is offered through `_handleEffectsOnly`'s plain self-only path, which never
supplies a real targetId -- "self" is the only section that renders
sensibly here) and `when:"always"` (deterministic):
- `kind: "negate_damage"` -- `reroll_damage`'s own retroactive-correction
  shape, a full (100%) refund against the most recent damage entry against
  the reactor instead of a human-entered reroll (`_handleNegateDamage`).
- `kind: "deal_damage"` (`{amount: "proficiency" | <number>, damageType?}`)
  -- a flat guaranteed counter-hit against whoever that same entry says
  attacked (`_handleDealDamageToAttacker`).

Both read "who attacked me" via a new shared `_lastDamageAgainst(reactorId)`
helper -- the same log-scan `_handleUndoCritDamage` already did inline,
factored out now that a third handler needs it too. Deliberately NOT
modeled, same manual-after-first-use precedent every other Protect-family
move here already gets: the escalating "roll over 15 after the first use"
cost, and its own rider that a later successful (non-natural-20) use still
drains the reactor's own VP for half the damage amount -- both riders only
ever apply on a use this schema already leaves manual, so there's nothing
lost leaving them that way too. Verified with 7 direct calls against a
reimplementation of the negate/deal-damage logic (full refund, proficiency
and plain-number amounts both resolve, a zero amount no-ops, missing-entry
cases report cleanly, and the MOST RECENT entry against the reactor
specifically is what's picked, not an unrelated or earlier one).)*

*(Update, 2026-09-30: Nature's Embrace built (`migrate_effects_v42.py`), the
fifth of the pushback list. Its own deferral ("needs a full reactive
mini-attack-flow, not a status") was right that it needs a real attack roll
against a freely chosen target -- but `_handleBideResolve` already proved
this exact shape works: `pickTarget`'s own `presetRoll` param pre-fills a
KNOWN damage amount (still editable) while still running the ordinary
attack-roll step. Nothing new needed for that half either.

The "discount the extra damage" half turned out NICER than the halving
approximation Wide Guard/Lucky Chant lean on: the damage log already
records the type multiplier that applied, so "discount the extra" is an
EXACT figure -- `amount - floor(amount / multiplier)`, reducing the total
back down to what a plain 1x hit would have been. Correct for a stacked 4x
vulnerability (two type weaknesses) the same as the common 2x case, not
just an approximation of the common case.

New `kind: "redirect_avoided_damage"` effect (`target:"self"`, `when:"always"`
-- deterministic: `original.multiplier > 1` either holds or it doesn't, same
pattern Lucky Chant's own crit check already uses). `_handleRedirectAvoidedDamage`
first refunds the discounted amount to the reactor's own HP, then -- only if
something was actually avoided -- opens `pickTarget` with that amount as the
`presetRoll`, mirroring `_handleBideResolve`'s own miss/hit handling exactly.
Verified with 5 direct calls against the avoided-amount math (standard 2x,
a stacked 4x case, non-vulnerable and resistant hits both correctly report
nothing to discount, an odd total floors the same way the rest of this
schema's refund math already does).)*

*(Update, 2026-09-30: Crafty Shield, Mat Block, and Testudo Formation built
(`migrate_effects_v43.py`), closing out the pushback list -- only Shield
Dome is left unmigrated in `protect_negate` now, and it stays that way for a
reason genuinely unlike anything else in this pass (real wall/line-of-sight
geometry this app's grid has no representation of at all, a battle-map
feature, not a move-effects one).

**Crafty Shield** shipped as a documented simplification rather than left
fully unmigrated: it reuses `block_attack`/`when:"special"` exactly like
Parry/Captivate/Hover, correct for a pure status-inflicting move (the common
case) but an over-correction for a damage+condition combo move, since this
app has no mechanism to selectively cancel just the condition half of an
attack. The `note` field says so explicitly.

**Mat Block** / **Testudo Formation** got a genuinely new mechanism:
`incoming_damage_multiplier`/`outgoing_damage_multiplier` (conditions.py),
checked in `_apply_damage_to_target` -- Mat Block's "immune to damage from
damaging moves" (0x) and Testudo's "take half damage... the damage they
deal is also halved" (0.5x both ways) are STANDING, multi-turn conditions
scaling every hit during their duration, unlike `block_attack`/
`damage_multiplier`'s one-shot reaction-window cancel of a single attack.
Applied server-side, so every client call site is covered automatically.
Kept deliberately separate from the logged type `multiplier` field --
Nature's Embrace's own reactor-side "was I vulnerable" check reads that
field, and a Mat-Block-zeroed or Testudo-halved hit shouldn't look like a
type-chart result it never was; the log text instead gets an explicit
"-- Mat Block/Testudo Formation reduces this" suffix when either applies.
The two checks compound if a formation member ever attacks ANOTHER
formation member (0.5 × 0.5 = 0.25x) -- a documented assumption, same
spirit as `resistance_upgrade`'s own "several sources each bump their own
step, compounding". Both moves ship with the same dual-effect shape Haze/
Safeguard's own AoE buffs already use (`target:"self"` + target-unset for
the multi-target picker).

Testudo Formation's own two extra riders stay manual, flagged in a `note`:
automatically avoiding the ONE triggering attack (a multi-participant
simultaneous block this app's single-anchor reaction-window model has no
shape for) and "rooted together... until the beginning of your next turn"
(a positional-linking constraint `_move_token` has no concept of). Both are
narrower gaps than this category's original "not a small increment on
anything already built" framing suggested for this move, but still real,
not silently dropped.

Verified with 8 direct calls against `incoming_damage_multiplier`/
`outgoing_damage_multiplier` (each condition's own multiplier, the two
combining via minimum on the incoming side, Mat Block correctly NOT
affecting outgoing) plus 8 against the full `_apply_damage_to_target`
integration (Mat Block zeroes damage while the logged type multiplier
stays untouched, Testudo halves incoming and outgoing independently, both
sides together compound to 0.25x, an unaffected hit gets no reduction note
in its log text).)*

*(Update, 2026-10-01: moved to `steal_disrupt` (18 moves remaining). Per the
user's own instruction, starting with the genuinely easy ones before
re-assessing the rest the same way `protect_negate` just got re-assessed.
First batch (`migrate_effects_v44.py`):

- **Defog** ("sweeps away any area of effect moves still active") -- this
  app models weather/terrain as a single freeform `{name, effect}` pair
  EACH, not a stack of named effects, so "clear every active field effect"
  is just clearing both to null. New `kind: "clear_field"`, special-cased in
  `_offerMoveEffects` to call the already-client-exposed
  `CombatAPI.setWeather('','')`/`setTerrain('','')` -- no new server action.

- **Guard Swap** / **Speed Swap** / **Power Swap**: a new `stat_transfer`
  mode, `"swap_value"` -- unlike the existing `"swap"` mode (which moves
  WHOLE `kind:'stat'` status entries, built for Heart Swap's own buff
  exchange), this swaps the CURRENT EFFECTIVE VALUE of one named field
  (`effectiveStats(p)[field]`, reading base stats AND active statuses both),
  since AC/speed/an ability score's current value can come from either.
  Applies a `set`-override status to each side holding the OTHER's current
  value; the overlay model's existing snapshot-at-apply/restore-at-expiry
  behavior (see the `set` section above) handles "for the duration" with no
  new code at all. Guard Swap (`field:"ac"`)/Speed Swap (`field:"speed"`)
  name their own stat directly; Power Swap's own "a single ability score"
  doesn't, so it ships with `field: null` and a new stat-choice dropdown in
  effects-popup.js (`_needsStatChoice`/`_statChoiceInput`, mirroring the
  EXISTING type-choice dropdown `type_changed`/`resistance_upgrade` already
  use), asked ONCE per use rather than once per sibling effect -- the swap
  is computed and applied to both sides inside ONE handler call, so there's
  no risk of the caster's and target's own pick landing on two different
  fields, which two independent dropdowns on two separate effects could
  never have guaranteed.

  This directly unblocks a gap already flagged for a different category:
  "Power Trick (swap AC with an ability score) and Power Split (replace a
  CHOSEN score with an average) both also need a 'player picks which stat'
  mechanic that doesn't exist yet" (see the `set` section above) -- it now
  does, for whenever those get migrated. Verified with 5 direct calls
  against the swap-direction logic (each side receives the OTHER's value,
  a null field reports cleanly, missing stat data on either side reports
  cleanly rather than sending a bad number).)*

*(Update, same day: Psycho Shift and Searing Flame built
(`migrate_effects_v45.py`) -- `steal_disrupt`'s own "choose which status"
pair, the category's version of the "player picks which stat" gap the
numeric swaps above just closed. Both need the human to pick ONE status
from a participant's CURRENT list -- a dynamic set with no fixed vocabulary
(unlike a stat name or a Pokémon type) -- so a new small popup,
`pickOneStatus` (`js/utils/status-picker.js`), lists whatever's actually
live right now as clickable options instead of a dropdown of pre-known
choices.

Two new `stat_transfer` modes, both reusing `_handleStatTransfer`'s
existing `remove`/`recreate` helpers -- the only new piece either needs is
the picker call:

- **Psycho Shift** (`mode: "transfer_condition"`) -- "a status affecting
  [a willing ally, or yourself] is transferred to the target instead",
  shipped SELF-ONLY as a documented simplification: this app has no
  mechanism to pick a THIRD participant (the ally) on top of the caster and
  the save-target, and the move's own text already treats "yourself" as the
  always-available case. Moves one `kind:'condition'` status from the
  caster to the target.
- **Searing Flame** (`mode: "dispel_one"`) -- "burns away one positive
  effect on a hostile target, or one negative effect if used on an ally".
  This app has no team/faction concept to tell hostile from ally itself
  (the same documented gap `blocking_shield` already has for Mist/
  Safeguard), so rather than guess, the picker shows the target's WHOLE
  current list (stat AND condition statuses both) and trusts the human to
  pick the one that fits their own hostile-or-ally use.

Verified with 5 direct calls against the candidate-filtering logic
(`transfer_condition` includes only condition-kind statuses, `dispel_one`
includes both stat and condition kinds but excludes `temp_hp`, both report
an empty list cleanly rather than erroring on a participant with no
statuses at all).)*

*(Update, same day: Electrify built (`migrate_effects_v46.py`). It looked
like it needed to intercept BEFORE the attack roll/damage calculation
(threading a type override through target-picker.js's own multi-step
attack-roll/damage-roll flow -- real plumbing nothing else in this app
does), but it doesn't: by the time a 'damaged' reaction can even fire, the
hit has already landed using its own type's multiplier, so this is instead
a RETROACTIVE correction against the just-applied log entry, same family as
`reroll_damage`/`undo_crit_damage`/`negate_damage`.

New `_retype_last_damage` (`retype-last-damage` action): reverses the
ORIGINAL type multiplier to recover the raw roll (`amount / multiplier`, a
rounding approximation this app already accepts elsewhere), recomputes the
multiplier with the NEW type against the reactor's own types (reusing
`_type_multiplier` exactly like `_apply_damage_to_target` already does),
and adjusts HP by the difference -- worth noting this can make the hit
WORSE, not just better, if the new type happens to be one the reactor is
vulnerable to; the move's own rules text doesn't promise otherwise, so this
doesn't either. New `kind: "retype_damage"` effect (`{newType}`,
`target:"self"`, `when:"special"` -- same Parry/Captivate/Hover "tick this
after confirming the contested/conditional outcome" pattern, here "after
confirming the attacker's CON save actually failed"). Verified with 6
direct calls against `_retype_last_damage` (recomputes correctly, adjusts
HP by the diff, logs the new type/amount, rejects a same-type retype,
requires holding the reaction floor, requires a damage entry to exist).)*

*(Update, same day: Heal Block, Strength Sap, Spectral Surge, and Snatch
built (`migrate_effects_v47.py`) -- the last hard group in `steal_disrupt`,
all four sharing one real structural gap: each reacts to an ENEMY'S OWN
self-targeted move (a self-buff or self-heal) before it lands, and
`_handleEffectsOnly` (the self-only move flow) never opened ANY reaction
window at all -- every other reaction in this app fires off a 'targeted'/
'damaged' window tied to an externally-chosen target, which a self-only
move never has.

Fixed with one new trigger, `"beneficial"` (`open-reaction-window`'s own
validation; `_eligible_reactors`'s eligibility logic was already trigger-
name-agnostic, so nothing else server-side needed to change), opened from
`_handleEffectsOnly` right before a move's own effects are offered.
Anchored on the CASTER themselves (both anchorId and attackerId -- there's
no separate "target" here). A block cancels the move's own effects
entirely, INCLUDING any ally-targeting half of a mixed move (Tailwind-style
"you and all allies") -- a documented simplification, same "cancels the
whole attack" precedent `block_attack` already has elsewhere (Crafty
Shield), since this app has no mechanism to selectively cancel just one
target's own share of a shared effect. Verified with 5 direct calls against
`_eligible_reactors`/`_open_reaction_window` for the new trigger (in-range
reactor eligible, out-of-range bystander isn't, the caster is excluded from
reacting to their own move, the window records the right move/attacker).

Two of the four needed nothing beyond the new window plus EXISTING kinds:
**Heal Block** is plain `block_attack`, reused as-is; **Strength Sap** is
`block_attack` + a plain `heal` effect (`{dice:"1d10", moveMod:true}`) --
the heal amount has no connection to whatever was negated, so no new
mechanism at all.

The other two needed one new kind, **`steal_buff`** -- "steal the stat
bonus"/"you gain the positive effect", fired `when:"special"` (the same
Parry/Captivate/Hover "human judges a contested/conditional outcome and
ticks the box" pattern): both **Spectral Surge**'s and **Snatch**'s own
trigger involves a THIRD PARTY (the caster) making an attack roll or a
saving throw, a shape `_handleEffectsOnly`'s self-only architecture has
nowhere to run (the exact gap its own docstring already calls out for
Guard Split). `_handleStealBuff` reads `session.pendingReaction`'s own
`moveName`/`attackerId` (still the live window -- the reactor only reaches
their own move-use while holding the floor for it) to find the CASTER's
own authored `kind:'stat', target:'self'` effects, blocks them (reusing
`block-pending-attack`, which is trigger-agnostic), and reapplies them to
the reactor instead. Scoped to stat buffs only -- same "steal only the stat
changes" precedent Spectral Thief's own `stat_transfer` `steal` mode
already uses; Snatch's own broader wording ("curing a negative status
effect... healing... etc") isn't covered. Verified with 5 direct calls
against the buff-filtering logic (a plain self stat buff qualifies, a
set-override effect is excluded since it resolves against live
attacker/target context that doesn't carry over to a stolen copy, a
condition-kind or non-self effect is excluded, a mixed list keeps only the
one qualifying entry).

With this, every `steal_disrupt` move that's buildable with a reasonable
amount of new mechanism is done except the five noted below.)*

*(Update, same day: Covet and Thief built (`migrate_effects_v48.py`) --
previously written off as blocked on "no held-item field anywhere in this
app." That was wrong: `item` is a real, populated, DISPLAYED per-participant
field (a comma-separated freeform string, same shape as `abilities`,
rendered on the combat card), just with no WRITE path during combat --
only ever set once, from the sheet's own data, at participant-creation
time. Fixed with a new `_update_item` (`update-item` action), a plain
client-authoritative field sync, same trust model `_update_stats` already
uses for HP/VP.

New `kind: "steal_item"` effect, handled by `_handleStealItem`: checks the
attacker's own "not currently holding one" gate inside the handler rather
than via the generic `when` vocabulary (it's about the attacker's own
unrelated state, not an attack-roll/save condition). Unlike the ability-
swap group below, an item transfer is PERMANENT -- no duration, no
restore-on-expiry problem to design around. If the target holds more than
one item, takes the first-listed one -- a documented simplification rather
than a new "choose which item" picker, since this app's own data rarely
populates more than one anyway. Covet: `when: {type:"on_hit"}`. Thief:
`when: {type:"save_fail", ability:"DEX", requires:"hit"}` -- the save only
happens after the attack roll hits, matching the move's own text exactly.
Verified with 3 direct calls against `_update_item` and 5 against the
steal-resolution logic (basic steal, attacker-already-holding blocks it,
target-has-nothing blocks it, multiple items take the first and leave the
rest, whitespace-only counts as empty-handed).

**`steal_disrupt`'s own final tally: 16 of 18 moves migrated.** The
remaining two, Psychic Fangs and the ability-swap group, each stay
unmigrated for a reason genuinely different from everything built above:

- **Psychic Fangs** ("automatically ends a creature's Light Screen, and
  bypasses Reflect with no effect") -- in this app's own data, Light Screen
  and Reflect are both ALREADY-REDESIGNED REACTION moves ("use your
  reaction to take half the damage dealt"), not standing barrier statuses
  at all -- there is no "Light Screen status" to end, nothing for this
  clause to act on. The move's own damage (2d8+MOVE psychic) is an ordinary
  attack needing no effects entry of its own, same as Dig/Dive; left
  unmigrated rather than authoring an effect that does nothing.
- **Entrainment / Role Play / Simple Beam / Skill Swap** (all "replace
  one of [a participant's] own abilities with another, for the duration") --
  genuinely harder than the numeric stat swaps above for a structural
  reason, not a missing picker: `abilities` is a raw freeform string with
  NO overlay model the way AC/speed/an ability score has (`effectiveStats`/
  `statSetOverrides` compute those live from active statuses every time, so
  simply removing a status is enough to revert them automatically).
  Verified `_expire_status` has no hook for a custom side effect when a
  SPECIFIC status expires -- every other "temporary change" in this schema
  achieves automatic reversal through that overlay model, which `abilities`
  doesn't have. Building this properly would mean inventing a parallel
  overlay/restore system for a field that currently has none, comparable in
  scope to the stat overlay system itself -- real, but a separate slice,
  not a "choose which" gap this pass's new status/stat pickers could close.)*

*(Update, 2026-10-01: moved to `positioning` (13 moves). 8 of the 13 fit
mechanisms that already existed but had each only ever been used for ONE
move before -- read every move fully before trusting the category label,
same discipline as always (`migrate_effects_v49.py`).

**Push/pull reuses `forced_movement`** (built for Dawn Dance, never reused
since): `kind:"condition"`, `ends:[{type:"instant"}]` means "announced,
never stored" (`_apply_status`'s own instant-conditions branch just logs
the shove as a battle-log entry) -- the human drags the token on the actual
map same as any other manual positioning in this app already works. No new
code at all, just data -- a `note` on each describing the distance/
direction, since unlike Dawn Dance's own single d4-table entry these vary
move to move and are worth having in the effects-popup itself. Circle Throw
(`on_hit`), Lava Cannon (`save_fail`/DEX, already `multi_hit_aoe` so this
rides the existing per-target save loop), Magnetic Pulse (`save_fail`/STR),
Roar (`save_fail`/CHA, also `multi_hit_aoe`), Strength (`on_hit` -- the
move's own "you may ALSO choose to push" is already optional for free,
since the effects-popup already lets a human leave any offered effect
unchecked).

**"Cannot flee or be switched out" reuses `trapped`** (the SAME mechanism
Ingrain/Thousand Waves already use, matching these moves' own near-verbatim
wording -- `_MOVEMENT_BLOCKING_CONDITIONS` already gives it this exact
meaning). Real, enforced automation for the "flee" half (`_move_token`
hard-blocks a trapped participant's own grid movement); the "switched out"
half stays advisory only -- there is no switch-Pokémon mechanic ANYWHERE in
the shared combat system yet (routes_combat.py has no switch action at
all, only the legacy local engine does, and only for Ingrain specifically),
a real, separate, much bigger gap than this migration pass is scoped to
close. Fairy Lock (no save at all -- `when:"always"`, the same `target:
"self"` + target-unset dual-effect shape Haze/Safeguard/Mat Block already
use for an automatic, no-save AoE; `ends:{until_turn, point:"end", count:1}`
for "on their next turn", including on the caster's own self-effect -- the
status is applied WHILE the caster is active, so the existing until_turn
skip logic's default behavior is exactly right here (push the expiry to
the END of their actual next turn, not this one), unlike Confused's own
`noSkip` exception earlier this session, which needed the OPPOSITE because
it has to expire at the end of THIS SAME turn instead), Mean Look
(`save_fail`/WIS, `ends:{rounds,n:3}`, the move's own stated duration),
Spirit Shackle (`on_hit`, `ends:{type:"other", text:...}` -- "while the
user remains in battle" matches no existing `ends` entry, so this uses the
vocabulary's own catch-all exactly as documented for cases like it).

The remaining 5 stay unmigrated: **U-turn**/**Volt Switch** need no effects
entry at all -- their own "move up to half your speed away... or switch
out" needs nothing new for the movement half (a player can already freely
use the existing, fully-working move-token feature afterward, same "the
app doesn't need to gate what's already open" reasoning Dig/Dive's own
un-automated "with advantage" clause gets) and the switch-out half is the
same unbuilt mechanic noted above. **Block** reacts to an opponent
attempting to flee/switch out, which has no trigger point to hook into at
all (no reaction window opens before a token move is attempted, and
switch-out still isn't a mechanic here). **Pasta Portal** compounds THREE
separate unbuilt systems (a persistent walkable map hazard, a "flee the
whole encounter" group-check mechanic distinct from grid movement, and the
same switch-out gap) -- not a small increment on anything already built.
**Strafe**'s own post-hit reposition is a special grant explicitly OUTSIDE
the normal movement budget ("ignoring your flying speed"), unlike U-turn/
Volt Switch's plain "up to half your speed" (ordinary budgeted movement,
needing nothing new) -- reusing `_move_token` directly would incorrectly
check/consume the character's own ordinary per-turn allowance for a move
whose text says it doesn't; needs a "reposition that bypasses the normal
movement budget" action that doesn't exist, plus the same switch-out
alternative.)*

*(Update, 2026-10-01: moved to `heal_target_or_aoe` (9 moves). Per the
user's own steer, skipped `field_terrain`/`field_weather` entirely --
`weather`/`terrain` are both just freeform `{name, effect}` strings with no
structured hooks behind them at all (confirmed building Defog), so nearly
every move in those two categories would need a real terrain/weather effect
system built from scratch, not a small reuse.

Easy half (`migrate_effects_v50.py`): **Aromatherapy**/**Heal Bell** ("cured
of all negative status ailments", AoE, no save) get a new `stat_transfer`
mode, `"dispel_conditions"` -- the inverse scope of the existing `"dispel"`
(`kind:'stat'` only): this removes every `kind:'condition'` status instead,
no further "negative" filtering needed since this app has no condition ever
authored as a benefit to its own holder. Both ship as the same `target:
"self"` + target-unset dual-effect pair Haze/Safeguard/Mat Block already
use. **Scrub Down** reuses the ALREADY-BUILT `dispel_one` (Searing Flame)
applied immediately, noting the real delayed/concentration-conditional
resolution as a documented simplification rather than new infrastructure.
**Purify** is `dispel_all` (broader than Aromatherapy/Heal Bell's own
condition-only scope, matching its own "all status effects" wording) + a
plain `heal` (`{levelMultiple: 2}`) approximating "twice its level" as a
flat per-use amount, since nothing scales a heal by how many statuses a
dispel just removed. **Pollen Puff** is a plain `heal`
(`{fractionOfDamage: 0.5}`) offered ALONGSIDE the move's own normal
damage, noting that the human needs to zero out the damage roll by hand
when the target turns out to be an ally (this app has no team/faction
concept, same gap `blocking_shield` already has). **Present** needed one
new `when` type, `"natural_roll_at_most"` (the mirror of the existing
`natural_roll`, deliberately NOT gated on `hit` since the move's own text
says a low roll counts on a miss too).

Moderate half (`migrate_effects_v51.py`): **Wish** ("at the end of YOUR
next turn, heal a target in range") exposed a real gap in the `repeat`-heal
machinery -- every prior repeat heal (Aqua Ring, Ingrain) is self-only, so
`_promptTurnHeals`/`_applyRecurringHeal` always healed whoever the status
was HELD BY, with no way to heal someone else. Fixed with a new
`healTargetId` field (added to `_STATUS_FIELDS` -- it was silently dropped
before that) and a new `_offerMoveEffects` special case for the one
combination no existing move needed (`kind:"heal"` + `repeat` + NOT
`target:"self"`): applies the status to the CASTER (so it fires at the
caster's own next turn end) with `healTargetId` pointing at whoever was
picked, while still computing "+MOVE" off the HOLDER's own stats --
backward compatible, since Aqua Ring/Ingrain never set the new field.
**Harmony Breath** ("allied creatures caught in the blast heal for half the
amount rolled") needed `_handleMultiHitAoe` to gain a SECOND multi-target
picker after its main hostile loop, gated on the move having a non-self
heal effect so no other AoE move gets an unwanted extra prompt -- heals
whichever allies the human says were also in the blast off the SAME
`totalDamageDealt` the hostile loop already sums (one shared roll for the
whole blast, not a second one for allies). Verified with 3 direct calls
confirming `healTargetId` persists through `_apply_status` and the status
lands on the caster not the recipient, plus 3 against the client-side
redirect logic (redirects when set, falls back to the holder when absent
or empty -- Aqua Ring/Ingrain unaffected).

**Cactus Bloom** stays unmigrated -- it compounds three separate things
this app has no hook for at all: a "participant just fainted" reaction
trigger (nothing like it exists -- every reaction here fires off an
attack/damage/self-buff moment, never a fainting event), real death-save
tracking to add a failed one to, and a persistent, pickable battlefield
object (the same hazard-tile gap Pasta Portal's own deferral already
named). Not a small increment on anything already built.)*

*(Update, 2026-10-01: moved to `movement` (8 moves) -- and found that
Speed Swap (`steal_disrupt`, `migrate_effects_v44.py`) never actually
worked. It was authored as `stat_transfer`/`swap_value` with `field:"speed"`,
modeled on Guard Swap's own `field:"ac"` -- but `effectiveStats(p).speed` is
always `undefined`: `speed` was never one of the flat scalar fields
`effectiveStats` resolves (only `ac`/`crit`/the six ability scores are). A
participant's actual movement lives in `speeds`, a whole ARRAY of `{type,
ft}` entries, a shape `swap_value`'s whole design assumes away. In practice
this meant Speed Swap's own handler always hit the "couldn't read
AC/SPEED for both sides" fallback and silently did nothing, every time --
caught while reading Ascension/Phase, which also touch `speeds`.

Fixed (`migrate_effects_v52.py`, overwriting the broken data) with a new
`stat_transfer` mode, `"swap_fastest_speed"`: reads each side's own FASTEST
recorded speed (`maxSpeed`, now exported from move-effects.js -- the same
helper Electro Ball's own comparison already used internally) as a
reasonable approximation of "their speed" rather than a full per-type array
swap, carried as a new `apply:"speed_override"` CONDITION instead of a
`kind:'stat'` one (nothing reads a stat-kind "speed" field either).
`_movement_budget` now checks for it and, when present, REPLACES the
holder's entire `speeds` list with just that one overridden number for the
duration -- the existing status `ends` machinery handles expiry with no
extra code. Verified with 6 direct calls against `speed_override`/
`granted_speed_entries`, 5 against the full `_movement_budget` integration,
and 5 against `maxSpeed` itself.

The same `_movement_budget` extension also picked up a new
`granted_flight_speed` condition for **Ascension** ("their flight speed
becomes 30ft for the duration") -- ADDS an entry alongside the participant's
real ones (a genuinely new movement type they didn't have before) rather
than replacing, the opposite of `speed_override`'s own behavior; a
participant with NO recorded `speeds` at all still gets a real budget from
the grant alone. `target` unset (grants to a chosen creature, not the
caster), `ends:{rounds, n:10}` (the move's own stated "1 minute").

**Ally Switch** ("switching places on the battlefield") got a new `kind:
"teleport_swap"` effect, `_handleTeleportSwap`: reads both tokens' CURRENT
board positions and swaps them via two `set-token-position` calls -- the
same unrestricted reposition the DM's own board editor already uses ("NOT
turn-gated" by design), reused for a player's own move instead. No new cell
to PICK at all here -- both destinations are already known (wherever the
OTHER creature currently stands) -- which is exactly what makes this
buildable while **Teleport** isn't: Teleport's own "reappear at an
unoccupied point" needs the human to choose an ARBITRARY new cell, and the
battle-map's own grid has NO coordinate labels anywhere at all
(`gridCellsHtml` renders blank clickable squares -- nothing a text prompt
could ask for that the human could read back off the actual physical
display). A real fix would need a "teleport mode" added to battle-map-
popup.js's own existing stage/confirm click flow (skip the distance check,
call `set-token-position` instead of `move-token`) -- a live, heavily-used
tool this pass isn't risking a blind refactor of. Also references the same
unbuilt "flee the whole encounter" group-check mechanic Pasta Portal's own
deferral already named.

The remaining 5 stay unmigrated too: **Extreme Speed**/**Quick Attack**
("you can immediately move up to Xft... without taking an attack of
opportunity") need no new effect at all -- opportunity attacks aren't
automated anywhere in this app, and the movement itself is ordinary
budgeted movement a player can already use via the existing map UI, same
reasoning U-turn/Volt Switch already got. **Phase** ("move up to 30ft
through solid matter") -- "through solid matter" is moot on its own terms,
since this app has no wall/collision system at all (confirmed for Shield
Dome's own deferral), so normal movement already passes through anything;
its own 30ft figure plausibly exceeds a plain walker's speed, which WOULD
need a temporary grant like Ascension's, but unlike Ascension naming a
real, distinct movement type (flight), "phasing" has no mechanical identity
separate from ordinary movement once walls are moot -- left unmigrated
rather than overreaching a generic "+30ft" grant onto a condition name that
wouldn't mean anything. **Splash** ("leap up to 50 feet in the air") is
flavor-only -- this app's grid has no vertical/altitude dimension for a
leap to interact with. **Retaliate** ("When a creature causes an ally to
faint...") reacts to a "participant just fainted" event, the exact same
unbuilt reaction trigger Cactus Bloom's own deferral already named.)*

*(Update, 2026-10-01: moved to `potential_damage_increase` (6 moves). 4 of
the 6 fit two new conditions, both reusing the EXISTING `damage_note`/
`diceMultiplier` machinery end to end -- no new result field, just two new
ways to decide whether it applies (`migrate_effects_v54.py`):

- **Avalanche** / **Payback** ("if the target has damaged you [since the
  end of your last turn / earlier this round], double the damage"): a new
  TARGET-conditional type, `"target_damaged_me_this_round"`. Unlike every
  other target-conditional check so far, this needs the shared battle LOG,
  which `_targetConditionMet`/`targetDamageNoteResult` deliberately never
  reach into themselves (pure functions over explicit params) -- resolved
  by the CALLER instead: target-picker.js now keeps its own one-time
  snapshot of `log`/`round` (captured alongside `_attacker`, same "taken
  once at pickTarget's own start" limitation those already have) and passes
  a plain computed boolean through. Avalanche's own "since the end of your
  last turn" is approximated as "this round" -- correct in the standard
  case of each combatant acting once per round, called out as a documented
  simplification rather than tracking exact turn boundaries per
  participant.
- **Fusion Bolt** / **Fusion Flare** ("if Fusion Bolt or Fusion Flare was
  already used this round, double the damage"): a new SELF-conditional
  type, `"self_move_used_this_round"` (`{anyOf: [...]}`), backed by a new
  WIP-bridged field, `movesUsedThisRound` (every move name used by ANYONE
  this round, straight off `'move-used'` log entries, same bridging pattern
  `lastHitMoveStreak`/`witnessedMoveTypes` already use). Fusion Flare wasn't
  even tagged `potential_damage_increase` in the original hand-
  categorization (`fixed_special_damage` instead) -- caught migrating its
  sibling, since the clause is identical word for word; both get the same
  effect.
- **Stomping Tantrum** ("if your last attack missed, double the dice"):
  another new self-conditional type, `"self_last_attack_missed"`, backed by
  a new WIP-bridged field, `lastAttackMissed` (walks the log backward for
  this participant's own most recent `'damage'` or `'miss'` entry,
  whichever comes first -- not bounded by round, since "your last attack"
  means whenever that actually was).

Verified with 4 direct calls against `target_damaged_me_this_round`'s own
threading (`targetDamageNoteResult`), plus 10 against the three log-scan
helpers themselves (round-matching, attacker/target identity, missing
attacker/target, which moves count per round, and which log entry "your
last attack" actually means).

**Round** ("If an ally in range also knows this move, they can join in the
song as a reaction to add an additional damage dice") needs NO effects
entry at all -- the reminder is already fully visible in the move's own
description text shown on the move-popup every time, the same "nothing
hidden that needs surfacing" reasoning Dig/Dive/U-turn/Volt Switch already
get. The REAL automation (a live reaction injecting a bonus die into
someone ELSE's in-progress damage roll, mid-flow) would need a new
mechanism this app doesn't have anywhere -- the existing dice-bonus-button
machinery (Sharpen/Growth/Helping Hand) only ever augments the roll's OWN
holder, on an attack or save roll specifically, never a THIRD PARTY's
subsequent damage roll -- but there's nothing actually hidden here for a
reminder to prevent forgetting, so building that isn't needed for the
"don't let the table forget a damage bonus" goal `damage_note` exists for.

**Echoed Voice** ("if any OTHER creature in range uses this move, they may
double their damage dice on a hit... stacks to 8x, resetting on a miss")
stays unmigrated -- a genuinely different, multi-part shape from everything
else in this category: a CROSS-CREATURE streak (unlike Fury Cutter/Ice
Ball/Rollout's own same-caster-only counter), gated by a TIME WINDOW tied
to the ORIGINAL caster's own next turn (which has to be tracked somewhere,
since the shared log alone has no notion of "is this window still open" --
a `'move-used'` entry doesn't carry who opened what window or when it
closes). Would need either a new top-level session field (parallel to
`pendingReaction`) tracking the window's owner/expiry/current multiplier,
or a stored per-participant status every potential user has to carry and
check -- real new infrastructure, not a small increment on
`_lastHitMoveStreak`.)*

*(Update, 2026-10-01: `attack_suppression` built (`migrate_effects_v55.py`,
5 of 6 moves). The category's own real blocker was server-side, not
client-side: nothing anywhere checked whether a move was currently USABLE
before `_apply_move` ran it. Fixed with two new `conditions.py` lookups,
`disabled_moves(participant)` (every move NAME currently forbidden, off
every `apply:"move_disabled"` status) and `move_lock(participant)` (the ONE
move name still allowed, off `apply:"move_locked_to"`), both checked in
`_apply_move` right after the existing incapacitation check. With that in
place, every move but one turned out buildable:

- **Disable** ("choose one of the opponent's known moves... this move is
  now disabled") needed a genuine human CHOICE -- new `kind:"disable_move"`,
  `_handleDisableMove` (combat-wip.js), opening a new `pickOneMoveName`
  popup over the target's own `.moves` array. `status-picker.js`'s own
  `pickOneStatus` was generalized into a shared `_pickFrom` core this pass
  so it can list either live statuses (its original job) or plain move-name
  strings -- the only difference between the two is how an item renders,
  not the picking mechanics themselves.
- **Imprison** ("unable to use any Move it knows that is the same as
  yours") needed no picker at all -- the overlap between the CASTER's own
  `.moves` and the target's `.moves` is exact, already-known data on both
  sides. New `kind:"disable_overlapping_moves"`,
  `_handleDisableOverlappingMoves`: disables every name in that overlap as
  its own separate `move_disabled` status sharing one duration
  (`disabled_moves()` unions whatever's live, so N statuses works the same
  as one).
- **Oblivion Ink** ("the last move used by the creature is disabled") is
  also fully computable -- a new `_lastMoveUsedBy` log-scan helper (same
  backward-walk convention as `_didLastAttackMiss`) reads the target's own
  most recent `'move-used'` entry. New `kind:"disable_last_used_move"`,
  `_handleDisableLastUsedMove`.
- **Encore** / **Torment** (both reactions: "force [whoever just
  targeted/hit you] to make a WIS save... on a fail, [it] can only use /
  cannot use the move that targeted/hit you") share the one real structural
  gap in this category: both moves' own effect targets the ORIGINAL
  ATTACKER, a third party relative to the reactor casting them -- something
  `_handleEffectsOnly`'s normal `pickMultipleTargets` (a free pick of ANY
  participant) has no way to resolve automatically. Fixed with two pieces:
  1. `_handleEffectsOnly` now checks for a live `session.pendingReaction`
     anchored on the reactor themselves before falling back to
     `pickMultipleTargets` -- when one's open (which it still is: the
     reactor only reaches their own move-use while holding the floor for
     the SAME window, the same precedent `_handleStealBuff` already
     established for `steal_disrupt`'s reaction moves), its own
     `attackerId` becomes the one and only target automatically. This
     reuses the EXISTING `save_fail` + `confirmSecondarySave` machinery for
     free -- the save prompt just runs against the auto-resolved attacker
     like any other real target.
  2. The move NAME to lock/disable isn't knowable at authoring time either
     (it's "whichever move just hit the reactor", not fixed) -- a new
     `value: {fromPendingReactionMove: true}` sentinel, resolved in
     `_offerMoveEffects`'s own picks loop (same "mutate a clone, fall
     through to the normal path" shape `_resolveSetValue`'s own caller
     already uses for Guard Split's `avgWithTarget`) by reading
     `session.pendingReaction.moveName`. From there it's a plain
     `kind:"condition"` effect needing no new kind at all -- Encore applies
     `move_locked_to`, Torment applies `move_disabled`. Both use
     `ends:{type:"until_turn", whose:"holder", point:"start", count:1}`
     ("for its next turn") -- already-implemented vocabulary, just never
     previously exercised by anything in this category.

**Throat Chop** ("unable to activate sound-based attacks") stays
unmigrated: there's no sound-based move TAG anywhere in this dataset
(confirmed -- no `soundBased`/`sound_based` key on any move), so there's no
way to even evaluate the restriction, let alone enforce it. Advisory-only,
same as every other "the data just doesn't carry this distinction yet" gap
in this schema (team/faction, wall/collision, ...).

Verified with 7 direct calls -- 3 against `disabled_moves`/`move_lock`'s own
reading logic (a disabled-move set, a lock value, an empty-statuses
participant reporting cleanly), and 4 against `evaluateEffect`/
`buildStatusSpec` for the three new kinds plus the `fromPendingReactionMove`
sentinel shape (`disable_move`'s `needs_save`/`yes`/`no` verdicts,
`disable_last_used_move`'s `on_hit` gating, `buildStatusSpec` passing the
unresolved sentinel through untouched since the resolution itself happens
one level up in `_offerMoveEffects`, before `buildStatusSpec` is ever
called on the mutated clone).)*

*(Update, 2026-10-01: `drain` built (`migrate_effects_v56.py`, all 4
moves) -- heals the user for a portion of damage dealt, same family
Absorb/Drain Punch/Parabolic Charge/Soul Drain/Tera Drain already cover,
except all four of these drain VP instead of HP.

**Energize** / **Enervation Ray** needed NOTHING new in the `effects`
vocabulary -- a plain `heal` effect with the EXISTING `pool:"VP"` field
(built earlier for Recompose's flat-dice VP heal, never exercised by a
`fractionOfDamage` amount before) does the drain-back half exactly like
Parabolic Charge/Soul Drain/Tera Drain already do for HP. The real gap was
upstream of `effects` entirely: `ctx.damageDealt` (what `fractionOfDamage`
reads) was only ever populated from `CombatAPI.applyDamage`'s own result,
which always wrote to `currentHP` -- neither move's own PRIMARY damage had
anywhere to land on VP in the first place. Fixed at the one spot that
actually does the writing, `routes_combat.py`'s `_apply_damage_to_target`,
now taking a `pool` param: keeps the SAME type-effectiveness multiplier
(both moves' own text still names a damage type), but skips the HP-
specific shields nothing in this dataset gives VP an equivalent of (temp HP
absorption, Mat Block/Testudo Formation's standing reduction) and writes to
`currentVP` instead. Threaded through via the already-existing `damage_vp`
hand category (untouched by any derived-tag rebuild, since no effect `kind`
produces it) -- a new client-side `_applyPrimaryDamage` (combat-wip.js)
wraps `CombatAPI.applyDamage` with this one tag check, dropped into the two
EXISTING save-triggered damage call sites (`_handleSaveTriggered`,
`_handleMultiHitAoe`'s own loop) so both moves -- and any future
`damage_vp` move using either flow (Purgatory) -- get VP-pool support for
free, no per-move special-casing.

**Grudge** / **Spite** (both reactions) share Encore/Torment's own
third-party-target shape from `attack_suppression`: the effect's "target"
is the ORIGINAL ATTACKER, auto-resolved from the still-live
`session.pendingReaction` (`_handleEffectsOnly`'s own pendingReaction-
anchored auto-targeting, already built, needed no changes). New
`kind:"drain_attacker_vp"`, `when:"special"` (Grudge's own extra "only if
this reduced YOU to zero HP" gate has to run BEFORE any save is even
offered, no `when` vocabulary covers that, so the whole flow is
self-contained in `_handleDrainAttackerVp`, same shape as
`_handlePreventFaint`/`_handleStealBuff`). Two amount sources: Grudge's own
flat "3d10 VP" is genuinely un-rollable elsewhere (no digital dice anywhere
in this app) -- a new `promptDrainRoll` (`heal-popup.js`, generalized this
pass into a shared `_promptRoll` core alongside the existing
`promptHealRoll`, just worded for a drain). Spite's own "whatever VP the
attacking move actually cost" needs no roll at all -- that figure was
already deducted and logged (`_apply_move`'s own `vpCost` on every
'move-used' entry); a new `_vpCostOfMoveUsed` log-scan (same backward-walk
convention as `_lastMoveUsedBy`) reads it straight off the log instead
(`vpCostFromLog: true`). Grudge's own escalating "subsequent uses this
encounter need a DC15 d20 roll for the healing to land" stays manual, same
precedent as the whole Protect family's own escalating cost.

**Bugfix, same pass**: Encore and Torment (`attack_suppression`,
`migrate_effects_v55.py`) shipped with real `effects` but no top-level
`reactionTrigger`/`reactionRange` fields -- `_eligible_reactors` gates
purely on `m.get('reactionTrigger') == trigger`, so neither move could
actually have opened as a reaction at all; the whole mechanism built for
them was unreachable. Every earlier reaction-move pass (v46, v47) DID set
this via a sibling `fields` key next to `effects` -- v55 simply never did,
a plain oversight. Fixed via a fields-only patch (their `effects` are
untouched).

Verified with 4 direct calls: `_apply_damage_to_target`'s new `pool='vp'`
branch (drains `currentVP`, leaves `currentHP` untouched, logs `pool:'vp'`
and VP-worded text) and its unchanged `pool='hp'` default (identical
behavior to before this pass, confirmed side by side against the same
state), plus `evaluateEffect`/`buildStatusSpec` against the new `heal`
`pool:"VP"` + `fractionOfDamage` combo and `drain_attacker_vp`'s `special`
verdict.)*

*(Update, 2026-10-01: `remove_item_on_target` built (`migrate_effects_v57.py`,
all 3 moves) -- the last of the size-ordered `drain`-and-smaller categories.
All three reuse the `item` field + `update-item` action built earlier for
Covet/Thief (`steal_disrupt`), just with two shapes `steal_item`'s own
handler doesn't cover:

- **Knock Off** ("any held item of the target falls to the ground... for
  the rest of battle") -- new `kind:"drop_item"`: nothing moves to the
  attacker, the item is just gone. `_handleDropItem` clears the target's
  own `item` field, no gate on the attacker's state (unlike `steal_item`,
  Knock Off doesn't care whether the attacker already holds something).
- **Switcheroo** (DEX save) / **Trick** (melee attack roll) -- new
  `kind:"swap_item"`: a full two-way exchange of the WHOLE `item` string on
  each side, not `steal_item`'s "only if empty-handed, take just their
  first-listed item" shape (a straight swap has no one-item constraint to
  honor). `_handleSwapItem` covers Switcheroo's own "if you do not have a
  held item, you simply take theirs without replacement" for free --
  swapping an empty string into the target IS "no replacement given", no
  special-casing needed.

No new infrastructure beyond the two small kinds -- both reuse the
already-built `item` field/`update-item` action end to end. Verified with 5
direct calls against `evaluateEffect` for both kinds (`drop_item`'s
`on_hit` gating, `swap_item`'s `save_fail`/`on_hit` verdicts across both
moves' own trigger shapes).

This closes the size-ordered `drain`-and-smaller run entirely. What's left:
leftover one-offs flagged as genuinely novel inside categories already
visited (Echoed Voice/Round, Cactus Bloom, Stored Power, Throat Chop), the
larger not-yet-touched categories (`field_terrain`/`field_weather`,
`positioning`/`protect_negate`/`steal_disrupt` remainders), and the 32
"unknown" moves needing manual review.)*

*(Update, 2026-10-01: `heal_self` built (`migrate_effects_v58.py`, both
moves) -- the last of the size-ordered small categories.

**Burning Glance** needed nothing new at all: no `trigger_saving_throw`
tag, so it's a plain melee attack going through the ordinary single-target
attack-roll flow like any other damage move ("reaction" only changes WHEN
it's used, via the pre-existing reaction-floor mechanism, never WHICH flow
handles it) -- just a `heal` effect gated `when:"crit"` (an existing
`evaluateEffect` case, never exercised by anything in this category
before) instead of `on_hit`, `pool:"VP"` reusing the same field `drain`
built out for Energize/Enervation Ray/Recompose.

**Refresh** ("curing poison, paralysis, and burn") needed one new small
`stat_transfer` mode, `"cure_named"` -- a NAMED subset, narrower than the
existing `dispel_conditions` mode (Aromatherapy/Heal Bell's own "all
negative status ailments"): an unrelated condition like Confused is
correctly left untouched, since Refresh's own text names only these three.
`names` (array of `apply` values) says exactly which; one new filter line
in `_handleStatTransfer`, reusing the same `remove()` helper every other
dispel mode already has.

Verified with 4 direct calls: `evaluateEffect`'s `crit` gating (yes on a
crit, no on a normal hit or a miss) and `cure_named`'s own filter logic
(matches only the named conditions, leaves an unrelated condition and a
stat-kind status both untouched).

**This closes the entire size-ordered "small category" run.** What remains:
leftover one-offs already flagged as genuinely novel inside categories
visited earlier (Echoed Voice/Round, Cactus Bloom, Stored Power, Throat
Chop), the larger not-yet-touched categories (`field_terrain`,
`field_weather`, and the remainders of `positioning`/`protect_negate`/
`steal_disrupt`), and 32 "unknown" moves needing manual review before
anything else.)*

*(Update, 2026-10-01: first batch of the 35 "fits the schema already, just
not migrated yet" moves built (`migrate_effects_v59.py`, 14 of 35). Read
all 35 fresh rather than trusting the coarse label (same lesson as every
prior "don't repeat a category's own summary back without checking"
correction) -- grouped by the real blocker each one actually shares:

**`stat:"speed"`** -- never wired in anywhere before this pass (`speeds` is
a whole array of movement TYPES per participant, not a flat scalar the
existing additive statDeltas machinery has any notion of). Two new
`conditions.py` lookups, both folded into `_movement_budget`:
`speed_bonus_entries` (flat ADDITIVE `amount`, a plain number, stacking via
the existing `stacks` mechanism) and `speed_multiplier_entries`
(MULTIPLICATIVE, `amount:{multiplier}`, combined separately from the
existing debuff-only `effective_speed_multiplier` table since a buff
doesn't compose the same way). A new optional `appliesTo` field (one speed
`type` string, or `'all'` by default) scopes either shape to ONE movement
type so a buff that only touches water (Surface Glide) doesn't leak onto
an unrelated type the same participant also has. Built: Agility (+20 all),
Autotomize (+10, stacks to +30), Flame Charge (+5 per hit, stacks to +30,
`when:"on_hit"`), Kinesis (+20 each to walking/flying/swimming -- only the
speed half; its own "+2 AC vs ranged attacks" needs AC scoping this app has
no equivalent of, a different gap), Surface Glide (x2, `swimming` only),
Tailwind (x2, `'all'`, granted to the caster AND every ally in range via
the existing target:'self' + target-unset dual-effect AoE shape
Aromatherapy/Heal Bell already established).

**STAB doubling** (`increase_stab`, a long-standing tag never backed by a
mechanism -- STAB is computed inline in `pokemon-types.js`'s
`computeMoveData`, not a modifiable status field). New standalone flag
condition `stab_doubled` (same family as `guaranteed_next_crit`/
`guaranteed_next_hit`), read into a new `stabMultiplier` param on
`computeMoveData` -- WIP-only bridged (`combat-wip.js`'s
`_syncLocalCombatState` reads the holder's own live statuses into
`merged.stabMultiplier`, threaded through `combat.js`'s shared
`showCombatMoveDetails` call site), same "always 1 on the legacy
standalone engine" limitation every other live modifier already has.
Compounds multiplicatively with Tough Claws' own doubling. Built: Calm
Mind, Tail Glow.

**Standing incoming-damage shields**, both checked in
`_apply_damage_to_target` AFTER the type multiplier: **Aurora Veil**
("halve all damage dealt to you for three rounds") folds into the EXISTING
`incoming_damage_multiplier` table alongside Mat Block/Testudo Formation
(its own "only while hailing" gate is advisory -- no structured, query-able
weather system exists, same "surface it in the text, trust the human"
philosophy as everywhere else this app handles weather/terrain). **Harden**
("reduce any damage dealt to you by 1d4 + MOVE") is a FLAT subtraction
instead, a new sibling function `incoming_flat_reduction` keyed off a new
`damage_reduction` condition -- its reduction amount is rolled ONCE at cast
time via a new `promptValueRoll` (`heal-popup.js`'s shared `_promptRoll`
core generalized a third time, a bare-number sibling to
`promptHealRoll`/`promptDrainRoll` for a condition's own `value` rather
than an immediate HP/VP change).

**Aura Theft** ("the target loses ALL beneficial effects... the user gains
the effects of ONE of these, user's choice") -- a new `stat_transfer` mode,
`"steal_choice"`: every positive `kind:'stat'` status still comes OFF the
target (same as plain `'steal'`), but only ONE is recreated on the
attacker, picked via the EXISTING `pickOneStatus` popup, reused as-is.

**Divine Noodle Form** ("half of your current max HP as temporary bonus
HP") -- a new `temp_hp` amount shape, `{fractionOfMaxHP}`, resolved the
same dynamic-value way `_offerMoveEffects` already resolves `avgWithTarget`/
`fromPendingReactionMove`/Harden's own roll. Its melee-reach increase isn't
enforced (no positional/range system anywhere in this app), flagged in the
effect's own `note` rather than silently dropped.

**Wing Buffer** ("on a successful [reactive] save, you take half damage")
-- the one `reactive_save` move already wired to `_handleReactiveSave`
(auto-detects the attacker/DC, prompts the save), just never applying its
own outcome; that function's own fallback text literally said "apply its
effect manually (e.g. half damage)" as its anticipated example. New
`kind:"halve_damage"`, applied DIRECTLY in `_handleReactiveSave` on a PASS
(inverted from every other save-triggered move's own fail-fires
convention) via a new `_handleHalveDamage` -- the same retroactive-
correction family as `reroll_damage`/`negate_damage`/`undo_crit_damage`,
a flat 50% refund with no crit gate.

**Feather Dance** ("the target cannot add proficiency to its attack
rolls") -- a new standalone condition, `no_proficiency_attacks`, checked
directly in `attackRollContext` (subtracts the HOLDER's own live
`proficiency` from their attack-roll delta, not a fixed authored amount
that could drift from it).

Verified with 10+ direct calls: `_movement_budget`'s additive/
multiplicative/scoped/stacked speed combinations (including a scoped bonus
correctly having nothing to apply to when the participant lacks that speed
type at all) composing correctly with the pre-existing debuff multiplier;
`_apply_damage_to_target`'s new flat-reduction and Aurora Veil paths side
by side with the unchanged default; `attackRollContext`'s proficiency
subtraction; `statusLabel`'s new `stab_doubled`/speed-multiplier display
branches; `evaluateEffect`'s `halve_damage` manual verdict.

**The other 21 of the 35 stay deferred this pass**, each needing at least
one MORE new piece beyond what this pass built -- not a guess: Fell
Stinger/Power Split/Power Trick need a "double/average my own current
modifier" formula gated on new when-types (a "did this hit faint the
target" check, a third pickable stat); Nasty Plot/Study need attack-roll
scoping beyond `saving_throws`' existing `ability` field; Foresight needs
a move-type-scoped one-shot immunity-ignore flag; Imperial Guard/Power-Up
Punch/Blood Shield need an accumulating log-scan-derived amount; Spirit
Growth needs VP-cost modifiers; Fire Shield needs a passive always-on
retaliation trigger with no reaction-floor-grab involved; Ink Veil/Miracle
Eye/Odor Sleuth/Topsy-Turvy need stealing/inverting an EXISTING effect;
Wing Command needs a fixed modifier riding alongside a claimable dice
bonus (unverified whether the existing claim UI supports that combination
-- left rather than risk a shallow guess); Thunderstorm Dance needs a
move-TYPE-scoped persistent guaranteed-hit status; Silent Approach needs a
real ability-check roll this app has none of anywhere. Grassy Terrain/
Psychic Terrain/Purgatory share the exact same blocker as the whole
still-untouched `field_terrain` category (no structured, query-able
terrain-effect system) -- fixing them ad hoc here would duplicate that
category's own eventual pass.)*

*(Update, 2026-10-01: `positioning` built (`migrate_effects_v60.py`, 2 of 5
-- the other 3 confirmed needing nothing, not deferred).

**Strafe** ("fly to a position within 30ft. of the target" after a hit,
"ignoring your flying speed and any opportunity attacks") and **Pasta
Portal**'s own self-reposition half ("disappear ... and reappear at an
unoccupied point within range") share one real shape: a GRANTED
reposition explicitly OUTSIDE the normal movement budget -- genuinely
different from ordinary budgeted movement. Previously deferred (see this
file's own `protect_negate`-era entry above) specifically because the
only existing map-click flow, `battle-map-popup.js`'s own stage/confirm
movement UI, is a live, heavily-used tool built for ordinary budgeted
movement -- retrofitting a bypass mode directly into it risked a blind
refactor of something already working (the same reasoning Teleport was
deferred for).

Built properly this pass instead of deferring again: a brand new, wholly
separate module, `utils/reposition-picker.js` -- reuses
`battle-map-grid.js`'s own pure rendering helpers (the same ones
`battle-map-popup.js` itself uses) but owns its own DOM/state entirely, so
nothing about ordinary movement can regress. Shows the board read-only,
highlights every unoccupied cell within a given `maxFt` of a given anchor
point, and resolves via `CombatAPI.setTokenPosition` -- the SAME
unrestricted DM/setup action Ally Switch's own `teleport_swap` already
reuses, since this genuinely isn't a `move-token` call either. New
`kind:"reposition_near"` effect (`anchor:"target"|"self"` picks whose
CURRENT position the radius is measured from -- Strafe's own "near the
target" vs Pasta Portal's own "near wherever I currently stand"),
`_handleRepositionNear` (combat-wip.js).

Pasta Portal ships PARTIAL (self-reposition only, same "partial, flagged,
not guessed" precedent as Acid Armor/Elemental Surge) -- its own lingering
portal pair (a 3-turn, DEX-save-or-Crunch hazard for anyone ELSE passing
through) needs a persistent MAP HAZARD system this app has nowhere (no
wall/collision/trap system at all), and its own "counts as a success in a
group DEX check to flee" PvE clause needs a group-flee-check mechanic that
also doesn't exist -- both genuinely separate, bigger systems.

**Quick Attack** / **U-turn** / **Volt Switch** confirmed needing NOTHING
on a fresh read, not newly decided: opportunity attacks aren't automated
anywhere in this app (so "without provoking an opportunity attack" needs
no code), the "move away" half of U-turn/Volt Switch is ordinary budgeted
movement the existing map flow already covers in full, and their own
"switch out" alternative is blocked on the same already-documented "no
switch-Pokemon mechanic in the shared system" gap cited everywhere else it
comes up. **Block** ("stop an opponent's flee/switch-out attempt") has
nothing to hook into either -- no flee/switch-out ACTION exists anywhere
for a reaction window to trigger off of.

Verified with a headless-Edge smoke test of `reposition-picker.js` against
a synthetic 30x30-grid session (no live server needed): renders all 900
cells, correctly marks exactly 168 as in-range-and-clickable (a 13x13
Chebyshev disc at 30ft/6-cell radius, minus the one cell occupied by the
anchor token itself), flags the other 731 as out-of-range, and the full
click -> stage -> Confirm-button-appears flow fires correctly. Caught and
fixed one real bug in the test fixture itself (a participant missing
`visibility`/`side` threw inside the shared `visibleToViewer` helper) --
not a bug in the new module, confirmed by the SAME fixture working once
those fields were added.)*

*(Update, 2026-10-06: Blood Shield and Fell Stinger built (`migrate_effects_v61.py`/`v62.py`).
**Blood Shield** -- `temp_hp` with `amount:{meleeDamageSinceLastTurn:true}`, resolved in
`_offerMoveEffects` by summing the caster's logged `damage` entries (previous round on) whose move
range is Melee (`findMoveRow(...)[6]`); re-applying replaces the pool, so "won't stack" is free.
**Fell Stinger** -- new `when:{type:"target_fainted"}` (the server's `_apply_damage_to_target` returns
`targetFainted`, HP <= 0; ctx key `targetFainted`), a `stat` amount sentinel `{moveModifier:true}`
(the move's best modifier, resolved to a flat number at apply time), and a live `damage_rolls` stat
consumer: `damageRollBonusOf` -> `computeMoveData`'s `damageRollBonus` (WIP-bridged, flat numbers
only). Artifact Light's damage half could now use it but is a proficiency amount, not yet supported.)*

*(Update, 2026-10-06: **Fire Shield** built (`migrate_effects_v63.py`) -- a passive melee-retaliation condition `retaliation_on_melee_hit` (`value` = damage type, `value2` = dice). `_maybeMeleeRetaliate` (combat-wip.js) runs after a Melee hit lands (single-target and AoE-with-save paths), prompts for the roll on the device that resolved the hit, and calls the new `apply-retaliation` action (`_apply_retaliation`: off-turn, gated on the holder carrying the status). No reaction window. Reusable for Acid Armor's melee clause (that one adds a CON save first).)*

*(Update, 2026-10-06: **Foresight, Odor Sleuth, Miracle Eye** built (`migrate_effects_v64.py`) on one "ignore type immunities" mechanism. `_type_multiplier` now takes the attacker; `_immunity_ignored` reads an attacker-side `ignore_immunities` condition (value = comma-separated attack types; Foresight is one-shot via a `uses` end, spent by `_consume_ignore_immunities`, which binds to the first matching move+round so AoE targets all benefit; Odor Sleuth is a duration aura) or a target-side `immunities_relinquished` (Miracle Eye). A 0x result is recomputed per defending type with an immune type counting as neutral, so the secondary type still applies. New `stat_transfer` mode `dispel_ac` resets every AC modifier (Miracle Eye). Not modeled: Odor Sleuth's "target can't use AC-raising moves" and its range limit.)*

*(Update, 2026-10-06: **Ink Veil** built (`migrate_effects_v65.py`): a standing `ink_veil` condition; `blocking_shield` blocks any incoming `kind:'condition'` apply (same sourceId rule as Mist/Safeguard), and `_inkVeilRegen` (combat-wip.js) catches the "(Ink Veil)" block, prompts one 3d10 roll and regenerates HP and VP by it.)*

*(Update, 2026-10-06: **Nasty Plot, Study** built (`migrate_effects_v66.py`). Attack-roll `roll`/`stat` effects can now be scoped by `ability` (the move's own stat list must include it -- target-picker's injected `setMoveAbilityResolver`) and by `against` (a status field holding one target's id, set from the picked target; Study). `saves_against_its_moves` is now ability-scoped like `saving_throws`. Both are tested via `attackRollContext(attacker, target, moveAbilities)`.)*

*(Update, 2026-10-06: **Spirit Growth** (`v67`): `vp_cost_halved` condition (value = ability), WIP-bridged `vpHalvedAbilities`, folded into combat.js's `vpCostOverride`. **Thunderstorm Dance, Silent Approach** (`v68`): `guaranteed_hit_type` (standing, type-scoped, never consumed; read by `_guaranteedHitFor`) and a reminder-only `silent_approach`. **Topsy-Turvy** (`v69`): `stat_transfer` mode `invert` negates every flat stat status on the target (stack count folded into the amount); `recreate` now converts a stored stack COUNT to `{max}` so copy/steal of a stacking status can't crash the server.)*

*(Update, 2026-10-06: **Wing Command** (`v70`): a dice attack bonus whose `moveMod:true` folds the caster's modifier into the dice label ("1d6+3"). **Power Trick, Power Split** (`v71`), held since the category-2/3 passes, turned out to need only two more `stat_transfer` modes on the existing chosen-field dropdown (now with per-mode option lists in effects-popup.js): `swap_own_ac` (caster's AC <-> a chosen ability score, CON excluded, both as `set` overrides) and `average_value` (caster's chosen STR/DEX/WIS overridden with the floor-average of theirs and the target's).)*

*(Update, 2026-10-06: **Power-Up Punch** (`v72`): a stackable `power_up` condition (server stacking now also allowed for this one condition; `stacks.max:"proficiency"` resolved from the caster at apply). Per stack: +1d6 on the holder's melee damage (combat.js appends `Nd6`, WIP-bridged `powerUpStacks`) and +1 VP on melee moves (`vpCostOverride`); any incapacitating condition strips the stacks. Server stacking/stripping tested with stubbed state.)*

*(Update, 2026-10-06, `movement` category (`v73`): **Teleport** (40ft) and **Phase** (30ft) use the existing `reposition_near` `anchor:"self"` effect. **Quick Attack, Extreme Speed, Splash** need no effect (ordinary budgeted movement, no opportunity attacks or elevation in the app) and are recorded in `generate_unmigrated_moves.py`'s `HANDLED_OUTSIDE_SCHEMA`. **Retaliate** stays open: it needs a participant-fainted reaction trigger (same gap as Cactus Bloom).)*

*(Update, 2026-10-06, `lethal_faint` (`v74`): the "death"/"dust" outcome is out of scope for this tool by the user's call -- only damage and fainting are modeled. New `faint_on_roll` effect (`min`, `levelGap`) for **Guillotine, Horn Drill, Explosion**: `_handleFaintOnRoll` asks for one d20 per use (cached on the shared ctx; Explosion's creatures share it), auto-fails vs a target 10+ levels above the caster, and on success sets HP to 0. Explosion's targets are a human multi-pick; its once-per-long-rest limit isn't tracked. **Death Ray / Disintegration Ray** are already ordinary save-for-damage moves, so their `lethal_faint` tag is simply dropped. **Retaliate** re-tagged `unknown` (user's call).)*

*(Correction, 2026-10-06: **Explosion**'s once-per-long-rest limit WAS trackable -- the existing recharge machinery (`parseRecharge`, `rechargeStates`, KnownMoves persistence, rest reset) reads a move's `action` field, and Explosion's said only "1 action" with the limit buried in its description. Its action is now "1 action, recharge (long rest)". The level scaling (2 attempts at level 10, 3 at level 18) is NOT modeled: charge counts come from a static "N charges" in the action text, read in three places (combat.js x2, trainer-card.js's own rest-reset copy).)*

*(Update, 2026-10-06: level-scaled charges -- new `js/utils/move-charges.js` (`scaledMaxCharges(moveName, base, level)`, table `CHARGE_SCALING`; only **Explosion** so far: 2 at level 10, 3 at 18) used at the four places that turn a move's `action` text into a charge count: combat.js (`initializeRechargeStates`, `buildPokemonCombatant`), trainer-card.js's rest reset, and continue-journey.js's KnownMoves sync. Add a move to the table to give it level scaling.)*

*(Update, 2026-10-06, `protect_negate` leftovers: on a fresh read, 8 of the 9 remaining moves were already fully handled by top-level flags -- `ignoresProtect` (Aqua Phase, Astral Jet, Fly, Hyperspace Hole, Phantom Force, Phantom Tendril, Shadow Force) and `negatesProtectBlock` (Feint) -- and only lingered in the backlog by category tag; they're now in `generate_unmigrated_moves.py`'s `HANDLED_OUTSIDE_SCHEMA` with reasons. The vanish-then-attack two-turn shape stays deliberately manual (same as Dig/Dive/Bounce). Two small real gaps closed: **Hyperspace Hole** gains the `guaranteed_hit` category ("guaranteed to hit"), and **Phantom Tendril** gains a new client-visible flag `ignoresTargetStatChanges` (listed in `list-move-categories`'s `flags`; target-picker's injected `setMoveFlagResolver` makes `attackRollContext` skip the target's AC modifiers). **Shield Dome** stays with the held field_terrain group.)*

*(Update, 2026-10-06: **semi-invulnerable states** (user's design: a named state per kind of vanishing, so other moves can interact with it). Four plain conditions -- `underground` (Dig), `underwater` (Dive), `airborne` (Bounce, Fly), `vanished` (Phantom Force, Shadow Force, Aqua Phase). Two top-level move fields: `semiInvulnerable: "<state>"` on the vanishing move, and `hitsStates: [...]` on a move that can still hit a held state (Earthquake and Magnitude -> `underground`, Sky Uppercut -> `airborne`; both are served to the client via `list-move-categories`'s `flags`). Flow (`_handleDamageResolved`): first use -> `_enterSemiInvulnerable` applies the state (until the end of the user's next turn) plus a one-use attack-roll advantage and returns -- no target, no damage; second use while still holding the state -> the state is removed, the move is free (`semiHeldMoves` -> `vpCostOverride` 0) and attacks normally with that advantage. Enforcement: `utils/targetability.js` (`filterTargetable`, rule injected by combat-wip.js) hides a held-state participant from `pickTarget`/`pickMultipleTargets`/`pickSaveTarget` unless the move's `hitsStates` lists the state, and `_apply_damage_to_target` rejects the damage server-side the same way (`conditions.py`'s `untargetable_state`). Not modeled: Magnitude's double damage vs the burrowed; Shadow Force's recharge lock can stop its second use; Shadow Force/Aqua Phase's "reappear at a point within range" reposition; a beneficial multi-pick (e.g. an ally buff) also hides a held-state ally.)*

*(Update, 2026-10-06, semi-invulnerable follow-up (user's call): **Bounce** puts its user in a distinct `ethereal_plane` state, not `airborne` (Fly stays `airborne`). `hitsStates` now also set on Bulldoze (`underground`), Whirlpool (`underwater`), and Hurricane, Thunder, Twister (`airborne`), alongside Magnitude/Earthquake (`underground`) and Sky Uppercut (`airborne`). Surf and Gust were deliberately not added.)*

*(Update, 2026-10-06: **Magnitude** deals double damage to a target holding a state in its new `doubleDamageVsStates` field (`["underground"]`): `_stateDamageMultiplier` (combat-wip.js) multiplies the raw damage in both the single-hit path (`_resolveOneHit`) and the AoE save path, per target. The field is served to the client via `list-move-categories`'s `flags`.)*

*(Update, 2026-10-06, `steal_disrupt` (`v75`): **ability overlay.** Entrainment (`give`), Role Play (`take`), Skill Swap (`swap`) and Simple Beam (`replace_with`, replacement "Simple", name only) use a new `ability_swap` effect -> `_handleAbilitySwap` (combat-wip.js; the human picks the abilities via `pickOneAbility`) -> `ability_override` conditions (`value` = replaced ability name, `value2` = replacement "Name;description"). `effectiveAbilities(participant)` / `parseAbilityList` (move-effects.js) overlay them on the session's BASE `abilities` string for the local combatant, the focus panel and foreign cards -- computed fresh, never written to the DB or the stored string, so a swap ends with its status, with the combat, or when the participant leaves it (a Pokemon swapped out), with nothing to undo. **Psychic Fangs** carries `ignoresReactionMoves: ["Reflect","Light Screen"]` (`_eligible_reactors` never offers them against it; note those two moves currently have no `reactionTrigger`, so they aren't offered at all yet).)*

*(Update, 2026-10-06, singletons (`v76`): **Echoed Voice** -- `damage_note` with `diceMultiplierFromMagnitude` fed by a new `self_echoed_voice_multiplier` condition (`echoedVoiceMultiplier`, move-effects.js, node-tested): a chain of the move's hits since the last miss inside the opener's window (until the opener's next turn begins), 2^chain capped at 8, 1x for the opener itself. Needed `turnIndex` on every log entry and `move` on logged misses (`log-event` takes an optional `move`). **Stored Power** -- `damage_note` extra die per active positive attack/damage/AC bonus (`self_active_buff_count` + `statFields`, per-stat counts bridged as `activeBuffCountsByStat`). **Throat Chop** -- `disable_sound_moves`: typed-in 1d4, then `move_disabled` on every move the target knows that has the new `soundBased` move flag (27 moves tagged by hand in v76's `SOUND_BASED` -- review it). **U-turn / Volt Switch** -- on a hit, `reposition_near` anchored on self with new `maxFtFractionOfSpeed: 0.5` (half your fastest speed); "away from the target" and the trainer switch-out aren't enforced. **Round** and **Block** need no effects (recorded as handled). **Cactus Bloom** stays open.)*
