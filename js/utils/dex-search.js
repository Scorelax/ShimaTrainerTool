// Searching a Pokedex by its number -- shared by the players' Pokedex (js/pokedex/player-pokedex.js) and the DM
// console's Pokedex module (js/dm/pokedex.js).

/** What a search box's text asks for: { number } for a dex number ("#5", "# 5", "5", "005", "No. 5", "Nr 5"),
 * { all: true } while only the start of one is typed ("#", "No.") -- everything stays listed -- else null (search the
 * names and types as usual). */
export function dexQuery(term) {
  const t = String(term || '').trim().toLowerCase();
  if (/^(#|no\.?|nr\.?)$/.test(t)) return { all: true };
  const m = t.match(/^(?:#|no\.?|nr\.?)?\s*(\d+)$/);
  return m ? { number: Number(m[1]) } : null;
}
