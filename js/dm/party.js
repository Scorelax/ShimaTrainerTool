// DM console -- the Party module: every player trainer with their current party at a glance, and a trainer's full
// page on a click -- their stats, all their Pokemon (each one's full stat block on a click), their money and their
// inventory, where the DM hands out items and money (routes_dm.py's give-item / give-money, which add to what's there
// on the server, so nothing the player just changed is overwritten) and gives Pokemon (give-pokemon.js). Kept live: any change to a trainer (the player's
// own, or the DM's) is pushed by the server and redrawn here.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import { escapeHtml, typeBadges, toast } from './dm-common.js';
import { xpOrStart, xpPanelHtml, xpButtonHtml, giveXpPopup } from './xp.js';
import { givePokemonPopup } from './give-pokemon.js';

// Positions in a trainer row (db.TRAINER_COLUMNS) and a Pokemon row (db.POKEMON_COLUMNS).
const T = { image: 0, name: 1, level: 2, hd: 3, vd: 4, str: 5, hp: 11, vp: 12, ac: 13, speed: 14, saves: 15, init: 16, prof: 17, skills: 18,
  money: 19, inventory: 20, league: 21, affinity: 23, spec: 24, path: 25, slots: 26, mods: 27, feats: 33, curHP: 34, curVP: 35, curAC: 36,
  gear: 37, region: 38, cls: 39 };
const P = { image: 1, name: 2, dex: 3, level: 4, type1: 5, type2: 6, abilities: 7, ac: 8, hd: 9, hp: 10, vd: 11, vp: 12, speed: 13, str: 15,
  saves: 21, skills: 22, moves: 23, evo: 29, init: 30, prof: 31, nature: 32, loyalty: 33, stab: 34, item: 35, nick: 36, custom: 37, slot: 38,
  mods: 39, curHP: 45, curVP: 46, curAC: 47, comment: 48, senses: 49, feats: 50, gear: 51, size: 57, status: 60, shiny: 61 };
const STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const MOVE_LEVELS = [1, 2, 6, 10, 14, 18];
const SENSES = ['Sight', 'Hearing', 'Smell', 'Tremorsense', 'Echolocation', 'Telepathy', 'Blindsight', 'Darkvision', 'Truesight'];

let _root = null;
let _party = [];
let _selected = null; // trainer name, or null for the overview
const _expanded = new Set(); // "trainer|pokemon" rows opened on the trainer page
let _reloadTimer = null;
let _listening = false;

export async function renderParty(root) {
  _root = root;
  if (!_listening) {
    _listening = true;
    window.addEventListener('app:trainer-data', () => {
      if (!_root || _root.hidden || !document.body.contains(_root)) return;
      clearTimeout(_reloadTimer);
      _reloadTimer = setTimeout(reload, 300);
    });
  }
  root.innerHTML = '<div class="dm-loading">Loading the party…</div>';
  await reload();
}

async function reload() {
  try {
    _party = (await DmAPI.party()).data || [];
  } catch (err) {
    _root.innerHTML = `<div class="dm-loading">Couldn't load the trainers: ${escapeHtml(err.message)}</div>`;
    return;
  }
  draw();
}

function draw() {
  const entry = _selected && _party.find(e => e.trainer[T.name] === _selected);
  if (entry) drawTrainer(entry); else { _selected = null; drawOverview(); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (v, d = 0) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const sign = n => (n >= 0 ? `+${n}` : `${n}`);
const pct = (cur, max) => (max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0);
const current = (row, curIdx, maxIdx) => (row[curIdx] === '' || row[curIdx] == null ? num(row[maxIdx]) : num(row[curIdx]));

function bars(cur, max, curVp, maxVp) {
  return `<div class="dm-bar hp"><i style="width:${pct(cur, max)}%"></i></div><div class="dm-bar vp"><i style="width:${pct(curVp, maxVp)}%"></i></div>`;
}

function partyOf(entry) {
  return entry.pokemon.filter(p => num(p[P.slot]) >= 1 && num(p[P.slot]) <= 6).sort((a, b) => num(a[P.slot]) - num(b[P.slot]));
}

function pokemonName(p) {
  return p[P.nick] || p[P.name];
}

function patchImages(scope) {
  scope.querySelectorAll('[data-img]').forEach(el => {
    if (el.dataset.img) patchPortraitMedia(el, el.dataset.img, ''); else el.innerHTML = '<img src="assets/Pokeball.png" alt="" style="opacity:.35">';
  });
}

// ---------------------------------------------------------------------------
// Overview: one card per trainer, with their party
// ---------------------------------------------------------------------------

function drawOverview() {
  _root.innerHTML = `
    <div class="dm-party">
      <div class="dm-home-head">
        <div><h2><img class="dm-tab-icon" src="assets/party-icon.png" alt="">Party</h2><div class="dm-hint">The players' trainers and their active party. Click a trainer for everything else.</div></div>
        <button class="dm-btn small" id="partyRefresh">↻ Refresh</button>
      </div>
      <div class="dm-party-grid">
        ${_party.map(entry => {
          const t = entry.trainer;
          const party = partyOf(entry);
          return `
            <button class="dm-party-card" data-trainer="${escapeHtml(t[T.name])}">
              <div class="dm-party-top">
                <span class="dm-party-portrait" data-img="${escapeHtml(t[T.image] || '')}"></span>
                <span class="dm-party-who">
                  <strong>${escapeHtml(t[T.name])}</strong>
                  <small>Lv ${escapeHtml(t[T.level])} · ${escapeHtml(t[T.cls] || 'Trainer')} · ₽${num(t[T.money]).toLocaleString()}</small>
                  <span class="dm-party-hpvp">HP ${current(t, T.curHP, T.hp)}/${num(t[T.hp])} · VP ${current(t, T.curVP, T.vp)}/${num(t[T.vp])}</span>
                  ${bars(current(t, T.curHP, T.hp), num(t[T.hp]), current(t, T.curVP, T.vp), num(t[T.vp]))}
                </span>
              </div>
              <div class="dm-party-mons">
                ${party.length ? party.map(p => `
                  <span class="dm-party-mon" title="${escapeHtml(pokemonName(p))}">
                    <span class="dm-party-sprite" data-img="${escapeHtml(p[P.image] || '')}"></span>
                    <span class="dm-party-mon-name">${escapeHtml(pokemonName(p))}</span>
                    <span class="dm-party-mon-lv">Lv ${escapeHtml(p[P.level])}</span>
                    <span class="dm-bar hp"><i style="width:${pct(current(p, P.curHP, P.hp), num(p[P.hp]))}%"></i></span>
                  </span>`).join('') : '<span class="dm-hint">No Pokémon in the party.</span>'}
              </div>
              <div class="dm-party-foot">${entry.pokemon.length} Pokémon in total</div>
            </button>`;
        }).join('') || '<div class="dm-hint">No trainers yet.</div>'}
      </div>
    </div>`;
  patchImages(_root);
  document.getElementById('partyRefresh').addEventListener('click', reload);
  _root.querySelectorAll('[data-trainer]').forEach(card => card.addEventListener('click', () => { _selected = card.dataset.trainer; draw(); }));
}

// ---------------------------------------------------------------------------
// One trainer: stats | Pokemon | money and inventory
// ---------------------------------------------------------------------------

function drawTrainer(entry) {
  const t = entry.trainer;
  const name = t[T.name];
  const all = [...partyOf(entry), ...entry.pokemon.filter(p => !(num(p[P.slot]) >= 1 && num(p[P.slot]) <= 6))];
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  // The DM-only XP that came with the rows (DmAPI.party), or where each record's level starts.
  const xpFor = p => xpOrStart(entry.xp?.pokemon?.[entry.pokemon.indexOf(p)], p[P.level]);
  const scrollers = [..._root.querySelectorAll('.dm-trainer-col')].map(c => c.scrollTop);

  _root.innerHTML = `
    <div class="dm-trainer">
      <div class="dm-trainer-bar">
        <button class="dm-btn small" id="trainerBack">← All trainers</button>
        <span class="dm-party-portrait small" data-img="${escapeHtml(t[T.image] || '')}"></span>
        <h2>${escapeHtml(name)}</h2>
        <span class="dm-hint">Lv ${escapeHtml(t[T.level])} · ${escapeHtml(t[T.cls] || 'Trainer')}${t[T.region] ? ` · ${escapeHtml(t[T.region])}` : ''}</span>
      </div>
      <div class="dm-trainer-cols">
        <div class="dm-trainer-col">${trainerStatsHtml(t)}${xpPanelHtml(xpOrStart(entry.xp?.trainer, t[T.level]), t[T.level], 'id="trainerXp"')}</div>
        <div class="dm-trainer-col">
          <div class="dm-card-title dm-title-with-btn">Pokémon (${all.length})<button class="dm-btn small primary" id="givePokemonBtn">+ Give Pokémon</button></div>
          ${all.map(p => pokemonRowHtml(name, p, xpFor(p))).join('') || '<div class="dm-hint">No Pokémon.</div>'}
        </div>
        <div class="dm-trainer-col">${moneyAndItemsHtml(t, items)}</div>
      </div>
    </div>`;
  patchImages(_root);
  _root.querySelectorAll('.dm-trainer-col').forEach((c, i) => { if (scrollers[i]) c.scrollTop = scrollers[i]; });
  wireTrainer(name, items);
  document.getElementById('givePokemonBtn').addEventListener('click', async () => {
    if (await givePokemonPopup(name, { ownedSpecies: entry.pokemon.map(p => p[P.name]) })) {
      toast(`Gave ${name} a Pokémon`);
      reload();
    }
  });
  document.getElementById('trainerXp').addEventListener('click', async () => {
    if (await giveXpPopup({ label: name, trainer: name, xp: xpOrStart(entry.xp?.trainer, t[T.level]), level: t[T.level] }) !== null) reload();
  });
  _root.querySelectorAll('[data-xp-mon]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation(); // not the card's open / close
    const p = entry.pokemon.find(x => x[P.name] === b.dataset.xpMon);
    if (!p) return;
    if (await giveXpPopup({ label: `${name}'s ${pokemonName(p)}`, trainer: name, pokemon: p[P.name], xp: xpFor(p), level: p[P.level] }) !== null) reload();
  }));
}

function trainerStatsHtml(t) {
  const cell = (label, value) => `<div class="dm-tstat"><span>${label}</span><strong>${value}</strong></div>`;
  const line = (label, value) => (value ? `<div class="dm-tline"><span>${label}</span><span>${escapeHtml(value)}</span></div>` : '');
  return `
    <div class="dm-card-title">Trainer</div>
    <div class="dm-tstats">
      ${cell('HP', `${current(t, T.curHP, T.hp)}/${num(t[T.hp])}`)}${cell('VP', `${current(t, T.curVP, T.vp)}/${num(t[T.vp])}`)}
      ${cell('AC', t[T.curAC] && num(t[T.curAC]) !== num(t[T.ac]) ? `${num(t[T.curAC])} (${num(t[T.ac])})` : num(t[T.ac]))}
      ${cell('Speed', `${escapeHtml(t[T.speed] || 30)}ft`)}${cell('Initiative', sign(num(t[T.init])))}${cell('Proficiency', sign(num(t[T.prof])))}
    </div>
    <div class="dm-tstats six">
      ${STATS.map((s, i) => cell(s, `${num(t[T.str + i], 10)} <small>${sign(num(t[T.mods + i], Math.floor((num(t[T.str + i], 10) - 10) / 2)))}</small>`)).join('')}
    </div>
    ${line('Saving throws', t[T.saves])}${line('Skills', t[T.skills])}
    ${line('Trainer path', t[T.path])}${line('Affinity', t[T.affinity])}${line('Specialization', t[T.spec])}
    ${line('Poké slots', t[T.slots])}${line('League points', t[T.league])}${line('Hit / vitality dice', `d${t[T.hd] || '?'} / d${t[T.vd] || '?'}`)}
    ${line('Feats', t[T.feats])}${line('Gear', t[T.gear])}`;
}

function abilityList(raw) {
  return String(raw || '').split('|').map(a => a.trim()).filter(Boolean).map(entry => {
    const body = entry.includes(':') ? entry.slice(entry.indexOf(':') + 1) : entry;
    const [n, ...desc] = body.split(';');
    return { name: n.trim(), desc: desc.join(';').trim() };
  });
}

/** "40ft, 30ft, -, -, 60ft, -" (walking, climbing, flying, hovering, swimming, burrowing) -> "Walk 40ft · Climb 30ft · Swim 60ft". */
function speedText(raw) {
  const kinds = ['Walk', 'Climb', 'Fly', 'Hover', 'Swim', 'Burrow'];
  return String(raw || '').split(',').map(s => s.trim()).map((v, i) => (v && v !== '-' && kinds[i] ? `${kinds[i]} ${v}` : '')).filter(Boolean).join(' · ');
}

function movesKnown(p) {
  const lvl = num(p[P.level], 1);
  const known = [];
  MOVE_LEVELS.forEach((req, i) => {
    if (lvl >= req) String(p[P.moves + i] || '').split(',').map(m => m.trim()).filter(Boolean).forEach(m => known.push(m));
  });
  String(p[P.custom] || '').split(',').map(m => m.trim()).filter(Boolean).forEach(m => { if (!known.includes(m)) known.push(m); });
  return known;
}

function pokemonRowHtml(trainer, p, xp) {
  const key = `${trainer}|${p[P.name]}`;
  const open = _expanded.has(key);
  const slot = num(p[P.slot]);
  const hp = current(p, P.curHP, P.hp), vp = current(p, P.curVP, P.vp);
  // A div rather than a button: it holds the XP button, and a button can't sit inside another one.
  const head = `
    <div class="dm-tmon-head" data-toggle="${escapeHtml(key)}" role="button" tabindex="0">
      <span class="dm-party-sprite" data-img="${escapeHtml(p[P.image] || '')}"></span>
      <span class="dm-tmon-main">
        <strong>${escapeHtml(pokemonName(p))}${p[P.nick] ? ` <small>(${escapeHtml(p[P.name])})</small>` : ''}${p[P.shiny] === 'Y' ? ' ✨' : ''}</strong>
        <small>${typeBadges(p[P.type1], p[P.type2])} Lv ${escapeHtml(p[P.level])} · ${slot >= 1 && slot <= 6 ? `party slot ${slot}` : 'not in the party'}</small>
        <span class="dm-party-hpvp">HP ${hp}/${num(p[P.hp])} · VP ${vp}/${num(p[P.vp])}</span>
        ${bars(hp, num(p[P.hp]), vp, num(p[P.vp]))}
      </span>
      ${xpButtonHtml(xp, p[P.level], `data-xp-mon="${escapeHtml(p[P.name])}"`)}
      <span class="dm-tmon-caret">${open ? '▾' : '▸'}</span>
    </div>`;
  if (!open) return `<div class="dm-tmon">${head}</div>`;
  const cell = (label, value) => `<div class="dm-tstat"><span>${label}</span><strong>${value}</strong></div>`;
  const line = (label, value) => (value ? `<div class="dm-tline"><span>${label}</span><span>${escapeHtml(value)}</span></div>` : '');
  const senses = String(p[P.senses] || '').split(',').map(s => s.trim());
  return `
    <div class="dm-tmon open">${head}
      <div class="dm-tmon-body">
        <div class="dm-tstats">
          ${cell('AC', p[P.curAC] && num(p[P.curAC]) !== num(p[P.ac]) ? `${num(p[P.curAC])} (${num(p[P.ac])})` : num(p[P.ac]))}
          ${cell('Initiative', sign(num(p[P.init])))}${cell('Proficiency', sign(num(p[P.prof])))}${cell('STAB', sign(num(p[P.stab])))}
          ${cell('Loyalty', num(p[P.loyalty]))}${cell('Nature', escapeHtml(p[P.nature] || '—'))}
        </div>
        <div class="dm-tstats six">
          ${STATS.map((s, i) => cell(s, `${num(p[P.str + i], 10)} <small>${sign(num(p[P.mods + i], Math.floor((num(p[P.str + i], 10) - 10) / 2)))}</small>`)).join('')}
        </div>
        ${line('Held item', p[P.item])}${line('Status', p[P.status])}${line('Size', p[P.size])}${line('Speed', speedText(p[P.speed]))}
        ${line('Saving throws', p[P.saves])}${line('Skills', p[P.skills])}${line('Hit / vitality dice', `d${p[P.hd] || '?'} / d${p[P.vd] || '?'}`)}
        ${line('Feats', p[P.feats])}${line('Gear', p[P.gear])}${line('Evolution', p[P.evo])}
        ${abilityList(p[P.abilities]).map(a => `<div class="dm-tline"><span>Ability</span><span><strong>${escapeHtml(a.name)}</strong>${a.desc ? ` -- ${escapeHtml(a.desc)}` : ''}</span></div>`).join('')}
        <div class="dm-tline"><span>Moves</span><span class="dm-move-chips">${movesKnown(p).map(m => `<span>${escapeHtml(m)}</span>`).join('') || '—'}</span></div>
        ${senses.some(s => s && s !== '-') ? `<div class="dm-tline"><span>Senses</span><span>${SENSES.map((s, i) => (senses[i] && senses[i] !== '-' ? `${s} ${escapeHtml(senses[i])}` : '')).filter(Boolean).join(' · ')}</span></div>` : ''}
        ${line('Notes', p[P.comment])}
      </div>
    </div>`;
}

/** The inventory cell as [{name, quantity, type, description, custom}] -- the format trainer-info.js reads: regular
 * items "Potion (x2), Antidote (x1)" (named after the items list), custom ones as JSON after ##CUSTOM##. */
function parseInventory(text, items) {
  const [regularText, customText] = String(text || '').split('##CUSTOM##');
  const out = [];
  let end = 0;
  const re = /(.*?)\(x(\d+)\)\s*,?/g;
  let m;
  while ((m = re.exec(regularText)) !== null) {
    const name = m[1].trim().replace(/^,|,$/g, '').trim();
    if (name) out.push({ name, quantity: num(m[2], 1) });
    end = re.lastIndex;
    if (m[0] === '') break;
  }
  regularText.slice(end).split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'none').forEach(name => out.push({ name, quantity: 1 }));
  out.forEach(it => {
    const data = items.find(i => i.name.toLowerCase() === it.name.toLowerCase());
    it.type = data?.type || 'Other';
    it.description = data ? `${data.description || ''}${data.effect ? ` ${data.effect}` : ''}`.trim() : '';
  });
  let custom = [];
  try { custom = JSON.parse(customText || '[]') || []; } catch { custom = []; }
  custom.forEach(c => out.push({ name: c.name, quantity: num(c.quantity, 1), type: 'Custom items', description: c.description || '', custom: true }));
  return out;
}

function moneyAndItemsHtml(t, items) {
  const inv = parseInventory(t[T.inventory], items);
  const groups = {};
  inv.forEach(it => { (groups[it.type] = groups[it.type] || []).push(it); });
  return `
    <div class="dm-card-title">Money</div>
    <div class="dm-money">₽${num(t[T.money]).toLocaleString()}</div>
    <div class="dm-row">
      <input class="dm-input" id="moneyAmount" type="number" min="0" placeholder="Amount">
      <button class="dm-btn primary" id="moneyAdd">+ Give</button>
      <button class="dm-btn danger" id="moneyTake">− Take</button>
    </div>

    <div class="dm-card-title" style="margin-top:1rem">Inventory</div>
    <div class="dm-inv">
      ${Object.keys(groups).sort().map(type => `
        <div class="dm-inv-group">${escapeHtml(type)}</div>
        ${groups[type].map(it => `
          <div class="dm-inv-row" title="${escapeHtml(it.description)}">
            <span class="dm-inv-name">${escapeHtml(it.name)}</span>
            <span class="dm-inv-qty">x${it.quantity}</span>
            <button class="dm-icon-btn" data-item="${escapeHtml(it.name)}" data-custom="${it.custom ? 1 : ''}" data-delta="-1" title="Take one">−</button>
            <button class="dm-icon-btn" data-item="${escapeHtml(it.name)}" data-custom="${it.custom ? 1 : ''}" data-delta="1" title="Give one more">+</button>
          </div>`).join('')}`).join('') || '<div class="dm-hint">Nothing in the inventory.</div>'}
    </div>

    <div class="dm-card-title" style="margin-top:1rem">Give an item</div>
    <datalist id="itemNames">${items.map(i => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.type || '')}</option>`).join('')}</datalist>
    <div class="dm-row">
      <input class="dm-input" id="giveItemName" list="itemNames" placeholder="Item from the list…">
      <input class="dm-input" id="giveItemQty" type="number" min="1" value="1" style="max-width:70px">
      <button class="dm-btn primary" id="giveItemBtn">Give</button>
    </div>
    <details class="dm-custom-item">
      <summary>Or an item of your own…</summary>
      <input class="dm-input" id="customName" placeholder="Name">
      <textarea class="dm-input" id="customDesc" rows="2" placeholder="What it is / does"></textarea>
      <div class="dm-row">
        <input class="dm-input" id="customQty" type="number" min="1" value="1" style="max-width:70px">
        <button class="dm-btn primary" id="giveCustomBtn">Give custom item</button>
      </div>
    </details>`;
}

function wireTrainer(name, items) {
  document.getElementById('trainerBack').addEventListener('click', () => { _selected = null; draw(); });
  const toggle = (b) => {
    const key = b.dataset.toggle;
    if (_expanded.has(key)) _expanded.delete(key); else _expanded.add(key);
    draw();
  };
  _root.querySelectorAll('[data-toggle]').forEach(b => {
    b.addEventListener('click', () => toggle(b));
    b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === b) { e.preventDefault(); toggle(b); } });
  });
  const run = async (fn, done) => {
    try { await fn(); if (done) toast(done); await reload(); } catch (err) { showCombatAlert(err.message, { title: name }); }
  };
  const amount = () => Math.max(0, parseInt(document.getElementById('moneyAmount').value, 10) || 0);
  document.getElementById('moneyAdd').addEventListener('click', () => {
    const a = amount();
    if (a) run(() => DmAPI.giveMoney(name, a), `Gave ${name} ₽${a.toLocaleString()}`);
  });
  document.getElementById('moneyTake').addEventListener('click', () => {
    const a = amount();
    if (a) run(() => DmAPI.giveMoney(name, -a), `Took ₽${a.toLocaleString()} from ${name}`);
  });
  _root.querySelectorAll('[data-delta]').forEach(b => b.addEventListener('click', () => {
    run(() => DmAPI.giveItem(name, b.dataset.item, Number(b.dataset.delta), { custom: !!b.dataset.custom }));
  }));
  document.getElementById('giveItemBtn').addEventListener('click', () => {
    const typed = document.getElementById('giveItemName').value.trim();
    const qty = Math.max(1, parseInt(document.getElementById('giveItemQty').value, 10) || 1);
    if (!typed) return;
    const known = items.find(i => i.name.toLowerCase() === typed.toLowerCase());
    if (!known) {
      showCombatAlert(`"${typed}" isn't in the item list -- pick one from the suggestions, or give it as an item of your own below.`, { title: 'Give an item' });
      return;
    }
    run(() => DmAPI.giveItem(name, known.name, qty), `Gave ${name} ${qty} × ${known.name}`);
  });
  document.getElementById('giveCustomBtn').addEventListener('click', () => {
    const itemName = document.getElementById('customName').value.trim();
    const qty = Math.max(1, parseInt(document.getElementById('customQty').value, 10) || 1);
    if (!itemName) return;
    run(() => DmAPI.giveItem(name, itemName, qty, { custom: true, description: document.getElementById('customDesc').value.trim() }),
      `Gave ${name} ${qty} × ${itemName}`);
  });
}
