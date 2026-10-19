// A battle participant's lists (the user's call, 2026-10-19: the battle keeps them as lists like the rest of the app,
// not as text). `abilities` is [{slot, name, description}] -- the owned Pokemon's own shape (slot 2 = hidden, null for an
// ability the DM typed in) -- and `savingThrows` / `skills` / `expertise` / `feats` are lists of names (`expertise`: the
// skills it has expertise in, as on the trainer). These helpers also read a participant from a battle saved before that
// ("0:Name;description|..." and "Strength, Dexterity", "Stealth+" text), so a battle running when the Pi was updated
// carries on.

/** One ability: an {slot, name, description} object, or an old "0:Name;description" / "Name;description" / "Name" entry. */
export function abilityEntry(x) {
  if (x && typeof x === 'object') {
    const slot = x.slot === '' || x.slot === null || x.slot === undefined ? null : Number(x.slot);
    return { slot: Number.isFinite(slot) ? slot : null, name: String(x.name || '').trim(), description: String(x.description ?? x.desc ?? '').trim() };
  }
  const text = String(x || '').trim();
  const m = text.match(/^(\d+):([\s\S]*)$/);
  const [name, ...rest] = (m ? m[2] : text).split(';');
  return { slot: m ? Number(m[1]) : null, name: name.trim(), description: rest.join(';').trim() };
}

/** A participant's abilities as [{slot, name, description}] -- from the list, or from the old "...|..." text. */
export function abilityList(x) {
  const entries = Array.isArray(x) ? x : String(x || '').split('|');
  return entries.map(abilityEntry).filter(a => a.name);
}

/** A list of names -- saving throws, skills, feats: from the list, or from the old comma-separated text. */
export function nameList(x) {
  const entries = Array.isArray(x) ? x : String(x || '').split(',');
  return entries.map(s => String(s ?? '').trim()).filter(s => s && s.toLowerCase() !== 'none');
}

/**
 * {skills, expertise} as plain names -- the pair a trainer, an owned Pokemon and a battle participant keep (the user's
 * call, 2026-10-19: expertise was a "+" on the skill's name, "Stealth+", until then). An old "Stealth+" still reads as
 * the skill plus expertise in it, and every expertise skill is in `skills` too. pi-server/app/battle_lists.py's
 * split_expertise does the same.
 */
export function skillLists(skills, expertise = []) {
  const out = [], exp = [];
  const add = (list, name) => { if (name && !list.some(s => s.toLowerCase() === name.toLowerCase())) list.push(name); };
  for (const s of nameList(skills)) {
    const name = s.replace(/\+$/, '').trim();
    add(out, name);
    if (s.endsWith('+')) add(exp, name);
  }
  for (const s of nameList(expertise)) {
    const name = s.replace(/\+$/, '').trim();
    add(out, name);
    add(exp, name);
  }
  return { skills: out, expertise: exp };
}

/** Whether `name` is in a list of names, any case. */
export function hasName(list, name) {
  const wanted = String(name || '').toLowerCase();
  return (list || []).some(s => String(s).toLowerCase() === wanted);
}

/** A participant's speeds as display text: "Walking: 30, Flying: 60". */
export function speedsText(speeds) {
  return (speeds || []).filter(s => (Number(s.ft) || 0) > 0).map(s => `${s.type}: ${s.ft}`).join(', ');
}
