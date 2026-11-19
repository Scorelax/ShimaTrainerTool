// Patch notes (the user's call, 2026-11-18): what's new since the last session, in plain, casual words -- it's a game
// with friends, not a release note. The players see `players` from the 📜 Patch Notes button on the start screen
// (js/pages/index.js); the DM sees `dm` from the Patch Notes button on the DM console's rail (js/dm/patch-notes.js).
//
// Newest first. To add a new round after a session: put a new entry at the top with a new `id` (the button lights up
// again for everyone who hasn't opened it since). No dates on the single changes -- just what's different.
export const PATCH_NOTES = [
  {
    id: '2026-11-18',
    title: 'Since the Nov 12 session',
    players: {
      intro: "Mostly battle stuff this time. Last session's big fight showed us a bunch of things going wonky, so a lot of that should be way smoother now.",
      items: [
        '🖼️ Added a bunch more item pictures.',
        '🔁 Fixed reactions getting the battle stuck in a loop (the Rapid Orders soft lock). You can react to someone taking an extra action now too.',
        "💥 Area moves (like Rock Slide): everyone caught in it rolls their save at the same time on their own phone, and the damage is rolled once for everybody. There's a little panel showing who's still rolling.",
        '🛡️ You can react (Protect and friends) while the attack is being rolled, not only the second you get targeted. Same for area moves while the saves are coming in.',
        "⏱️ The 10 second timer on a reaction offer doesn't start until you can actually see it.",
        "🪟 Popups don't pile up on top of each other anymore. They wait in line and show up one at a time.",
        '🎬 Move animations wait until the hit has actually landed and everyone is done reacting, so no more animations going off way too early. The big screen plays them properly now too.',
        '👻 Spite works like it should.',
        '⏳ The waiting screens tell you who you are actually waiting on.',
        '🎯 You can pick your targets right on the battle map instead of the card grid. Just hit "Pick on the map".',
        '💚 Whoever\'s turn it is gets a green glow on the map, and the target you picked gets a pink ring.',
        '🗺️ If a fight starts out on the adventure map, you place yourself starting from where you were standing. When it\'s over, the adventure picks up right where everybody ended up.',
      ],
    },
    dm: {
      intro: 'A new helper, a tidier Battle tab, and a pile of battle fixes from the Nov 12 playtest.',
      items: [
        '💬 Meet ShimAI, at the bottom of the rail. Ask it how to do stuff in the app, have it sum up the last battle, check on the party (HP, VP, conditions, held items, money), or get it to draft an encounter. The encounter one has blanks to fill in: Tab or Enter jumps to the next one.',
        '📋 The Battle module goes Encounter setup → Map setup → Post battle. Encounter setup is only about who\'s in the fight now, and Map setup is only the map.',
        '▶️ Start encounter from the adventure puts the fight in play right away, with your Pokémon and NPCs on the map where they stood, plus where the players were standing.',
        '🗺️ After a battle on the adventure map, the adventure carries on exactly like the battle map ended. Fainted ones stay where they dropped, caught ones are gone, hidden ones stay hidden.',
        "🏁 Post battle's button is now called Finish battle. It actually takes the battle's encounter out of play (even if you'd put it in play again in the meantime), and its creatures don't sneak into the next battle.",
        '📚 Post battle has a Previous battles list now. Every battle you finish goes in there, so you can go back and check what happened later.',
        "⭐ The XP section only shows the Pokémon that actually fought, with pictures of the trainers and their Pokémon.",
        '💥 Hit "Show impact" on any Pokémon or trainer (or on the names up top) to see what it did in the battle: the moves it used, who it hit and for how much, who hit it, and what happened round by round. Handy for handing out XP.',
        "🖼️ Display backgrounds: a location's folder shows that location's main picture.",
        "💥 Area moves: everyone rolls their saves at once, with a panel showing who's done and a \"Cancel the move\" button if a reaction should stop it.",
        '🔁 Fixed reactions getting stuck in a loop during Rapid Orders and other extra actions. Spite drains properly now too.',
        '🪟 No more three popups stacked on top of each other. They queue up and come one at a time.',
        '🎬 Animations wait until the hit lands and the reactions are over, and the display plays them reliably.',
        "💚 Whoever's turn it is glows green on every map, including yours.",
      ],
    },
  },
];

const SEEN_KEY = 'patch-notes-seen';

// Is there an entry this device hasn't opened yet? (lights the button)
export function hasUnseenPatchNotes(key = SEEN_KEY) {
  try { return !!PATCH_NOTES[0] && localStorage.getItem(key) !== PATCH_NOTES[0].id; } catch { return false; }
}

export function markPatchNotesSeen(key = SEEN_KEY) {
  try { if (PATCH_NOTES[0]) localStorage.setItem(key, PATCH_NOTES[0].id); } catch { /* not kept */ }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The notes for one side ('players' | 'dm') as HTML: each entry's title, intro and list, newest first.
export function patchNotesHtml(side) {
  return PATCH_NOTES.filter(e => e[side]?.items?.length).map(e => `
    <section class="patch-notes-entry">
      <h3 class="patch-notes-title">${esc(e.title)}</h3>
      ${e[side].intro ? `<p class="patch-notes-intro">${esc(e[side].intro)}</p>` : ''}
      <ul class="patch-notes-list">${e[side].items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </section>`).join('');
}
