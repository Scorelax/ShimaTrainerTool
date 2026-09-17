// Scratch analysis script -- categorizes DnD_moves.json into a taxonomy for
// discussion with the user. Not part of the app; deleted once the
// conversation about categories is settled and real handling code (if any)
// is written properly inside pi-server/app.
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
  multi_hit: m => /(twice|two times|\d+(-\d+)? times|multiple times|hits (\d+|twice)|roll(s)? damage .{0,10}(twice|multiple))/i.test(text(m)),
  fixed_special_damage: m => /(regardless of|reduces? (the )?target('s)? (current )?hp to 1|the (less|more) hp .{0,10}the (stronger|more powerful)|below \d+% of (its |your )?(maximum )?health|double the damage|triple the damage)/i.test(text(m)),
  recharge_locked: m => /recharge/i.test(m.action || ''),
};

const tagged = all.map(m => {
  const cats = Object.entries(CATS).filter(([, fn]) => fn(m)).map(([k]) => k);
  return {
    name: m.name, type: m._type, action: m.action, range: m.range,
    duration: parseDuration(m.duration),
    reaction: /1 reaction/i.test(m.action || ''),
    categories: cats,
    description: (m.description || '').replace(/\s+/g, ' '),
  };
});

const uncategorized = tagged.filter(m => m.categories.length === 0);
const counts = {};
for (const k of Object.keys(CATS)) counts[k] = tagged.filter(m => m.categories.includes(k)).length;

console.log('TOTAL', tagged.length);
console.log('UNCATEGORIZED', uncategorized.length);
console.log(JSON.stringify(counts, null, 2));

require('fs').writeFileSync(
  require('path').join(__dirname, 'DnD_moves_categorized_draft.json'),
  JSON.stringify({ counts, uncategorizedCount: uncategorized.length, moves: tagged }, null, 2)
);
console.log('wrote DnD_moves_categorized_draft.json');
