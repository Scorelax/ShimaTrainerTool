// DM console -- the Party module's "Give Pokémon": the DM fills in a Pokémon (species, name, level, nature, abilities,
// held item, shiny, extra skills, and any numbers they want different) and it goes straight into a trainer's team,
// without an encounter. routes_dm.py's give-pokemon -- the same build the Post battle tab's "give to trainer" uses, and
// the same maths a player's own registration runs. A live preview shows the numbers and moves before anything is saved.
import { DmAPI } from '../api.js';
import { patchPortraitMedia } from '../utils/sprite-media.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import {
  escapeHtml, typeBadges, natureOptions, SKILLS, splitList, multiSelectHtml, bindMultiSelects, readMultiSelect,
  openDmModal, getSpecies, participantFromPokemonRow,
} from './dm-common.js';

const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SLOT_NAMES = ['Primary', 'Secondary', 'Hidden'];

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
  const items = JSON.parse(sessionStorage.getItem('items') || '[]');
  const owned = new Set(ownedSpecies.map(s => String(s).toLowerCase()));
  let current = null; // the chosen species' entry
  let previewTimer = null;
  let previewSeq = 0;

  const html = `
    <datalist id="gpSpeciesNames">${species.map(s => `<option value="${escapeHtml(s.name)}">No. ${escapeHtml(s.dex)}</option>`).join('')}</datalist>
    <datalist id="gpItemNames">${items.map(i => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.type || '')}</option>`).join('')}</datalist>
    <form id="gpForm" class="dm-cs-form" autocomplete="off">
      <div class="dm-cs-cols">
        <div>
          <div class="dm-field"><label for="gpSpecies">Species</label>
            <input class="dm-input" id="gpSpecies" list="gpSpeciesNames" placeholder="Type to search…"></div>
          <div class="dm-cs-head" id="gpHead" hidden>
            <span class="dm-cs-head-thumb" id="gpThumb"></span>
            <div><h3 class="dm-cs-title" id="gpTitle"></h3><div class="dm-species-meta" id="gpMeta"></div></div>
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="gpName">Name <small class="dm-label-note">empty = the species' name</small></label>
              <input class="dm-input" id="gpName" placeholder="Nickname"></div>
            <div class="dm-field" style="max-width:110px"><label for="gpLevel">Level</label>
              <input class="dm-input" id="gpLevel" type="number" min="1" max="20" value="1"></div>
          </div>
          <div class="dm-row">
            <div class="dm-field"><label for="gpNature">Nature</label>
              <select class="dm-select" id="gpNature"><option value="">None</option>${natureOptions('')}</select></div>
            <div class="dm-field"><label for="gpItem">Held item</label>
              <input class="dm-input" id="gpItem" list="gpItemNames" placeholder="None"></div>
          </div>
          <div class="dm-field"><label>Abilities</label><div id="gpAbilities"><div class="dm-hint">Pick a species first.</div></div></div>
          <div class="dm-field"><label>Skills <small class="dm-label-note">its species' own are always on -- tick extra ones</small></label>
            <div id="gpSkills"><div class="dm-hint">Pick a species first.</div></div></div>
          <label class="dm-check"><input type="checkbox" id="gpShiny">Shiny</label>
        </div>
        <div>
          <div class="dm-field"><label>Numbers <small class="dm-label-note">grey = worked out from species, level and nature -- type a number to change it</small></label>
            <div class="dm-stat-grid">
              ${STATS.map(k => `<div class="dm-stat"><label>${k.toUpperCase()}</label><input class="dm-input" data-stat="${k}" type="number" placeholder="…"></div>`).join('')}
              ${[['ac', 'AC'], ['maxHP', 'Max HP'], ['maxVP', 'Max VP']].map(([k, l]) => `<div class="dm-stat"><label>${l}</label><input class="dm-input" data-override="${k}" type="number" placeholder="…"></div>`).join('')}
            </div>
            <div class="dm-base-line" id="gpDerived"></div>
          </div>
          <div class="dm-field"><label>Moves at this level</label><div class="dm-move-chips" id="gpMoves"><span class="dm-hint">Pick a species first.</span></div></div>
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
      item: body.querySelector('#gpItem').value.trim(),
      shiny: body.querySelector('#gpShiny').checked,
      stats, overrides,
      extraSkills: current ? readMultiSelect('gpSkills') : [],
    };
  };

  const preview = async (body) => {
    if (!current) return;
    const seq = ++previewSeq;
    const cfg = read(body);
    try {
      const res = await DmAPI.buildPokemon({ ...cfg, preview: true });
      if (seq !== previewSeq || !document.body.contains(body)) return;
      const row = res.data;
      const { participant: p } = participantFromPokemonRow(row);
      body.querySelectorAll('[data-stat]').forEach(i => { i.placeholder = p[i.dataset.stat] ?? '?'; });
      body.querySelectorAll('[data-override]').forEach(i => { i.placeholder = p[i.dataset.override] ?? '?'; });
      const sign = n => (n >= 0 ? `+${n}` : `${n}`);
      body.querySelector('#gpDerived').textContent = `Initiative ${sign(Number(row[30]) || 0)} · Proficiency +${row[31]} · STAB +${row[34]} · Skills: ${row[22] || '-'}`;
      body.querySelector('#gpMoves').innerHTML = (p.moves || []).map(m => `<span>${escapeHtml(m)}</span>`).join('') || '<span class="dm-hint">None</span>';
    } catch (err) {
      if (seq === previewSeq) body.querySelector('#gpDerived').textContent = `Couldn't work the numbers out: ${err.message}`;
    }
  };
  const schedulePreview = (body) => { clearTimeout(previewTimer); previewTimer = setTimeout(() => preview(body), 300); };

  const pickSpecies = (body) => {
    const typed = body.querySelector('#gpSpecies').value.trim().toLowerCase();
    const s = species.find(x => x.name.toLowerCase() === typed);
    if (!s || s === current) return;
    current = s;
    body.querySelector('#gpHead').hidden = false;
    body.querySelector('#gpTitle').textContent = s.name;
    body.querySelector('#gpMeta').innerHTML = `${typeBadges(s.type1, s.type2)} ${escapeHtml(s.size || '')}${s.rarity ? ` · ${escapeHtml(s.rarity)}` : ''}`;
    const thumb = body.querySelector('#gpThumb');
    if (s.image) patchPortraitMedia(thumb, s.image, s.name, { small: true }); else thumb.innerHTML = '';
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
    if (owned.has(s.name.toLowerCase())) {
      body.querySelector('#gpDerived').textContent = `${trainer} already has a ${s.name} -- a trainer can only have one of each species in the app.`;
    }
    preview(body);
  };

  const result = await openDmModal({
    title: `Give ${trainer} a Pokémon`, wide: true, html,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'Give Pokémon', kind: 'primary', value: true, keepOpen: true, onClick: async (body) => {
        const cfg = read(body);
        if (!cfg.species) { showCombatAlert('Pick a species from the list first.', { title: 'Give Pokémon' }); return false; }
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
      const speciesInput = body.querySelector('#gpSpecies');
      speciesInput.addEventListener('change', () => pickSpecies(body));
      speciesInput.addEventListener('input', () => pickSpecies(body));
      const form = body.querySelector('#gpForm');
      form.addEventListener('submit', (e) => e.preventDefault());
      form.addEventListener('input', (e) => { if (!e.target.matches('#gpSpecies, #gpName, #gpItem')) schedulePreview(body); });
      form.addEventListener('change', (e) => { if (e.target.matches('select, input[type=checkbox]')) schedulePreview(body); });
      setTimeout(() => speciesInput.focus(), 50);
    },
  });
  return !!result;
}
