// DM console -- the Admin module's Export and Import (the user's call, 2026-11-02): every move, or every Pokedex entry,
// as one JSON file on the DM's computer, and such a file read back -- many changes at once. The Pi
// (pi-server/app/admin.py import_moves / import_species) checks each entry as its form's Save would and says first what
// the file changes; nothing is saved until the DM says so, and an entry it can't read is left out.
import { DmAPI } from '../api.js';
import { showCombatAlert } from '../utils/combat-alert.js';
import { escapeHtml, toast, openDmModal } from './dm-common.js';

const NAMES_SHOWN = 40; // names listed per heading in the preview -- the rest as "and N more"

/** The two buttons, for an editor's tools column. */
export function transferButtonsHtml() {
  return `<div class="dm-adm-transfer">
    <button class="dm-btn small" data-transfer="export" title="Every one of them as a JSON file">⬇ Export</button>
    <button class="dm-btn small" data-transfer="import" title="Changes from a JSON file -- you see what changes before it's saved">⬆ Import</button>
  </div>`;
}

/** The buttons in `root` wired: `kind` 'moves' | 'pokedex', `what` ("moves", "Pokédex entries"), `fileName` without its
 * date, `onImported()` once a file was saved. */
export function wireTransfer(root, { kind, what, fileName, onImported }) {
  root.querySelector('[data-transfer="export"]')?.addEventListener('click', e => exportFile(e.currentTarget, kind, fileName));
  root.querySelector('[data-transfer="import"]')?.addEventListener('click', e => importFile(e.currentTarget, kind, what, onImported));
}

async function exportFile(btn, kind, fileName) {
  btn.disabled = true;
  try {
    const data = await DmAPI.adminExport(kind);
    const name = `${fileName} ${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Exported "${name}"`);
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't export" });
  } finally {
    btn.disabled = false;
  }
}

function pickJson() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => resolve(input.files?.[0] || null));
    input.click();
  });
}

async function importFile(btn, kind, what, onImported) {
  const file = await pickJson();
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    showCombatAlert(`${file.name} isn't a JSON file the console can read (${err.message}).`, { title: "Couldn't import" });
    return;
  }
  btn.disabled = true;
  try {
    const plan = await DmAPI.adminImport(kind, data, false);
    const count = plan.added.length + plan.changed.length + (plan.abilities?.length || 0);
    const go = await openDmModal({
      title: `Import ${file.name}`,
      wide: true,
      html: previewHtml(plan, what),
      buttons: count
        ? [{ label: 'Cancel', value: false }, { label: `Import ${count} change${count === 1 ? '' : 's'}`, value: true, kind: 'primary' }]
        : [{ label: 'Close', value: false }],
    });
    if (!go) return;
    const done = await DmAPI.adminImport(kind, data, true);
    const saved = done.added.length + done.changed.length + (done.abilities?.length || 0);
    toast(`Imported ${saved} change${saved === 1 ? '' : 's'}.`);
    await onImported?.(done);
  } catch (err) {
    showCombatAlert(err.message, { title: "Couldn't import" });
  } finally {
    btn.disabled = false;
  }
}

/** What the file changes, as the Pi read it. */
function previewHtml(plan, what) {
  const names = (list, mark = () => '') => `${list.slice(0, NAMES_SHOWN).map(n => `<span class="dm-adm-imp-name">${escapeHtml(n)}${mark(n)}</span>`).join('')}${list.length > NAMES_SHOWN ? `<span class="dm-hint">…and ${list.length - NAMES_SHOWN} more</span>` : ''}`;
  const marked = new Set(plan.marked || []);
  const group = (title, list, mark) => (list.length ? `<div class="dm-adm-imp-group"><h4>${title} <span class="dm-pill ok">${list.length}</span></h4><div class="dm-adm-imp-names">${names(list, mark)}</div></div>` : '');
  return `
    <div class="dm-adm-imp">
      <p>${plan.added.length || plan.changed.length || plan.abilities?.length
        ? `This file changes what's below -- the rest of it (${plan.unchanged}) is as it is already.`
        : `Nothing in this file differs from the ${escapeHtml(what)} the game has (${plan.unchanged} the same).`}</p>
      ${group('New', plan.added, n => (marked.has(n) ? ' 🔍' : ''))}
      ${group('Changed', plan.changed, n => (marked.has(n) ? ' 🔍' : ''))}
      ${plan.abilities ? group('Ability descriptions', plan.abilities) : ''}
      ${marked.size ? '<div class="dm-hint">🔍 Marked Needs a look: its text changed (more than its dice), or it\'s new.</div>' : ''}
      ${plan.errors.length ? `<div class="dm-adm-imp-group dm-adm-imp-errors"><h4>Left out <span class="dm-pill todo">${plan.errors.length}</span></h4>
        ${plan.errors.slice(0, NAMES_SHOWN).map(e => `<div><strong>${escapeHtml(e.name)}</strong>: ${escapeHtml(e.error)}</div>`).join('')}
        ${plan.errors.length > NAMES_SHOWN ? `<div class="dm-hint">…and ${plan.errors.length - NAMES_SHOWN} more</div>` : ''}</div>` : ''}
    </div>`;
}
