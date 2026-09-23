#!/usr/bin/env python3
"""Move migration, fourteenth slice: 28 of the 91 moves unmigrated_moves.md
listed as "fits the schema already, just not migrated" -- that bucket only
checks for a RETIRED_V3 tag, not whether the move's actual TEXT reduces to a
clean stat/roll/condition effect once fully read, and most of these 91
don't: multi-part conditionals, dice-rolled-once debuffs (no mechanism to
roll an amount once and store the result), ability-SPECIFIC roll/save
scoping ("advantage on DEX saves", "advantage on STR checks" -- the roll
vocabulary only has saving_throws/ability_checks broadly, no per-ability
slot), self-damage/recoil, movement speed (still deferred, same call as
the reaction-move slice), VP-cost modifiers, "choose which stat" (Power
Trick/Power Split, already flagged in the schema doc as needing an
extension that doesn't exist), reactive-attack shapes, resource/stacking
systems feeding into other moves (Stockpile's own Spit Up/Swallow link),
and outright novel mechanics (negate-and-convert, dispel, ignore-immunity,
guaranteed-hit-as-a-grantable-status). None of those got forced into a
lossy approximation -- see the exclusion notes below and this script's own
per-move comments for why each specific one didn't make this batch.

Every effect here uses EXISTING kinds only (stat/roll/condition) -- no new
mechanism, same as the schema doc's own framing for this whole "fits now"
category. A few are genuine partials: the move's own text has an extra
clause with no mechanism to express (self-damage, VP upkeep, an ability-
gated "who actually qualifies" the human still judges, escalating same-
encounter costs) -- migrated for the part that DOES fit cleanly, same
partial-implementation precedent used throughout this whole effort
(Sentinel Strike's redirect, Roost's grounded state, Withdraw's level-10
scaling, ...).

One real mistake caught before it landed: an earlier draft gave Aqua
Phase/Dig/Dive/Fly/Phantom Force/Shadow Force (the "vanish, then attack
next turn WITH ADVANTAGE" family) a stored `roll: advantage` effect for
that advantage. Wrong -- their advantage applies to their OWN attack roll,
resolved in the very same _resolveOneHit call that would go on to OFFER
that effect (offered AFTER the hit, not before), so it would never affect
the roll it's supposed to and would instead sit around as a bogus free
bonus for whatever this Pokemon's next unrelated attack happens to be.
Same reasoning already applied correctly to Close Combat/Feint Attack's
own "rolled with advantage" text: nothing to do there at all, the human
just rolls it that way, exactly like every other advantage/disadvantage
declared inline in a move's own description. Limit Break's "this attack
has advantage" clause got the same fix (dropped, kept its crit-range
effect). None of those six moves are in this batch at all now.

NOT in this batch, worth naming since they carry a RETIRED_V3 tag too and
might look like a stray miss otherwise: Roar of Time and Safeguard (their
stat_buff tag doesn't correspond to any actual numeric buff in their own
text -- looks like a stale/incorrect category from the original auto-
categorizer, nothing to migrate).

    python migrate_effects_v16.py            # dry run
    python migrate_effects_v16.py --apply
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from migrate_effects_v2 import tag_for
from migrate_effects_v3 import RETIRED_V3

FILE = Path(__file__).with_name('DnD_moves_categorized_draft.json')


def rebuild_categories(cats, effects):
    derived = []
    for e in effects:
        t = tag_for(e)
        if t not in derived:
            derived.append(t)
    out, placed = [], False
    for c in cats:
        if c in RETIRED_V3:
            if not placed:
                for t in derived:
                    if t not in out:
                        out.append(t)
                placed = True
            continue
        out.append(c)
    if not placed:
        for t in derived:
            if t not in out:
                out.append(t)
    return out


ALWAYS = {'type': 'always'}
ON_HIT = {'type': 'on_hit'}
SELF = 'self'


def when_save(ability, **extra):
    return {'type': 'save_fail', 'ability': ability, **extra}


def stat(name, amount, target=None, when=None, ends=None, stacks=None):
    e = {'kind': 'stat', 'stat': name, 'amount': amount, 'when': when or ALWAYS}
    if target:
        e['target'] = target
    if ends is not None:
        e['ends'] = ends
    if stacks:
        e['stacks'] = stacks
    return e


def roll(mode, on, target=None, when=None, ends=None):
    e = {'kind': 'roll', 'roll': mode, 'on': on, 'when': when or ALWAYS}
    if target:
        e['target'] = target
    if ends is not None:
        e['ends'] = ends
    return e


def cond(apply_, value=None, target=None, when=None, ends=None):
    e = {'kind': 'condition', 'apply': apply_, 'when': when or ALWAYS}
    if value:
        e['value'] = value
    if target:
        e['target'] = target
    if ends is not None:
        e['ends'] = ends
    return e


ROUNDS10 = [{'type': 'rounds', 'n': 10}]  # 1 minute
CONC = [{'type': 'concentration'}]
ENCOUNTER = [{'type': 'encounter'}]
USES1 = [{'type': 'uses', 'n': 1}]
UNTIL_HOLDER_START = [{'type': 'until_turn', 'whose': 'holder', 'point': 'start'}]
UNTIL_HOLDER_END = [{'type': 'until_turn', 'whose': 'holder', 'point': 'end'}]

OVERRIDES = {
    # +2 AC, +2 saves, self, 1 minute. "Forget a move for the duration" has
    # no mechanism (a move-selection restriction) -- left manual.
    'Amnesia': [
        stat('ac', 2, target=SELF, ends=ROUNDS10),
        stat('saving_throws', 2, target=SELF, ends=ROUNDS10),
    ],
    # +10 STR, self, rest of the encounter. The self-damage half (take
    # damage = half max HP) has no mechanism -- `recoil` is a known, still-
    # open gap (see move-effects-schema.md's own list) -- left manual.
    'Belly Drum': [stat('str', 10, target=SELF, ends=ENCOUNTER)],
    # +1 AC, self, stacks to 5, 1 minute. The "vulnerable-type hit strips
    # the stack" clause is conditional/reactive with no mechanism -- manual.
    'Canopy': [stat('ac', 1, target=SELF, ends=ROUNDS10, stacks={'max': 5})],
    # +2 AC self, concentration. The "double STAB next turn" clause needs
    # increase_stab's own not-yet-built mechanism (same gap as Calm Mind/
    # Tail Glow, neither of which made this batch either) -- manual.
    'Charge': [stat('ac', 2, target=SELF, ends=CONC)],
    # "Rolled with advantage" is the move's OWN attack roll -- nothing to
    # do, same as Feint Attack's identical phrasing (see module docstring).
    # The genuinely time-based half -- the target gets advantage against
    # YOU until the start of your next turn -- is a real stored effect.
    # The AC-1d4 debuff has no mechanism (a rolled-once flat amount isn't
    # supported by the stat kind's dice shape, which is opt-in-spend only,
    # see Sharpen/Growth) -- left manual.
    'Close Combat': [roll('advantage', 'attacks_against', target=SELF, ends=UNTIL_HOLDER_START)],
    # AoE cone, CON save, -2 AC on fail, 1 minute. Routes through
    # _handleMultiHitAoe (already multi_hit_aoe-tagged) -- target left
    # unset so it lands on whoever actually failed.
    'Corrosive Mist': [stat('ac', -2, when=when_save('CON'), ends=ROUNDS10)],
    # On-hit secondary WIS save (already trigger_saving_throw_on_hit-
    # routed): -1 to every ability score and AC, stacking to 5, rest of
    # the encounter, plus the "can't flee or be switched out" half via the
    # existing `trapped` condition (same reuse as Ingrain's own).
    'Cursed Gaze': [
        stat('ac', -1, when=when_save('WIS'), ends=ENCOUNTER, stacks={'max': 5}),
        stat('str', -1, when=when_save('WIS'), ends=ENCOUNTER, stacks={'max': 5}),
        stat('dex', -1, when=when_save('WIS'), ends=ENCOUNTER, stacks={'max': 5}),
        stat('con', -1, when=when_save('WIS'), ends=ENCOUNTER, stacks={'max': 5}),
        stat('wis', -1, when=when_save('WIS'), ends=ENCOUNTER, stacks={'max': 5}),
        stat('int', -1, when=when_save('WIS'), ends=ENCOUNTER, stacks={'max': 5}),
        stat('cha', -1, when=when_save('WIS'), ends=ENCOUNTER, stacks={'max': 5}),
        cond('trapped', when=when_save('WIS'), ends=ENCOUNTER),
    ],
    # +4 AC and normal-damage resistance, self, until your next turn --
    # resistance_upgrade already covers "resistant to a type" exactly.
    'Defense Curl': [
        stat('ac', 4, target=SELF, ends=UNTIL_HOLDER_START),
        cond('resistance_upgrade', value='Normal', target=SELF, ends=UNTIL_HOLDER_START),
    ],
    # +2 AC for the caster and whichever allies the multi-target picker
    # says are in formation -- no `ends` (indefinite "while in formation",
    # its own duration field is a stray "Instantaneous"; removed manually,
    # same as any other no-ends status). Advantage on STR saves specifically
    # has no mechanism (no per-ability save scoping exists, see module
    # docstring) and the formation-break bookkeeping is left manual.
    'Enter Formation': [
        stat('ac', 2, target=SELF),
        stat('ac', 2),
    ],
    # +5 AC self, Water immunity self, 3 rounds -- granted_immunity already
    # covers "immune to a type" exactly ("water moves evaporate on you").
    'Ether Pyre': [
        stat('ac', 5, target=SELF, ends=[{'type': 'rounds', 'n': 3}]),
        cond('granted_immunity', value='Water', target=SELF, ends=[{'type': 'rounds', 'n': 3}]),
    ],
    # Advantage on attack rolls for whichever Plus/Minus-ability allies the
    # multi-target picker says qualify (same "human judges who actually
    # has the ability" pattern as Magnetic Flux below) -- concentration.
    'Gear Up': [roll('advantage', 'attack_rolls', ends=CONC)],
    # -1 to attack rolls on a failed WIS save, stacking to 5, 1 minute --
    # concentration (duration carries both a round count and concentration;
    # concentration is the one this whole effort has consistently used
    # when both are present, see Aqua Ring/Royal Guard/Rage/etc).
    'Growl': [stat('attack_rolls', -1, when=when_save('WIS'), ends=CONC, stacks={'max': 5})],
    # +1 to attack rolls, self, stacks to 5, 1 minute.
    'Howl': [stat('attack_rolls', 1, target=SELF, ends=ROUNDS10, stacks={'max': 5})],
    # The self-debuff half of a guaranteed multi-hit damage move (already
    # guaranteed_hit/multi_hit_choice-routed, needs no effects of its own):
    # attacks against you are at advantage until the start of your next
    # turn. Protect/Detect negation and the once-per-short-rest limit are
    # both already-known gaps (protect_negate, resource tracking) -- manual.
    'Hyperspace Fury': [roll('advantage', 'attacks_against', target=SELF, ends=UNTIL_HOLDER_START)],
    # "This attack has advantage" is the move's own roll -- nothing to do,
    # same reasoning as Close Combat. The crit-range widening (19-20 -> 18-
    # 20) is real: `base_crit` (added to this move's categories, a plain
    # category the crit-threshold calc already reads directly, see
    # migrate_effects_v15.py) contributes the first +1, this stat effect
    # the second. The "requires below 50% HP" gate is already
    # situational_use-tagged -- left manual, same as every other
    # situational-use move.
    'Limit Break': [stat('crit', 1, target=SELF, ends=USES1)],
    # AC + proficiency and advantage on saves for whichever Plus/Minus-
    # ability allies the multi-target picker says qualify, until the start
    # of your next turn -- same "human judges who qualifies" pattern as
    # Gear Up above (no mechanism to check a Pokemon's own ability).
    'Magnetic Flux': [
        stat('ac', 'proficiency', ends=UNTIL_HOLDER_START),
        roll('advantage', 'saving_throws', ends=UNTIL_HOLDER_START),
    ],
    # CHA save; on a fail, the target's next attack is at disadvantage.
    # The "you have advantage if they later use a save move" clause is
    # conditioned on the TARGET's own future move choice -- no mechanism
    # for that, left manual.
    'Play Nice': [roll('disadvantage', 'attack_rolls', when=when_save('CHA'), ends=USES1)],
    # Resistance to normal damage (resistance_upgrade) + a flat +1 damage
    # bonus, self, concentration (its own maintain-by-acting break
    # conditions are left to the table, same "human enforces the
    # complicated part" precedent as every move with a genuinely novel
    # expiry rule). "Advantage on STR checks" specifically has no
    # mechanism (ability-scoping gap, same as Growl's own text if it had
    # named DEX) -- left manual, "+1 damage only once per move" nuance
    # also left to the table.
    'Rage': [
        cond('resistance_upgrade', value='Normal', target=SELF, ends=CONC),
        stat('damage_rolls', 1, target=SELF, ends=CONC),
    ],
    # +2 AC for the caster and whichever allies the multi-target picker
    # says are inside the barrier, concentration. Status-condition immunity
    # has no mechanism (only damage-TYPE immunity exists, via
    # granted_immunity -- a different thing) -- left manual.
    'Royal Guard': [
        stat('ac', 2, target=SELF, ends=CONC),
        stat('ac', 2, ends=CONC),
    ],
    # On-hit, -2 AC until the end of its own next turn. Ignoring Ground
    # resistance is a damage-calc nuance with no mechanism -- manual.
    'Sand Lance': [stat('ac', -2, when=ON_HIT, ends=UNTIL_HOLDER_END)],
    # -1 AC, +1 attack, +1 damage, self, 1 minute, no stacking.
    'Shell Smash': [
        stat('ac', -1, target=SELF, ends=ROUNDS10),
        stat('attack_rolls', 1, target=SELF, ends=ROUNDS10),
        stat('damage_rolls', 1, target=SELF, ends=ROUNDS10),
    ],
    # +1 attack, +1 damage, self, concentration. The speed+10 half is still
    # deferred (movement, same call as the reaction-move slice); the
    # spend-2VP-or-it-ends upkeep has no mechanism -- both left manual.
    'Shift Gear': [
        stat('attack_rolls', 1, target=SELF, ends=CONC),
        stat('damage_rolls', 1, target=SELF, ends=CONC),
    ],
    # DEX save (already trigger_saving_throw + damage routed, via
    # _handleSaveTriggered's damage branch): disadvantage on attacks
    # against the failed-save target until the end of its own next turn.
    'Sky Attack': [roll('disadvantage', 'attacks_against', when=when_save('DEX'), ends=UNTIL_HOLDER_END)],
    # +1 AC, self, stacks to 3, 1 minute -- the closest available
    # approximation of "until you use Spit Up/Swallow" (no mechanism to
    # read stack-consumption from a different move). The speed-half,
    # move-restriction, and Spit Up/Swallow link are all left manual --
    # same "the resource-consuming half stays out of scope" reasoning
    # Swallow itself was already excluded for.
    'Stockpile': [stat('ac', 1, target=SELF, ends=ROUNDS10, stacks={'max': 3})],
    # CHA save (already trigger_saving_throw-routed, no damage): on a
    # fail, the CASTER gets advantage on their next two attacks against
    # that target -- `uses: 2` already covers "consumed by the next N
    # applicable rolls" exactly.
    'Sweet Scent': [roll('advantage', 'attack_rolls', target=SELF, when=when_save('CHA'), ends=[{'type': 'uses', 'n': 2}])],
    # Same shape as Close Combat -- "rolled with advantage" is the move's
    # own roll (nothing to do), the target's advantage against you until
    # the start of your next turn is the real stored effect. AC-1d4 left
    # manual for the same reason (no rolled-once-debuff mechanism).
    'Twilight Rush': [roll('advantage', 'attacks_against', target=SELF, ends=UNTIL_HOLDER_START)],
    # -2 AC, self, until the start of your next turn. The same-encounter
    # doubling-per-use escalation is left unmodeled -- no migrated move has
    # a stacking-cost-per-use mechanic yet (same "scaling text left as
    # base value only" precedent as Withdraw's own level-10 bump).
    'V-create': [stat('ac', -2, target=SELF, ends=UNTIL_HOLDER_START)],
    # Fire resistance_upgrade for the caster and whichever allies were in
    # range when cast (multi-target picker), 1 minute -- resistance_upgrade
    # already models "bump one step better" exactly (vulnerable->normal,
    # normal->resistant, resistant->immune), matching this move's own
    # three-tier text precisely.
    'Water Sport': [
        cond('resistance_upgrade', value='Fire', target=SELF, ends=ROUNDS10),
        cond('resistance_upgrade', value='Fire', ends=ROUNDS10),
    ],
}


def main():
    apply_it = '--apply' in sys.argv
    data = json.loads(FILE.read_text(encoding='utf-8'))
    moves = data['moves']
    by_name = {m['name']: m for m in moves}

    missing = [n for n in OVERRIDES if n not in by_name]
    if missing:
        print('ERROR -- unknown move names:', missing)
        sys.exit(1)
    already = [n for n in OVERRIDES if by_name.get(n, {}).get('effects')]
    if already:
        print('ERROR -- already have effects (would overwrite):', already)
        sys.exit(1)

    print(f'{len(OVERRIDES)} moves getting effects')
    for name, effects in OVERRIDES.items():
        print(f'## {name}  ({len(effects)} effect(s))')
        for e in effects:
            print('   ', json.dumps(e, ensure_ascii=False))

    if not apply_it:
        return
    for name, effects in OVERRIDES.items():
        m = by_name[name]
        m['effects'] = effects
        m['categories'] = rebuild_categories(m['categories'], effects)
    FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nwritten')


if __name__ == '__main__':
    main()
