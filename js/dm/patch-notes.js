// DM console -- Patch Notes (the user's call, 2026-11-18): a rail button just above ShimAI that opens what's new in the
// DM console since the last session. The notes themselves live in js/patch-notes.js (the players' side is there too).
// Like ShimAI it isn't a module: the rail's click handler looks for [data-module], which this hasn't got.
import { openDmModal } from './dm-common.js';
import { patchNotesHtml, hasUnseenPatchNotes, markPatchNotesSeen } from '../patch-notes.js';

const SEEN_KEY = 'dm-patch-notes-seen';   // its own, so the DM opening the players' notes on this laptop doesn't count

export function initPatchNotes() {
  const btn = document.createElement('button');
  btn.className = 'dm-rail-btn dm-rail-patchnotes';
  btn.id = 'dmPatchNotesBtn';
  btn.title = "Patch Notes -- what's new in the DM console since the last session";
  btn.innerHTML = `<span>📜</span>Patch Notes${hasUnseenPatchNotes(SEEN_KEY) ? '<i class="dm-rail-newdot" title="New stuff!"></i>' : ''}`;
  btn.addEventListener('click', () => {
    markPatchNotesSeen(SEEN_KEY);
    btn.querySelector('.dm-rail-newdot')?.remove();
    openDmModal({ title: '📜 Patch Notes', html: `<div class="dm-patch-notes">${patchNotesHtml('dm')}</div>` });
  });
  document.getElementById('dmRail').appendChild(btn);
}
