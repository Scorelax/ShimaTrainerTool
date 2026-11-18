# DM handbook — the DM console, screen by screen

The DM console is its own page (dm-console.html), run on the DM's laptop. Across the top: the brand, a status line
(the battle, whose turn it is), and the world clock / weather / pinned timers (click it to open the Clock module).
Down the left is the **rail** of modules: **Battle, Party, Pokédex, NPCs, Clock, PokéNav, Display, Admin** — and at the bottom
**📜 Patch Notes** (what's new in the DM console since the last session; a gold dot means there's something unread) and
**💬 ShimAI** (this chat, the assistant). The module open last opens again after a reload. Most things save to the Pi on their own a
moment after a change; there is rarely a Save button.

The screens around the table:
- **The players' app** on their phones (trainer card, their Pokémon, their Pokédex, the battle screen).
- **The board screen** (battle-map.html): the table's map screen. Shows the battle map during a battle; outside a
  battle it shows PokéNav's region map or the adventure map.
- **The display** (display.html): a second screen with backgrounds and pictures (always called "the display" on
  screen). Run from the Display module.

Code pointers (for searching): the DM console's modules are in js/dm/ — admin.js, admin-moves.js, admin-world.js,
admin-transfer.js, encounters.js, map-editor.js, creature-setup.js, battle-live.js, party.js, give-pokemon.js, npcs.js,
pokedex.js, clock.js, world-clock.js, pokenav.js, adventure.js, display.js, xp.js. The shared battle screen is
js/pages/combat-wip.js (the old js/pages/combat.js is retired). The server is pi-server/app/ (routes_combat.py runs
battles, routes_dm.py the DM's data, admin.py the Admin module).

---

## Battle module

With no battle running it has three tabs, in this order: **Encounter setup**, **🌿 Map setup**, **🏁 Post battle**.
While a battle runs: **Battle**, **🗺️ Map**, **📋 Encounter setup** (to build the next one meanwhile).

### Encounter setup — who the players will face
- The **encounter library** on the left (**＋ New encounter**, a search box). An encounter has a name, **Wild
  Pokémon**, **NPC trainers**, **Events** and **Notes**; its header has **Move to…**, **Save encounter**, **▶ Use for
  the next battle**, **Duplicate** and **Delete**.
- **Wild Pokémon**: **Add** (search a species), **Random** (a random encounter), **Add saved Pokémon**. Each one has
  its level, nature, held item, Shiny and Hidden boxes, and buttons **Info** (everything the Pokédex knows about its
  species, including how hard it is to catch), **⚙ Customize** (abilities, stat bonuses…), **Save** (into the saved
  Pokémon list), **Duplicate**, **Remove**.
- **NPC trainers**: **From the library** (the NPC module's NPCs) or **Random trainer**. Their Pokémon come with them.
- **Events** (**＋ Event**): shown beside the running battle, with a reminder when one is due (reinforcements, a
  collapsing cave, a timer…) — e.g. a countdown that fires on round 3.
- **Notes** with **＋ Note category**, under the encounter list. **Exclusions** (bottom left): species the random
  generators leave out.
- Folders: encounters can be sorted into folders (drag an encounter onto a folder, or **📁 Move to…** on the open
  one). The first time, "Planned encounters" and "Archived encounters" are made. Untick folder mode to see them all
  in one list.
- **▶ Use for the next battle** puts an encounter in play: its Pokémon and NPC trainers become the next battle's. Who
  is in the next battle is decided here and only here.
- An encounter can bring its own map (e.g. one started from the adventure); its header says so (✕ takes it off).

### Map setup — the map and where everyone starts
- The map editor shows the map exactly as the board screen will. Tools: **Objects** (trees, rocks, logs… sized in
  squares, turned to any angle, with a height in feet for line of sight, optionally making their squares difficult
  or blocked), **Terrain** (paint difficult / blocked squares), **Traps** (hidden squares; the DM is told when a
  creature walks onto one), **Eraser**. Objects can be hidden from the players until revealed.
- Placing an object: press a square and, still holding, move the pointer around to turn it; it's placed on release.
  Click a placed object to edit it; click it and then click elsewhere (or drag) to move it.
- Objects and items are added through a picker popup (search, several at once, "Add hidden").
- Maps can be saved and loaded again (Save map; Map setup loads saved maps).
- **Place on the map**: pick a creature (from the list or by clicking its token), click a square to stand it there
  (its own square again takes it off). Each Pokémon is built from the Pokédex at its level, nature and abilities, and
  can still be fine-tuned here (any number overridden, extra skills). A hidden creature can stand on the map too —
  see-through, only the DM sees it until shown. One not placed can join later.
- **▶ Start battle** starts it — the moment the players can join from their app.
- Uploading new map pictures (objects, backgrounds) is in **Admin › 🌲 Map pictures**.

### The running battle
- The middle is the same battle screen the players use, run as the DM: every DM creature has the same card, moves,
  saves and reactions as a player's Pokémon, and anything a player's attack asks of it (a save, a Sturdy roll) pops up
  for the DM.
- The panel on the right: the table screens, the encounter in play (its events and notes), the DM's creatures (with
  the capture helper), and **Reinforcements**.
- The DM can **give any creature a turn** out of order.
- Players see nothing of a DM creature but its picture until the DM ticks what to show (the HP / VP bars and their
  numbers are separate boxes); 📖 shows them what their Pokédex already knows.
- A **hidden creature (🙈)** is on no screen but the DM's — i.e. a Pokémon can be made invisible to the players, and
  unhidden later.
- **✏️ Edit** changes anything about a creature mid-battle; DM creatures can be taught moves.
- **🙈 Hide from the battle log** keeps what the DM does now out of the players' log (it stays in the DM's).
- The **🗺️ Map** tab: the battle map (moves, cones, lines) or the live map editor — objects, hidden objects, traps,
  the background, and the **Creatures** tool moves, turns, lifts or resizes any creature without using its movement.
- Weather and the enemies are the DM's: the DM console owns them, not the players.

### Post battle
After a PvE battle ends: who was defeated, caught or got away, and what to hand out. Caught Pokémon go into the
trainers' teams, loot and money into their inventories, straight away (pushed live to their phones). **XP** is
DM-only and given here or in the Party module. A dot on the tab means the last battle's post battle isn't done yet.
**✓ Done with this battle** marks it finished: the battle's encounter is no longer in play (its "● in play" mark goes)
and its Pokémon and NPC trainers leave the next battle (the map stays). Put an encounter in play again to fight it again.

---

## Party module
Every player trainer with their current party at a glance; click a trainer for their full page — stats, all their
Pokémon (click one for its full stat block), money and inventory.
- **Give items / money** from a trainer's page (added to what they have).
- **＋ Give Pokémon**: fill in species, name, level, nature, abilities, held item, shiny, extra skills, extra moves
  ("Teach a move" — even moves it can't normally learn) and any numbers; a live preview shows it before it goes into
  the trainer's team. A shiny without a shiny picture can get one uploaded here.
- **XP** (only the DM sees it). XP never changes a level by itself — levelling up has choices the player makes in
  their app; the console shows who is ready.

## Pokédex module
Every species with everything the encyclopedia knows, and next to each piece a checkbox for whether the **players**
see it in their Pokédex: which species are registered at all, per-species switches, and defaults for species
without their own. Saved a moment after each change and pushed to every phone. Also the list of moves the players
can look up on their own.

## NPCs module
The DM's library of NPCs, one sheet each: picture, role, faction, where they're found, attitude to the party,
birthday (shown in the Clock's calendar), story and personality, battle numbers, their Pokémon team, features and
inventory. Saves on its own. **Add to battle setup** puts the NPC and their team into the next battle.

## Clock module
The Shima date and time (move it on in steps, skip to a time of day, or set it), the weather, the calendar (12 months
of 28 days, years counted AFR) with festivals, the DM's calendar events and the NPCs' birthdays, and **timers**
(countdown or stopwatch; real time, world-clock time, or battle turns). Pinned or finished timers show in the top bar.
Kept on the Pi, so a reload or a second laptop shows the same time.

## PokéNav module
What the board screen shows outside a battle. Two tabs, and "On the table screen" (at the tabs' right) picks which one
the board shows:
- **Region Map**: the 3D map of Shima. Turning, zooming, moving it or flying to a town here moves it on the board.
- **Adventure Mode**: a map the players walk around on without a battle (no turns, no initiative, no movement limit).
  The DM builds the map (same editor as Map setup) with Pokémon and NPCs, hidden or not. **Allow player placement**
  opens it to the players (they join from the map button on their trainer card). Switches on the running adventure's
  bar decide when they may place themselves and move. **⚔️ Start encounter** turns the map as it stands into a new
  encounter put in play at once; after that battle the adventure carries on from how the battle ended. The capture
  guide shows how hard each Pokémon is to catch.

## Display module
What the display shows. Left: a live preview with what's on it; right: every Pokémon, NPC and trainer to put on
the screen with a click, and background pictures uploaded from the DM's computer (kept on the Pi). Click the preview
for the big editor: drag pictures, resize from a corner. A picture can be put on hidden first and shown with one click.
During a battle the display shows the turn order over the background.
**📅 Planner**: build planned scenes (in folders) while the display carries on; they wait in the queue under "On the
screen" and **Show** puts one on. A scene's **Override** keeps it over everything during a battle.

## Admin module
The game's data the DM adds to or changes, with their pictures. Tabs:
- **📅 Events** — what the DM plans to happen: title, description, picture, **trigger** and **timeframe** in the DM's
  own words, and where (a location). **＋ New event** makes one; a location's page also has **＋ New event here**.
- **📍 Locations** — the region's places (Region, City, Route, Cave, Forest, Landmark, Building…) with description,
  points of interest, a main picture and their events. Each can be marked on the region map (a spot, a line along the
  roads, or an area) and given a little 3D icon. **🗺 The region map** uploads a new painting of the map (line it up,
  check it, build it; older maps can be put back), or adds a region at a time. **🌲 Tree areas** picks which tree
  models grow where.
- **📕 Pokédex entries** — add or edit species and the abilities they name; each species' four pictures (still,
  still shiny, animated, animated shiny). Export / Import a whole file of entries at once (it shows what would change
  before saving).
- **📜 Battle logs** — every battle (PvE, PvP, adventures), newest first, round by round; the DM can name each one.
  Lines hidden from the players are marked 🙈.
- **🌲 Map pictures** — upload battle-map **objects** (PNG with a see-through background) and **backgrounds** (JPG,
  PNG or WebP, portrait like the board — a landscape one is turned for you); delete them; give a name or the file's is
  used.
- **💥 Moves** — edit or add moves: dice at each level, VP cost, description, action, range… A move whose rules text
  changed is marked **🔍 Needs a look** until checked (its automation may no longer match). Export / Import too.
- **🎒 Items** — add or edit items and their pictures.
- **🌀 Status conditions** — the rulebook's, and the DM's own (a name, a description, a battle trigger, and an
  optional automatic effect).
- **🖼️ Splash screens** — the loading-screen pictures the app picks from at random. **＋ Add splash screens…** uploads
  one or several (PNG, JPG or WebP); each has **Replace…** and **Delete**. A **session splash**, while there, is shown
  instead of the random ones.

---

## Common questions

**Upload a new splash screen:** Admin (🛠️ on the rail) → **🖼️ Splash screens** → **＋ Add splash screens…** → pick
the picture(s). They're used at once.

**Create an event:** Admin → **📅 Events** → **＋ New event** → fill in the title, description, trigger, timeframe,
where, and a picture if wanted. Or from a location in **📍 Locations** → **＋ New event here**.

**ShimAI (this chat)** can draft an encounter and, when asked, save it into the encounter library; it then
appears in Battle → Encounter setup like any other.

**Run a battle from scratch:** Battle → **Encounter setup**: build or open an encounter → **▶ Use for the next battle**
→ **🌿 Map setup**: build or load the map, place everyone → **▶ Start battle** → players join from their app → when it
ends, **🏁 Post battle** to hand out what was won.

**Battle on the adventure map:** PokéNav → Adventure Mode → **⚔️ Start encounter**.

**Give a player a Pokémon / item / money:** Party → click the trainer → **＋ Give Pokémon**, or the item / money boxes.

**Hide something from the players:** a DM creature can be hidden (🙈) — on no screen but the DM's; map objects and
traps can be hidden until revealed; the DM's own battle actions can be kept out of the players' log.

**Add a new battle-map object or background:** Admin → **🌲 Map pictures** → **⬆ Upload an object** / **⬆ Upload a
background**.
