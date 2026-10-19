// DM console -- the Party module: every player trainer with their current party at a glance, and a trainer's full
// page on a click -- their stats, all their Pokemon (each one's full stat block on a click), their money and their
// inventory, where the DM hands out items and money (routes_dm.py's give-item / give-money, which add to what's there
// on the server, so nothing the player just changed is overwritten) and gives Pokemon (give-pokemon.js). Kept live: any change to a trainer (the player's
// own, or the DM's) is pushed by the server and redrawn here.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import { escapeHtml, typeBadges, toast, attachSuggest } from './dm-common.js';
import { xpOrStart, xpPanelHtml, xpButtonHtml, giveXpPopup } from './xp.js';
import { givePokemonPopup } from './give-pokemon.js';
import { abilitiesOf, currentHP, currentVP, displayName, knownMoveNames, sensesList } from '../utils/owned-pokemon.js';

/** "From: Bulbasaur · Evolves: Venusaur @ Level 15" */
function evolutionLine(p) {
  const parts = [];
  if ((p.evolvesFrom || []).length) parts.push(`From: ${p.evolvesFrom.join(' + ')}`);
  (p.evolvesInto || []).forEach(e => parts.push(e.requirement ? `Evolves: ${e.species} @ ${e.requirement}` : `Evolves: ${e.species}`));
  return parts.join(' · ');
}

// The trainers and their Pokemon are objects (pi-server/app/trainers.py, owned.py).
const STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const STAT_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

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
  const entry = _selected && _party.find(e => e.trainer.name === _selected);
  if (entry) drawTrainer(entry); else { _selected = null; drawOverview(); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const num = (v, d = 0) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const sign = n => (n >= 0 ? `+${n}` : `${n}`);
const pct = (cur, max) => (max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0);
// A trainer's current HP / VP (the max where none is stored)
const curHP = t => num(t.current?.hp ?? t.combat?.maxHP);
const curVP = t => num(t.current?.vp ?? t.combat?.maxVP);
const list = l => (l || []).join(', ');
const hpOf = p => currentHP(p);
const vpOf = p => currentVP(p);

function bars(cur, max, curVp, maxVp) {
  return `<div class="dm-bar hp"><i style="width:${pct(cur, max)}%"></i></div><div class="dm-bar vp"><i style="width:${pct(curVp, maxVp)}%"></i></div>`;
}

function partyOf(entry) {
  return entry.pokemon.filter(p => num(p.partySlot) >= 1 && num(p.partySlot) <= 6).sort((a, b) => num(a.partySlot) - num(b.partySlot));
}

function pokemonName(p) {
  return displayName(p);
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
            <button class="dm-party-card" data-trainer="${escapeHtml(t.name)}">
              <div class="dm-party-top">
                <span class="dm-party-portrait" data-img="${escapeHtml(t.image || '')}"></span>
                <span class="dm-party-who">
                  <strong>${escapeHtml(t.name)}</strong>
                  <small>Lv ${escapeHtml(t.level)} · ${escapeHtml(t.trainerClass || 'Trainer')} · ₽${num(t.money).toLocaleString()}</small>
                  <span class="dm-party-hpvp">HP ${curHP(t)}/${num(t.combat?.maxHP)} · VP ${curVP(t)}/${num(t.combat?.maxVP)}</span>
                  ${bars(curHP(t), num(t.combat?.maxHP), curVP(t), num(t.combat?.maxVP))}
                </span>
              </div>
              <div class="dm-party-mons">
                ${party.length ? party.map(p => `
                  <span class="dm-party-mon" title="${escapeHtml(pokemonName(p))}">
                    <span class="dm-party-sprite" data-img="${escapeHtml(p.image || '')}"></span>
                    <span class="dm-party-mon-name">${escapeHtml(pokemonName(p))}</span>
                    <span class="dm-party-mon-lv">Lv ${escapeHtml(p.level)}</span>
                    <span class="dm-bar hp"><i style="width:${pct(hpOf(p), num(p.combat.maxHP))}%"></i></span>
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
  const name = t.name;
  const all = [...partyOf(entry), ...entry.pokemon.filter(p => !(num(p.partySlot) >= 1 && num(p.partySlot) <= 6))];
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  // The DM-only XP that came with the rows (DmAPI.party), or where each record's level starts.
  const xpFor = p => xpOrStart(entry.xp?.pokemon?.[entry.pokemon.indexOf(p)], p.level);
  const scrollers = [..._root.querySelectorAll('.dm-trainer-col')].map(c => c.scrollTop);

  _root.innerHTML = `
    <div class="dm-trainer">
      <div class="dm-trainer-bar">
        <button class="dm-btn small" id="trainerBack">← All trainers</button>
        <span class="dm-party-portrait small" data-img="${escapeHtml(t.image || '')}"></span>
        <h2>${escapeHtml(name)}</h2>
        <span class="dm-hint">Lv ${escapeHtml(t.level)} · ${escapeHtml(t.trainerClass || 'Trainer')}${t.region ? ` · ${escapeHtml(t.region)}` : ''}</span>
      </div>
      <div class="dm-trainer-cols">
        <div class="dm-trainer-col">${trainerStatsHtml(t)}${xpPanelHtml(xpOrStart(entry.xp?.trainer, t.level), t.level, 'id="trainerXp"')}</div>
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
    if (await givePokemonPopup(name, { ownedSpecies: entry.pokemon.map(p => p.name) })) {
      toast(`Gave ${name} a Pokémon`);
      reload();
    }
  });
  document.getElementById('trainerXp').addEventListener('click', async () => {
    if (await giveXpPopup({ label: name, trainer: name, xp: xpOrStart(entry.xp?.trainer, t.level), level: t.level }) !== null) reload();
  });
  _root.querySelectorAll('[data-xp-mon]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation(); // not the card's open / close
    const p = entry.pokemon.find(x => x.name === b.dataset.xpMon);
    if (!p) return;
    if (await giveXpPopup({ label: `${name}'s ${pokemonName(p)}`, trainer: name, pokemon: p.name, xp: xpFor(p), level: p.level }) !== null) reload();
  }));
}

function trainerStatsHtml(t) {
  const cell = (label, value) => `<div class="dm-tstat"><span>${label}</span><strong>${value}</strong></div>`;
  const line = (label, value) => (value ? `<div class="dm-tline"><span>${label}</span><span>${escapeHtml(value)}</span></div>` : '');
  return `
    <div class="dm-card-title">Trainer</div>
    <div class="dm-tstats">
      ${cell('HP', `${curHP(t)}/${num(t.combat?.maxHP)}`)}${cell('VP', `${curVP(t)}/${num(t.combat?.maxVP)}`)}
      ${cell('AC', t.current?.ac != null && num(t.current.ac) !== num(t.combat?.ac) ? `${num(t.current.ac)} (${num(t.combat?.ac)})` : num(t.combat?.ac))}
      ${cell('Speed', `${escapeHtml(t.combat?.walkingSpeed || 30)}ft`)}${cell('Initiative', sign(num(t.combat?.initiative)))}${cell('Proficiency', sign(num(t.combat?.proficiency)))}
    </div>
    <div class="dm-tstats six">
      ${STATS.map((s, i) => cell(s, `${num(t.stats?.[STAT_NAMES[i]], 10)} <small>${sign(num(t.modifiers?.[STAT_NAMES[i]], Math.floor((num(t.stats?.[STAT_NAMES[i]], 10) - 10) / 2)))}</small>`)).join('')}
    </div>
    ${line('Saving throws', list(t.savingThrows))}${line('Skills', list(t.skills))}${line('Expertise', list(t.expertise))}
    ${line('Trainer path', t.trainerPath)}${line('Affinity', list(t.affinities))}${line('Specialization', list(t.specializations))}
    ${line('Poké slots', t.pokeslots)}${line('League points', t.leaguePoints)}${line('Hit / vitality dice', `d${t.combat?.hitDie || '?'} / d${t.combat?.vitalityDie || '?'}`)}
    ${line('Feats', list(t.feats))}${line('Gear', list(t.gear))}`;
}


/** "Walk 40ft · Climb 30ft · Swim 60ft" -- the speeds it has. */
function speedLine(p) {
  const kinds = { walking: 'Walk', climbing: 'Climb', flying: 'Fly', hovering: 'Hover', swimming: 'Swim', burrowing: 'Burrow' };
  return Object.entries(kinds).map(([k, label]) => ((p.movement || {})[k] ? `${label} ${p.movement[k]}ft` : '')).filter(Boolean).join(' · ');
}

function movesKnown(p) {
  return [...new Set(knownMoveNames(p))];
}

function pokemonRowHtml(trainer, p, xp) {
  const key = `${trainer}|${p.name}`;
  const open = _expanded.has(key);
  const slot = num(p.partySlot);
  const hp = hpOf(p), vp = vpOf(p);
  // A div rather than a button: it holds the XP button, and a button can't sit inside another one.
  const head = `
    <div class="dm-tmon-head" data-toggle="${escapeHtml(key)}" role="button" tabindex="0">
      <span class="dm-party-sprite" data-img="${escapeHtml(p.image || '')}"></span>
      <span class="dm-tmon-main">
        <strong>${escapeHtml(pokemonName(p))}${p.nickname ? ` <small>(${escapeHtml(p.name)})</small>` : ''}${p.shiny ? ' ✨' : ''}</strong>
        <small>${typeBadges(p.types?.primary, p.types?.secondary)} Lv ${escapeHtml(p.level)} · ${slot >= 1 && slot <= 6 ? `party slot ${slot}` : 'not in the party'}</small>
        <span class="dm-party-hpvp">HP ${hp}/${num(p.combat.maxHP)} · VP ${vp}/${num(p.combat.maxVP)}</span>
        ${bars(hp, num(p.combat.maxHP), vp, num(p.combat.maxVP))}
      </span>
      ${xpButtonHtml(xp, p.level, `data-xp-mon="${escapeHtml(p.name)}"`)}
      <span class="dm-tmon-caret">${open ? '▾' : '▸'}</span>
    </div>`;
  if (!open) return `<div class="dm-tmon">${head}</div>`;
  const cell = (label, value) => `<div class="dm-tstat"><span>${label}</span><strong>${value}</strong></div>`;
  const line = (label, value) => (value ? `<div class="dm-tline"><span>${label}</span><span>${escapeHtml(value)}</span></div>` : '');
  const senses = sensesList(p);
  const c = p.combat || {};
  const curAC = p.current?.ac;
  return `
    <div class="dm-tmon open">${head}
      <div class="dm-tmon-body">
        <div class="dm-tstats">
          ${cell('AC', curAC != null && num(curAC) !== num(c.ac) ? `${num(curAC)} (${num(c.ac)})` : num(c.ac))}
          ${cell('Initiative', sign(num(c.initiative)))}${cell('Proficiency', sign(num(c.proficiency)))}${cell('STAB', sign(num(c.stab)))}
          ${cell('Loyalty', num(p.loyalty))}${cell('Nature', escapeHtml(p.nature || '—'))}
        </div>
        <div class="dm-tstats six">
          ${STATS.map((s, i) => { const v = num(p.stats?.[STAT_NAMES[i]], 10); return cell(s, `${v} <small>${sign(num(p.modifiers?.[STAT_NAMES[i]], Math.floor((v - 10) / 2)))}</small>`); }).join('')}
        </div>
        ${line('Held item', p.heldItem)}${line('Status', (p.statusConditions || []).join(', '))}${line('Size', p.size)}${line('Speed', speedLine(p))}
        ${line('Saving throws', (p.savingThrows || []).join(', '))}${line('Skills', (p.skills || []).join(', '))}${line('Expertise', (p.expertise || []).join(', '))}${line('Hit / vitality dice', `d${c.hitDie || '?'} / d${c.vitalityDie || '?'}`)}
        ${line('Feats', (p.feats || []).join(', '))}${line('Gear', p.gear)}${line('Evolution', evolutionLine(p))}
        ${abilitiesOf(p).map(a => `<div class="dm-tline"><span>Ability</span><span><strong>${escapeHtml(a.name)}</strong>${a.description ? ` -- ${escapeHtml(a.description)}` : ''}</span></div>`).join('')}
        <div class="dm-tline"><span>Moves</span><span class="dm-move-chips">${movesKnown(p).map(m => `<span>${escapeHtml(m)}</span>`).join('') || '—'}</span></div>
        ${senses.length ? `<div class="dm-tline"><span>Senses</span><span>${senses.map(([s, v]) => `${s} ${escapeHtml(v)}`).join(' · ')}</span></div>` : ''}
        ${line('Notes', (p.comments || []).join(' · '))}
      </div>
    </div>`;
}

/** The trainer's items as [{name, quantity, type, description, custom}] -- `type` the item list's category (or 'Other'),
 * the trainer's own items under 'Custom items'. */
function inventoryOf(t, items) {
  const out = (t.inventory || []).map(it => {
    const data = items.find(i => i.name.toLowerCase() === String(it.name).toLowerCase());
    return {
      name: it.name, quantity: num(it.quantity, 1), type: data?.category || 'Other',
      description: data ? `${data.description || ''}${data.effect ? ` ${data.effect}` : ''}`.trim() : '',
    };
  });
  (t.customItems || []).forEach(c => out.push({ name: c.name, quantity: num(c.quantity, 1), type: 'Custom items', description: c.description || '', custom: true }));
  return out;
}

function moneyAndItemsHtml(t, items) {
  const inv = inventoryOf(t, items);
  const groups = {};
  inv.forEach(it => { (groups[it.type] = groups[it.type] || []).push(it); });
  return `
    <div class="dm-card-title">Money</div>
    <div class="dm-money">₽${num(t.money).toLocaleString()}</div>
    <div class="dm-row">
      <input class="dm-input" id="moneyAmount" type="number" min="0" placeholder="Amount">
      <button class="dm-btn primary" id="moneyAdd">+ Give</button>
      <button class="dm-btn danger" id="moneyTake">− Take</button>
    </div>

    <div class="dm-card-title" style="margin-top:1rem">Give an item</div>
    <div class="dm-tool-tabs dm-give-tabs">
      <button type="button" class="active" data-give-tab="list">From the list</button>
      <button type="button" data-give-tab="custom">Custom item</button>
    </div>
    <div data-give-pane="list">
      <div class="dm-row dm-give-item-row">
        <div class="dm-give-item-name"><input class="dm-input" id="giveItemName" placeholder="Item from the list…"></div>
        <input class="dm-input" id="giveItemQty" type="number" min="1" value="1" style="max-width:70px">
        <button class="dm-btn primary" id="giveItemBtn">Give</button>
      </div>
    </div>
    <div class="dm-custom-item" data-give-pane="custom" hidden>
      <input class="dm-input" id="customName" placeholder="Name">
      <textarea class="dm-input" id="customDesc" rows="2" placeholder="What it is / does"></textarea>
      <div class="dm-row">
        <input class="dm-input" id="customQty" type="number" min="1" value="1" style="max-width:70px">
        <button class="dm-btn primary" id="giveCustomBtn">Give custom item</button>
      </div>
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
`;
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
  // Give an item: from the game's list, or an item of the DM's own (shown as a tab of its own, not tucked away).
  document.querySelectorAll('[data-give-tab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-give-tab]').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('[data-give-pane]').forEach(pane => { pane.hidden = pane.dataset.givePane !== b.dataset.giveTab; });
  }));
  attachSuggest(document.getElementById('giveItemName'), () => items.map(i => ({ value: i.name, label: i.name, sub: i.category || '' })),
    { after: document.querySelector('.dm-give-item-row') });
  document.getElementById('giveItemBtn').addEventListener('click', () => {
    const typed = document.getElementById('giveItemName').value.trim();
    const qty = Math.max(1, parseInt(document.getElementById('giveItemQty').value, 10) || 1);
    if (!typed) return;
    const known = items.find(i => i.name.toLowerCase() === typed.toLowerCase());
    if (!known) {
      showCombatAlert(`"${typed}" isn't in the item list -- pick one from the suggestions, or give it under Custom item.`, { title: 'Give an item' });
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
