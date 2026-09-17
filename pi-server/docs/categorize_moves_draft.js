// Bootstraps a heuristic first-pass categorization for any move in
// DnD_moves.json not already present in DnD_moves_categorized_draft.json --
// that file is REAL APP DATA now (see upstream.py's fetch_moves and
// routes_combat.py's list-move-categories, both of which read it directly,
// replacing the old live Google Sheet fetch), not scratch analysis, so this
// script is merge-only: an existing move entry (by name) is never touched,
// overwritten, or reordered, no matter what this pass would tag it. Only
// runs for moves genuinely missing from the file -- i.e. move types the
// user hasn't started reviewing yet. The heuristics themselves are still
// unreliable (see every past correction in the git log for this file) --
// always a starting point for manual review, never trust the tags this
// produces at face value.
const data = require('./DnD_moves.json');
const all = [];
for (const t of Object.keys(data.types)) for (const m of data.types[t]) all.push({ ...m, _type: t });

function text(m) { return ((m.description || '') + ' ' + (m.scaling || '')).replace(/\s+/g, ' '); }

// ---- Duration parsing -----------------------------------------------------
function parseDuration(raw) {
  const s = (raw || '').trim();
  const concentration = /concentration/i.test(s);
  const base = s.replace(/,?\s*concentration/i, '').trim();
  let rounds = null;
  let varies = false;
  if (/^instantaneous$/i.test(base)) rounds = 0;
  else if (/^varies$/i.test(base)) varies = true;
  else {
    const m = base.match(/^(\d+)(?:-(\d+))?\s*(round|turn|minute|hour|day)s?$/i)
      || base.match(/^(\d+)d(\d+)\s*(round|turn|minute|hour|day)s?$/i);
    if (m) {
      if (m[3] && /^\d+$/.test(m[2] || '')) {
        // "1d4 rounds" style -- keep as dice notation, don't collapse to a number
        rounds = { dice: `${m[1]}d${m[2]}`, unit: m[3].toLowerCase() };
      } else {
        const n = Number(m[1]);
        const unit = (m[3] || m[2] || '').toLowerCase();
        const mult = unit === 'round' ? 1 : unit === 'turn' ? 1 : unit === 'minute' ? 10 : unit === 'hour' ? 600 : unit === 'day' ? 14400 : null;
        rounds = mult !== null ? n * mult : { raw: base };
      }
    } else {
      rounds = { raw: base }; // "Until encounter ends", "Rest of encounter", "While in battle", "1 + MOVE minutes", etc.
    }
  }
  return { raw: s, rounds, concentration, varies };
}

// ---- Category heuristics ---------------------------------------------------
// Each returns true/false against the move's combined text. Order matters
// for readability only -- a move can match many.
const CATS = {
  damage: m => /\d+d\d+\s*\+?\s*(MOVE)?/i.test(text(m)) && /damage/i.test(text(m)),
  damage_vp: m => /damage/i.test(text(m)) && /\bVP\b/.test(text(m)) && /(VP damage|damage.{0,15}affects VP|losing .{0,10}VP)/i.test(text(m)),
  status_inflict_threshold: m => /(natural (attack roll|roll)|roll(ed)? (a |an )?\d+ or higher|attack roll .{0,20}(is|of|exceeds) \d+|on a roll of \d+)/i.test(text(m)),
  status_inflict_save: m => /(save|saving throw)/i.test(text(m)) && /(poison|paraly|asleep|sleep|confus|frozen|freeze|burn|blind|charm|stun|restrain|grapple|silence)/i.test(text(m)),
  status_inflict_auto: m => !/(save|saving throw|natural (attack )?roll)/i.test(text(m)) && /(poison(s|ed)?|paralyz(e|ed)|(put|puts|is) to sleep|becomes? confused|freezes?|burn(s|ed)?)\b/i.test(text(m)),
  drain: m => /(restored to the user|regain.{0,15}(hp|hit points|vp).{0,10}(equal to|half|as)|heal(s|ed|ing)? for half|you (heal|regain) for half)/i.test(text(m)),
  heal_self: m => /\b(you|yourself|your (own )?(wounds|health)|the user)\b.{0,50}\b(regain(s|ed|ing)?|heal(s|ed|ing)?|gain(s|ed|ing)?|recover(s|ing)?)\b.{0,25}\b(hit points|hp|vp)\b/i.test(text(m))
    || /\b(regain(s|ed|ing)?|heal(s|ed|ing)?|recover(s|ing)?)\b.{0,15}(yourself|your (own )?(wounds|health))/i.test(text(m)),
  heal_target_or_aoe: m => /(\btarget\b|\bally\b|\ballies\b|creature in range|\brecipient\b).{0,40}\b(regain(s|ed|ing)?|heal(s|ed|ing)?|restore(s|d)?)\b/i.test(text(m)) || /\b(regain(s|ed|ing)?|heal(s|ed|ing)?|restore(s|d)?)\b.{0,25}(\btarget\b|\bally\b|\ballies\b|a creature)/i.test(text(m)),
  shield_temphp: m => /\bshield\b/i.test(text(m)),
  crit_range_mod: m => /critical/i.test(text(m)) && /(range|threshold|scores? a critical|crit on)/i.test(text(m)),
  stat_buff_self: m => /(your|you (gain|increase)|gain (a |an )?\+\d)/i.test(text(m)) && /(STR|DEX|CON|INT|WIS|CHA|armor class|\bAC\b|initiative|speed)/i.test(text(m)) && !/target|opponent|enemy|foe/i.test(text(m)),
  stat_buff_ally: m => /(ally|allies|teammate)/i.test(text(m)) && /(increase|gain|boost|\+\d)/i.test(text(m)),
  stat_debuff_enemy: m => /(target|opponent|enemy|foe|creature).{0,40}(disadvantage|decrease|reduc(e|es|ed)|lower(s)?|-\d)/i.test(text(m)),
  field_weather: m => /\b(rain|sun(ny)?|sandstorm|hail|harsh sunlight|fog|snow|weather)\b/i.test(text(m)),
  field_terrain: m => /\bterrain\b/i.test(text(m)),
  positioning: m => /(switch(es)? (out|places)?|swap places|return(s)? to (its|your) (poké ?ball|pokeball)|pulled? .{0,10}(ft|feet|towards)|pushed? .{0,10}(ft|feet)|forced? to switch)/i.test(text(m)),
  protect_negate: m => /(negate|block(s)?|redirect|immune to|protects? (you|the user|your team|an ally)|prevent(s)? (the|an|all)?\s?(damage|attack)|cannot be (targeted|hit))/i.test(text(m)),
  counter_reaction_effect: m => /1 reaction/i.test(m.action || '') && !/negate|block(s)?|redirect|protects?|prevent(s)? (the|an|all)?\s?(damage|attack)/i.test(text(m)),
  steal_disrupt: m => /(steal|snatch|force it to make|prevent(ing|s)? (the )?recovery|its move fails|effect fails)/i.test(text(m)),
  recoil: m => /(you take|user takes|take(s)? damage equal to|damaging it by the same amount|sacrifice(s)? health)/i.test(text(m)),
  // Split 2026-09-17 after manual review turned up systematic false
  // positives on incidental "N times" phrasing unrelated to hitting more
  // than once (a stacking effect capped "5 times", an item usable "3 times
  // per long rest", etc.) -- both new patterns require actual attack-roll
  // language, not just a number-of-times mention anywhere in the text.
  // multi_hit_aoe: one roll/save resolves against every creature in an
  // area at once. multi_hit_same_target: multiple SEPARATE attack rolls,
  // each against a target chosen at the time (often but not always the
  // same one) -- mechanically these need very different app handling (one
  // shared roll applied to N targets vs. N independent target-pick-and-
  // roll passes), which is the whole reason for the split.
  multi_hit_aoe: m => /\ball creatures?\b.{0,60}\b(must (make|succeed)|takes?)\b/i.test(text(m)) && /\b(radius|cone|circle|sphere|line|area)\b/i.test(text(m)),
  // Split 2026-09-17, second pass: multi_hit_same_target further narrowed
  // to moves with NO target-choice language at all (a d4-continue-on-3-or-4
  // chain, e.g. Fury Attack/Rock Blast/Bullet Seed, or a fixed/rolled hit
  // count with no "different targets" wording, e.g. Double Kick/Barrage) --
  // multi_hit_choice pulled out for moves that explicitly let the user
  // pick a target per hit (same or different), e.g. Hyperspace Fury,
  // Hydra Bite, Gear Grind, Twineedle. Same reasoning as the AoE/same-
  // target split: different UI need (no re-targeting vs. re-run the full
  // target-picker each hit).
  multi_hit_same_target: m => /(roll a d4.{0,20}on a result of 3 or 4|continue this process until you fail|make (two|three|\d+) (melee|ranged)? ?attack rolls)/i.test(text(m))
    && !/(any creature\(?s?\)?( you choose)?|do not have to target the same creature|up to (two|three|\d+) targets|targets? in range)/i.test(text(m)),
  multi_hit_choice: m => /(any creature\(?s?\)? you choose|do not have to target the same creature|may target the same creature multiple times|up to (two|three|\d+) targets)/i.test(text(m)),
  fixed_special_damage: m => /(regardless of|reduces? (the )?target('s)? (current )?hp to 1|the (less|more) hp .{0,10}the (stronger|more powerful)|below \d+% of (its |your )?(maximum )?health|double the damage|triple the damage)/i.test(text(m)),
  recharge_locked: m => /recharge/i.test(m.action || ''),
};

const fs = require('fs');
const path = require('path');
const outFile = path.join(__dirname, 'DnD_moves_categorized_draft.json');

const existing = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf-8')) : { moves: [] };
const existingByName = new Map(existing.moves.map(m => [m.name, m]));

const newlyTagged = all
  .filter(m => !existingByName.has(m.name))
  .map(m => {
    const cats = Object.entries(CATS).filter(([, fn]) => fn(m)).map(([k]) => k);
    return {
      name: m.name, type: m._type, action: m.action, range: m.range,
      duration: parseDuration(m.duration),
      reaction: /1 reaction/i.test(m.action || ''),
      categories: cats,
      description: (m.description || '').replace(/\s+/g, ' '),
      moveStat: m.moveStat || '', vpCost: m.vpCost || '', scaling: m.scaling || '',
    };
  });

// Existing entries pass through completely untouched -- new ones (only, if
// any) are appended after them so a diff shows purely additions.
const merged = [...existing.moves, ...newlyTagged];

const uncategorized = merged.filter(m => m.categories.length === 0);
const counts = {};
for (const k of Object.keys(CATS)) counts[k] = merged.filter(m => m.categories.includes(k)).length;

console.log('newly added this run:', newlyTagged.length, newlyTagged.map(m => m.name));
console.log('TOTAL', merged.length);
console.log('UNCATEGORIZED', uncategorized.length);
console.log(JSON.stringify(counts, null, 2));

fs.writeFileSync(outFile, JSON.stringify({ counts, uncategorizedCount: uncategorized.length, moves: merged }, null, 2));
console.log('wrote', outFile);
