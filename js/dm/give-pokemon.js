// DM console -- the Party module's "Give Pokémon": the DM fills in a Pokémon (species, name, level, nature, abilities,
// held item, shiny, extra skills, extra moves, and any numbers they want different) and it goes straight into a
// trainer's team, without an encounter. routes_dm.py's give-pokemon -- the same build the Post battle tab's "give to
// trainer" uses, and the same maths a player's own registration runs. A live preview shows the numbers and moves before
// anything is saved.
//
// The user's call, 2026-10-19: the species and the held item are picked in the file-explorer popup (picker.js, with a
// search bar), numbers have − / + buttons, "Teach a move" adds moves it hasn't learned yet or can't normally learn (its
// custom moves, like Edit Pokémon's), and a shiny one whose species has no shiny picture yet can get one uploaded here.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import {
  escapeHtml, typeBadges, natureOptions, SKILLS, splitList, multiSelectHtml, bindMultiSelects, readMultiSelect,
  openDmModal, getSpecies, participantFromPokemon, stepperHtml, toast,
} from './dm-common.js';
import { openPicker } from './picker.js';
import { pickMoves } from './move-picker.js';
import { prepareImage } from './display.js';

const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SLOT_NAMES = ['Primary', 'Secondary', 'Hidden'];

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] || null));
    input.click();
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read the file"));
    r.readAsDataURL(file);
  });
}

/** Opens the form for `trainer`. `ownedSpecies`: the species they already have (lowercase) -- a trainer can only have
 * one of each in the app, so those are refused up front. Resolves true once a Pokémon was given. */
export async function givePokemonPopup(trainer, { ownedSpecies = [] } = {}) {
  let species;
  try {
    species = await getSpecies();
  } catch (err) {
    showCombatAlert(`Couldn't load the species: ${err.message}`, { title: 'Give Pokémon' });
    return false;
  }
  const owned = new Set(ownedSpecies.map(s => String(s).toLowerCase()));
  let current = null; // the chosen species' entry
  let heldItem = '';
  let levelMoves = []; // the moves its level gives it (the preview's)
  let customMoves = []; // moves taught on top
  let shinyPictures = null; // {still, animated} of the chosen species' shiny pictures, once looked up
  let previewTimer = null;
  let previewSeq = 0;

  const html = `
    <form id="gpForm" class="dm-cs-form" autocomplete="off">
      <div class="dm-cs-cols">
        <div>
          <div class="dm-field"><label>Species</label>
            <button type="button" class="dm-gp-pick" id="gpSpeciesPick">
              <span class="dm-cs-head-thumb" id="gpThumb"><img src="assets/Pokeball-small.png" alt="" style="opacity:0.35"></span>
              <span class="dm-gp-pick-text"><b id="gpTitle">Pick a species…</b><span class="dm-species-meta" id="gpMeta">Click to search every Pokémon</span></span>
              <span class="dm-gp-pick-go">🔍</span>
            </button></div>
          <div class="dm-row">
            <div class="dm-field"><label for="gpName">Name <small class="dm-label-note">empty = the species' name</small></label>
              <input class="dm-input" id="gpName" placeholder="Nickname"></div>
            <div class="dm-field" style="max-width:150px"><label for="gpLevel">Level</label>
              ${stepperHtml({ id: 'gpLevel', min: 1, max: 20, value: 1 })}</div>
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="gpNature">Nature</label>
              <select class="dm-select" id="gpNature"><option value="">None</option>${natureOptions('')}</select></div>
            <div class="dm-field"><label>Held item</label>
              <div class="dm-gp-item"><button type="button" class="dm-btn" id="gpItemPick">🎒 <span id="gpItemName">None</span></button>
                <button type="button" class="dm-icon-btn" id="gpItemClear" title="No held item" hidden>✕</button></div></div>
          </div>
          <div class="dm-field"><label>Abilities</label><div id="gpAbilities"><div class="dm-hint">Pick a species first.</div></div></div>
          <div class="dm-field"><label>Skills <small class="dm-label-note">its species' own are always on -- tick extra ones</small></label>
            <div id="gpSkills"><div class="dm-hint">Pick a species first.</div></div></div>
          <label class="dm-check"><input type="checkbox" id="gpShiny"><span>Shiny ✨</span></label>
          <div class="dm-gp-shiny" id="gpShinyNote" hidden></div>
        </div>
        <div>
          <div class="dm-field"><label>Numbers <small class="dm-label-note">grey = worked out from species, level and nature -- type a number (or − / +) to change it</small></label>
            <div class="dm-stat-grid">
              ${STATS.map(k => `<div class="dm-stat"><label>${k.toUpperCase()}</label>${stepperHtml({ attrs: `data-stat="${k}"`, placeholder: '…', cls: 'small' })}</div>`).join('')}
              ${[['ac', 'AC'], ['maxHP', 'Max HP'], ['maxVP', 'Max VP']].map(([k, l]) => `<div class="dm-stat"><label>${l}</label>${stepperHtml({ attrs: `data-override="${k}"`, placeholder: '…', cls: 'small' })}</div>`).join('')}
            </div>
            <div class="dm-base-line" id="gpDerived"></div>
          </div>
          <div class="dm-field"><label>Moves <small class="dm-label-note">what its level gives it, and any you teach it (gold)</small></label>
            <div class="dm-move-chips" id="gpMoves"><span class="dm-hint">Pick a species first.</span></div></div>
        </div>
      </div>
    </form>`;

  const read = (body) => {
    const stats = {};
    const overrides = {};
    body.querySelectorAll('[data-stat]').forEach(i => { const v = parseInt(i.value, 10); if (!Number.isNaN(v)) stats[i.dataset.stat] = v; });
    body.querySelectorAll('[data-override]').forEach(i => { const v = parseInt(i.value, 10); if (!Number.isNaN(v)) overrides[i.dataset.override] = v; });
    return {
      species: current?.name || '',
      level: Math.max(1, Math.min(20, parseInt(body.querySelector('#gpLevel').value, 10) || 1)),
      nature: body.querySelector('#gpNature').value,
      abilities: [...body.querySelectorAll('input[name="gpAbility"]:checked')].map(cb => Number(cb.value)),
      nickname: body.querySelector('#gpName').value.trim(),
      item: heldItem,
      shiny: body.querySelector('#gpShiny').checked,
      stats, overrides,
      extraSkills: current ? readMultiSelect('gpSkills') : [],
      customMoves: [...customMoves],
    };
  };

  const drawMoves = (body) => {
    const box = body.querySelector('#gpMoves');
    if (!current) return;
    box.innerHTML = levelMoves.map(m => `<span>${escapeHtml(m)}</span>`).join('')
      + customMoves.map(m => `<span class="custom">${escapeHtml(m)}<button type="button" class="dm-chip-x" data-drop-move="${escapeHtml(m)}" title="Take it away">×</button></span>`).join('')
      + '<button type="button" class="dm-btn small" id="gpTeach" title="A move it hasn\'t learned yet, or can\'t normally learn">💥 Teach a move</button>';
  };

  const preview = async (body) => {
    if (!current) return;
    const seq = ++previewSeq;
    const cfg = read(body);
    try {
      const res = await DmAPI.buildPokemon({ ...cfg, preview: true });
      if (seq !== previewSeq || !document.body.contains(body)) return;
      const row = res.data;
      const { participant: p } = participantFromPokemon(row);
      body.querySelectorAll('[data-stat]').forEach(i => { i.placeholder = p[i.dataset.stat] ?? '?'; });
      body.querySelectorAll('[data-override]').forEach(i => { i.placeholder = p[i.dataset.override] ?? '?'; });
      const sign = n => (n >= 0 ? `+${n}` : `${n}`);
      body.querySelector('#gpDerived').textContent = `Initiative ${sign(Number(row.combat.initiative) || 0)} · Proficiency +${row.combat.proficiency} · STAB +${row.combat.stab} · Skills: ${(row.skills || []).join(', ') || '-'}`;
      levelMoves = (p.moves || []).filter(m => !customMoves.includes(m));
      drawMoves(body);
    } catch (err) {
      if (seq === previewSeq) body.querySelector('#gpDerived').textContent = `Couldn't work the numbers out: ${err.message}`;
    }
  };
  const schedulePreview = (body) => { clearTimeout(previewTimer); previewTimer = setTimeout(() => preview(body), 300); };

  /** Shiny ticked: does its species have a shiny picture? If not, offer to upload one. */
  const drawShiny = async (body) => {
    const note = body.querySelector('#gpShinyNote');
    const on = body.querySelector('#gpShiny').checked;
    if (!on || !current) { note.hidden = true; return; }
    if (!shinyPictures) {
      note.hidden = false;
      note.innerHTML = '<span class="dm-hint">Looking for its shiny picture…</span>';
      const name = current.name;
      const rec = await DmAPI.adminSpecies(name).catch(() => null);
      if (current?.name !== name) return;
      shinyPictures = { still: rec?.pictures?.stillShiny || '', animated: rec?.pictures?.animatedShiny || '' };
    }
    const has = shinyPictures.still || shinyPictures.animated;
    note.hidden = false;
    note.innerHTML = has
      ? `<span class="dm-hint">✓ ${escapeHtml(current.name)} has a shiny ${shinyPictures.animated ? 'animated sprite' : 'picture'}${shinyPictures.animated && shinyPictures.still ? ' and picture' : ''}.</span>`
      : `<span>${escapeHtml(current.name)} has no shiny picture yet.</span>
         <button type="button" class="dm-btn small" id="gpShinyUpload" title="A still picture (PNG, JPG, WebP) or an animated sprite (MP4) -- saved for every shiny ${escapeHtml(current.name)}">⬆ Upload a shiny picture…</button>`;
    body.querySelector('#gpShinyUpload')?.addEventListener('click', () => uploadShiny(body));
  };

  const uploadShiny = async (body) => {
    const file = await pickFile('image/png,image/jpeg,image/webp,video/mp4');
    if (!file || !current) return;
    const btn = body.querySelector('#gpShinyUpload');
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
    const animated = file.type === 'video/mp4';
    try {
      const data = animated ? await readAsDataUrl(file) : await prepareImage(file, 1024);
      const pics = await DmAPI.adminPokemonImage({ species: current.name, kind: animated ? 'animated' : 'still', shiny: true, data });
      shinyPictures = { still: pics?.stillShiny || '', animated: pics?.animatedShiny || '' };
      toast(`${current.name}'s shiny ${animated ? 'animated sprite' : 'picture'} is saved.`);
    } catch (err) {
      showCombatAlert(err.message, { title: "Couldn't upload it" });
    }
    drawShiny(body);
  };

  const useSpecies = (body, s) => {
    if (!s || s === current) return;
    current = s;
    customMoves = [];
    levelMoves = [];
    shinyPictures = null;
    body.querySelector('#gpTitle').textContent = s.name;
    body.querySelector('#gpMeta').innerHTML = `${typeBadges(s.type1, s.type2)} ${escapeHtml(s.size || '')}${s.rarity ? ` · ${escapeHtml(s.rarity)}` : ''}`;
    const thumb = body.querySelector('#gpThumb');
    if (s.image) patchPortraitMedia(thumb, s.image, s.name, { small: true }); else thumb.innerHTML = '<img src="assets/Pokeball-small.png" alt="" style="opacity:0.35">';
    body.querySelector('#gpLevel').value = s.level || 1;
    body.querySelector('#gpAbilities').innerHTML = (s.abilities || []).map(a => `
      <label class="dm-check"><input type="checkbox" name="gpAbility" value="${a.slot}" ${a.slot === 0 ? 'checked' : ''}>
        <span>${escapeHtml(a.name)} <small>${SLOT_NAMES[a.slot] || ''} -- ${escapeHtml(a.description)}</small></span></label>`).join('')
      || '<div class="dm-hint">No abilities listed.</div>';
    const ownSkills = splitList(s.base?.skills, SKILLS);
    body.querySelector('#gpSkills').innerHTML = multiSelectHtml('gpSkills', [...SKILLS, ...ownSkills.filter(k => !SKILLS.includes(k))], [],
      { locked: ownSkills, placeholder: 'No skills' });
    bindMultiSelects(body.querySelector('#gpSkills'));
    body.querySelectorAll('[data-stat], [data-override]').forEach(i => { i.value = ''; });
    body.querySelector('#gpDerived').textContent = owned.has(s.name.toLowerCase())
      ? `${trainer} already has a ${s.name} -- a trainer can only have one of each species in the app.` : '';
    drawShiny(body);
    preview(body);
  };

  const pickSpecies = async (body) => {
    const res = await openPicker({
      title: '🐾 Pick a species',
      hint: 'Search by name, number, type or habitat.',
      items: species.map(s => ({
        key: s.name, label: s.name, image: s.image || '',
        sub: `#${s.dex ?? '?'} ${[s.type1, s.type2].filter(Boolean).join('/')}${owned.has(s.name.toLowerCase()) ? ' · already has one' : ''}`,
        search: `${s.dex} ${s.type1 || ''} ${s.type2 || ''} ${s.habitat || ''}`,
      })),
    });
    const s = res?.keys?.[0] && species.find(x => x.name === res.keys[0]);
    if (s) useSpecies(body, s);
  };

  const pickItem = async (body) => {
    const items = await DmAPI.adminItems().catch(() => JSON.parse(sessionStorage.getItem('items') || '[]'));
    const res = await openPicker({
      title: '🎒 A held item', imageFallback: 'assets/Bag.png', hint: 'Search by name or category.',
      items: items.map(i => ({ key: i.name, label: i.name, sub: i.category || '', group: i.category || 'Misc', image: i.image || '', search: i.category || '' })),
    });
    if (!res?.keys?.[0]) return;
    setItem(body, res.keys[0]);
  };

  const setItem = (body, name) => {
    heldItem = name || '';
    body.querySelector('#gpItemName').textContent = heldItem || 'None';
    body.querySelector('#gpItemClear').hidden = !heldItem;
    schedulePreview(body);
  };

  const result = await openDmModal({
    title: `Give ${trainer} a Pokémon`, wide: true, html,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'Give Pokémon', kind: 'primary', value: true, keepOpen: true, onClick: async (body) => {
        const cfg = read(body);
        if (!cfg.species) { showCombatAlert('Pick a species first.', { title: 'Give Pokémon' }); return false; }
        if (owned.has(cfg.species.toLowerCase())) {
          showCombatAlert(`${trainer} already has a ${cfg.species} -- a trainer can only have one of each species in the app.`, { title: 'Give Pokémon' });
          return false;
        }
        if (!cfg.abilities.length) cfg.abilities = [0];
        try {
          await DmAPI.givePokemon(trainer, cfg);
          return true;
        } catch (err) {
          showCombatAlert(err.message, { title: 'Give Pokémon' });
          return false;
        }
      } },
    ],
    onOpen: (body) => {
      body.querySelector('#gpSpeciesPick').addEventListener('click', () => pickSpecies(body));
      body.querySelector('#gpItemPick').addEventListener('click', () => pickItem(body));
      body.querySelector('#gpItemClear').addEventListener('click', () => setItem(body, ''));
      body.querySelector('#gpShiny').addEventListener('change', () => drawShiny(body));
      body.querySelector('#gpMoves').addEventListener('click', async (e) => {
        const drop = e.target.closest('[data-drop-move]');
        if (drop) { customMoves = customMoves.filter(m => m !== drop.dataset.dropMove); drawMoves(body); schedulePreview(body); return; }
        if (!e.target.closest('#gpTeach')) return;
        const picked = await pickMoves({ title: `💥 Teach ${current?.name || 'it'} a move`, exclude: [...levelMoves, ...customMoves] });
        if (picked) { customMoves = [...customMoves, ...picked.filter(m => !customMoves.includes(m))]; drawMoves(body); }
      });
      const form = body.querySelector('#gpForm');
      form.addEventListener('submit', (e) => e.preventDefault());
      form.addEventListener('input', (e) => { if (!e.target.matches('#gpName')) schedulePreview(body); });
      form.addEventListener('change', (e) => { if (e.target.matches('select, input[type=checkbox]')) schedulePreview(body); });
      // Straight to the species
      setTimeout(() => pickSpecies(body), 50);
    },
  });
  return !!result;
}
