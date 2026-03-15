// Shared Pokemon type utilities — used by combat.js, pokemon-card.js, new-pokemon.js

export const SPECIALIZATION_TO_TYPE = {
  'Bird Keeper': 'Flying', 'Bug Maniac': 'Bug', 'Camper': 'Ground', 'Dragon Tamer': 'Dragon',
  'Engineer': 'Electric', 'Pyromaniac': 'Fire', 'Gardener': 'Grass', 'Martial Artist': 'Fighting',
  'Mountaineer': 'Rock', 'Mystic': 'Ghost', 'Steel Worker': 'Steel', 'Psychic': 'Psychic',
  'Swimmer': 'Water', 'Charmer': 'Fairy', 'Shadow': 'Dark', 'Alchemist': 'Poison',
  'Team Player': 'Normal', 'Ice Skater': 'Ice'
};

export function getMoveTypeColor(moveType) {
  const colors = {
    "Normal": "#A8A878", "Fighting": "#e68c2e", "Flying": "#A890F0",
    "Poison": "#A040A0", "Ground": "#A67C52", "Rock": "#a85d16",
    "Bug": "#A8B820", "Ghost": "#705898", "Steel": "#bdbdbd",
    "Fire": "#f02e07", "Water": "#1E90FF", "Grass": "#32CD32",
    "Electric": "#FFD700", "Psychic": "#F85888", "Ice": "#58c8ed",
    "Dragon": "#280dd4", "Dark": "#282729", "Fairy": "#ed919f",
    "Cosmic": "#120077"
  };
  return colors[moveType] || "#ffffff";
}

export function getTextColorForBackground(bgColor) {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

export function parseDamageDice(description, higherLevels, pokemonLevel) {
  const damagePatterns = /melee attack|ranged attack|dealing\s+\d+d\d+|doing\s+\d+d\d+|tak(?:e|ing)\s+\d+d\d+|damage on a hit|hit\s+for\s+\d+d\d+/i;
  if (!damagePatterns.test(description)) return null;
  const diceMatch = description.match(/(\d+d\d+)/i);
  if (!diceMatch) return null;
  let baseDice = diceMatch[1];
  if (higherLevels && pokemonLevel > 1) {
    const tierRegex = /(\d+d\d+)\s+at\s+level\s+(\d+)/gi;
    let match, bestDice = null, bestLevel = 0;
    while ((match = tierRegex.exec(higherLevels)) !== null) {
      const tierLevel = parseInt(match[2]);
      if (pokemonLevel >= tierLevel && tierLevel > bestLevel) { bestLevel = tierLevel; bestDice = match[1]; }
    }
    if (bestDice) baseDice = bestDice;
  }
  return baseDice;
}

/**
 * Compute move attack/damage bonuses for a Pokemon using a given move.
 * Shared by combat.js (showCombatMoveDetails) and pokemon-card.js (showMoveDetails).
 *
 * @param {Array} move - Move data array [name, type, modifier, actionType, vpCost, duration, range, desc, higherLevels]
 * @param {{ types: string[], strMod: number, dexMod: number, conMod: number, intMod: number, wisMod: number, chaMod: number, proficiency: number, stabBonusValue: number, level: number }} pokemonAttrs
 * @param {{ path: string, level: number, specializationsStr: string }} trainerAttrs
 * @returns {{ hasSTAB: boolean, attackBonus: number, damageBonus: number, attackBreakdown: string, damageBreakdown: string, damageDice: string|null }}
 */
export function computeMoveData(move, pokemonAttrs, trainerAttrs, heldItemEffects = []) {
  const { types, strMod, dexMod, conMod, intMod, wisMod, chaMod, proficiency, stabBonusValue, level, hasToughClaws } = pokemonAttrs;
  const { path, level: trainerLevel, specializationsStr } = trainerAttrs;

  const moveType = move[1];
  let hasSTAB = types.includes(moveType);
  const isMelee = /melee\s+attack/i.test(move[7] || '');

  // Type Master Level 15: Universal STAB for Pokemon matching specialization types
  if (!hasSTAB && path === 'Type Master' && trainerLevel >= 15 && specializationsStr) {
    const specTypes = specializationsStr.split(',').map(s => SPECIALIZATION_TO_TYPE[s.trim()]).filter(Boolean);
    if (types.some(t => specTypes.includes(t))) hasSTAB = true;
  }

  // Type Master Level 3: +1 damage per Pokemon type matching specialization (only if move type also matches)
  let typeMasterDamageBonus = 0;
  if (path === 'Type Master' && trainerLevel >= 3 && specializationsStr) {
    const specTypes = specializationsStr.split(',').map(s => SPECIALIZATION_TO_TYPE[s.trim()]).filter(Boolean);
    if (specTypes.includes(moveType)) {
      types.forEach(t => { if (specTypes.includes(t)) typeMasterDamageBonus++; });
    }
  }

  // Type Master Level 5: +2 to attack rolls if Pokemon type matches specialization
  let typeMasterAttackBonus = 0;
  if (path === 'Type Master' && trainerLevel >= 5 && specializationsStr) {
    const specTypes = specializationsStr.split(',').map(s => SPECIALIZATION_TO_TYPE[s.trim()]).filter(Boolean);
    if (types.some(t => specTypes.includes(t))) typeMasterAttackBonus = 2;
  }

  // Ace Trainer Level 3+: +1 to attack and damage
  const aceBonus = (path === 'Ace Trainer' && trainerLevel >= 3) ? 1 : 0;

  // Tough Claws: melee attacks always get STAB; if already STAB, double it
  let toughClawsDoubled = false;
  if (hasToughClaws && isMelee) {
    if (hasSTAB) { toughClawsDoubled = true; }
    else { hasSTAB = true; }
  }

  // Stat mods — pick highest allowed modifier for the move
  const modMap = { STR: strMod, DEX: dexMod, CON: conMod, INT: intMod, WIS: wisMod, CHA: chaMod };
  const moveModifiers = (move[2] || '').split('/').map(m => m.trim().toUpperCase());
  const allowedMods = moveModifiers.map(m => modMap[m]).filter(v => v !== undefined);
  const highestMod = allowedMods.length > 0 ? Math.max(...allowedMods) : 0;
  const usedStat = moveModifiers.find(m => modMap[m] === highestMod) || '';

  // Attack roll bonus
  const profBonus = hasSTAB ? proficiency : 0;
  const attackBonus = profBonus + highestMod + aceBonus + typeMasterAttackBonus;

  // Damage roll bonus
  const desc = move[7] || '';
  const includeStatInDmg = /\+\s*MOVE/i.test(desc);
  const stabBonus = hasSTAB ? (toughClawsDoubled ? stabBonusValue * 2 : stabBonusValue) : 0;

  // Held item: "Holder adds prof. bonus to damage from <TYPE> type moves"
  const heldItemProfPattern = /holder adds prof(?:iciency|\.)? bonus to damage from (\w+) type moves?/i;
  let heldItemDamageBonus = 0;
  const heldItemDmgSources = [];
  if (heldItemEffects.length > 0) {
    console.debug('[HeldItem] moveType:', moveType, '| effects:', heldItemEffects);
  }
  for (const effect of heldItemEffects) {
    const match = heldItemProfPattern.exec(effect);
    console.debug('[HeldItem] effect:', JSON.stringify(effect), '| match:', match);
    if (match) {
      const itemType = match[1];
      if (itemType.toLowerCase() === moveType.toLowerCase()) {
        heldItemDamageBonus += proficiency;
        heldItemDmgSources.push(`Item +${proficiency} (Prof.)`);
      }
    }
  }

  const damageBonus = stabBonus + (includeStatInDmg ? highestMod : 0) + aceBonus + typeMasterDamageBonus + heldItemDamageBonus;

  // Format modifier helper
  const fmt = v => v >= 0 ? `+${v}` : `${v}`;

  // Breakdown strings
  const atkParts = [];
  if (profBonus > 0) atkParts.push(`Proficiency +${profBonus}`);
  if (highestMod !== 0) atkParts.push(`${usedStat} ${fmt(highestMod)}`);
  if (aceBonus > 0) atkParts.push(`Ace Trainer +${aceBonus}`);
  if (typeMasterAttackBonus > 0) atkParts.push(`Type Master +${typeMasterAttackBonus}`);

  const toughClawsGranted = hasToughClaws && isMelee && !toughClawsDoubled && stabBonus > 0 && !types.includes(moveType);
  const dmgParts = [];
  if (stabBonus > 0) {
    let stabLabel;
    if (toughClawsDoubled) stabLabel = `STAB ×2 +${stabBonus}`;
    else if (toughClawsGranted) stabLabel = `STAB +${stabBonus} (Tough Claws)`;
    else stabLabel = `STAB +${stabBonus}`;
    dmgParts.push(stabLabel);
  }
  if (includeStatInDmg && highestMod !== 0) dmgParts.push(`${usedStat} ${fmt(highestMod)}`);
  if (aceBonus > 0) dmgParts.push(`Ace Trainer +${aceBonus}`);
  if (typeMasterDamageBonus > 0) dmgParts.push(`Type Master +${typeMasterDamageBonus}`);
  heldItemDmgSources.forEach(s => dmgParts.push(s));

  const damageDice = parseDamageDice(desc, move[8] || '', level);

  return {
    hasSTAB,
    attackBonus,
    damageBonus,
    attackBreakdown: atkParts.length ? `(${atkParts.join(', ')})` : '',
    damageBreakdown: dmgParts.length ? `(${dmgParts.join(', ')})` : '',
    damageDice,
  };
}
