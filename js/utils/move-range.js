// How far a move reaches, and how far apart two creatures on the battle map are.
//  - moveReachFt(rangeText, size): the farthest a TARGET may be for a move aimed at creatures -- "Melee"/"Touch" 5ft,
//    "30ft." 30ft, "10ft. melee" 10ft; Huge (and bigger) creatures add 5ft to melee/touch reach. null = no per-target
//    limit: "Self", areas (radius/cone/line/... -- the area tools decide who's in), "Varies", "Any", miles.
//  - areaPlacementFt(rangeText): for an area dropped "at a point in range" ("50ft., 10ft. radius"), how far from the
//    caster its centre may go.
//  - creatureDistanceFt(board, a, b): squares between the nearest cells of their footprints (diagonals count 5ft), and
//    a height gap for flyers -- the larger of the two, same as movement. null when either isn't on the map.
import { footprintForSize } from './battle-map-grid.js';

const AREA_WORDS = /radius|cone|line|circle|sphere|cylinder|dome|wide/i;

export function moveReachFt(rangeText, size = '') {
  const t = String(rangeText || '').trim().toLowerCase();
  if (!t || /varies|\bany\b|mile/.test(t) || AREA_WORDS.test(t)) return null;
  const bigReach = footprintForSize(size) >= 3 ? 5 : 0; // Huge and up: +5ft on melee moves
  const melee = /melee|touch/.test(t);
  const ft = /(\d+)\s*ft/.exec(t);
  if (melee) return (ft ? Number(ft[1]) : 5) + bigReach;
  return ft ? Number(ft[1]) : null; // "Self" alone -> null
}

export function areaPlacementFt(rangeText) {
  const t = String(rangeText || '').trim().toLowerCase();
  if (t.startsWith('self')) return null;
  const m = /^(\d+)\s*ft\.?\s*[,(]/.exec(t); // "50ft., 10ft. radius" / "60ft. (20ft. radius)"
  return m ? Number(m[1]) : null;
}

/**
 * The area of a move whose range text has no shape ("30ft.", "Melee") but whose description does -- null when it has
 * none (it picks its targets: Fire Blast's "up to two creatures"). Returns one of
 *   {wallFt, maxStartFt}                      a wall of smoke from a point within range (Smokescreen)
 *   {radiusFt, centeredOnCaster: false, maxCenterFt, heightFt}   a blast dropped within range (Blizzard, Toxic...)
 *   {radiusFt, centeredOnCaster: true}        everyone within N ft of the user (Dark Void, Echoing Screech...)
 */
export function areaFromDescription(rangeText, description) {
  const range = String(rangeText || '');
  const d = String(description || '');
  const rangeM = /(\d+)\s*(?:ft|feet|foot)\b/i.exec(range);
  const rangeFt = rangeM ? Number(rangeM[1]) : null;
  const high = /(\d+)\s*(?:ft|feet|foot)\.?\s*high/i.exec(d);
  const heightFt = high ? Number(high[1]) : null;
  const wall = /\bline\b[^.]*?(\d+)\s*(?:feet|foot|ft)\.?\s*long[^.]*?\bfrom a point\b/i.exec(d);
  if (wall) return { wallFt: Number(wall[1]), maxStartFt: rangeFt };
  const radius = /(\d+)\s*[- ]?(?:foot|feet|ft)\.?[\s-]*radius/i.exec(d);
  if (radius && /\bpoint\b|\bcentered\b|within range/i.test(d)) {
    return { radiusFt: Number(radius[1]), centeredOnCaster: false, maxCenterFt: rangeFt, heightFt };
  }
  const nearPoint = /within (\d+)\s*(?:feet|foot|ft)\.? of (?:that|the|a) point/i.exec(d);
  if (nearPoint) return { radiusFt: Number(nearPoint[1]), centeredOnCaster: false, maxCenterFt: rangeFt, heightFt: null };
  if (/(?:creatures?|enemies|targets?)\b[^.]*\bwithin melee range/i.test(d)) return { radiusFt: 5, centeredOnCaster: true, heightFt: null };
  // "Each creature within 30 feet", "All creatures within 30 feet of you" -- not "within 10ft of the target" / "you pass within".
  const nearYou = /(?:creatures?|enemies)\b[^.]*?\bwithin (\d+)\s*(?:feet|foot|ft)\.?(?:\s+of you)?(?!\s+of\b)/i.exec(d);
  if (nearYou && !/\bpass within\b/i.test(d)) return { radiusFt: Number(nearYou[1]), centeredOnCaster: true, heightFt: null };
  if (rangeFt && /(?:all|each)\s+(?:creatures?|enemies)\s+(?:in|within)\s+(?:range|must)\b/i.test(d)) {
    return { radiusFt: rangeFt, centeredOnCaster: true, heightFt: null };
  }
  return null;
}

function _span(token, size) {
  const n = footprintForSize(size);
  return { c0: token.col, c1: token.col + n - 1, r0: token.row - n + 1, r1: token.row };
}

export function creatureDistanceFt(board, a, b) {
  const ta = board?.tokens?.[a?.id], tb = board?.tokens?.[b?.id];
  if (!ta || !tb) return null;
  const sa = _span(ta, a.size), sb = _span(tb, b.size);
  const dc = Math.max(0, sb.c0 - sa.c1, sa.c0 - sb.c1);
  const dr = Math.max(0, sb.r0 - sa.r1, sa.r0 - sb.r1);
  const vertical = Math.abs((ta.z || 0) - (tb.z || 0));
  return Math.max(Math.max(dc, dr) * 5, vertical);
}

/** Feet from a creature's footprint to one map cell ("col,row") -- the area picker's centre check. */
export function cellDistanceFt(board, p, col, row) {
  const t = board?.tokens?.[p?.id];
  if (!t) return null;
  const s = _span(t, p.size);
  return Math.max(Math.max(0, col - s.c1, s.c0 - col), Math.max(0, row - s.r1, s.r0 - row)) * 5;
}
