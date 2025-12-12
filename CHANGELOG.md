# Pokemon DnD Trainer Tool - Development Changelog

This file tracks all changes made to the project across development sessions.

---

## Session: 2025-01-12 - Pokemon Card Improvements and Move Popup Overhaul

### Part 1: Move Details Popup Complete Redesign (`js/pages/pokemon-card.js`)

**Visual Redesign**:
1. **X Close Button**
   - Moved to top-right corner (consistent with other popups)
   - Circular button with hover effects (scale animation)
   - Semi-transparent background with white border
   - Positioned absolutely in colored header

2. **Improved Layout**
   - Type-colored header section with move name and type badge
   - White body section with organized information grids
   - Backdrop blur effect (rgba(0,0,0,0.7) + backdrop-filter)
   - Larger max-width (600px vs 65vh)
   - Better use of spacing and visual hierarchy

3. **Color-Coded Sections**
   - Gray background (#f5f5f5) for description
   - Green background (#e8f5e9) for attack/damage rolls
   - Orange background (#fff3e0) for held items with left border
   - Type-specific colors for header

**Use Move Button**:
1. **VP Cost Deduction**
   - Automatically subtracts VP cost when clicked
   - Updates combat tracker VP display instantly
   - Updates sessionStorage (pokemonData[46])
   - Persists to database via PokemonAPI.updateLiveStats()
   - Closes popup after successful use

2. **VP Overflow to HP**
   - Pokemon can use moves even when VP = 0
   - Excess VP cost deducts from HP instead
   - Example: VP=2, Move Cost=5 → VP=0, HP-=3
   - Updates both HP and VP in UI/storage/database
   - HP protected from going below 0 (Math.max)

3. **Error Handling**
   - Removed "Not enough VP" error (now allows overflow)
   - Silent database errors logged to console
   - Always succeeds if move can be used

4. **Button Styling**
   - Green gradient background (#4CAF50 to #45A049)
   - Full width with rounded corners
   - Hover effect: lifts up 2px with enhanced shadow
   - Smooth transitions on all interactions

**Attack Roll & Damage Roll Modifiers**:
1. **Attack Roll Calculation**
   - Formula: `Proficiency (if STAB) + Highest Stat Modifier`
   - STAB check: Move type matches Pokemon type (type1 or type2)
   - Proficiency from pokemonData[33]
   - Parses move modifiers (e.g., "STR/DEX")
   - Selects highest applicable stat modifier
   - Example: Move allows STR/DEX, Pokemon has STR +3 and DEX +4 → uses +4

2. **Damage Roll Calculation**
   - Formula: `STAB Bonus + Highest Stat Modifier`
   - STAB bonus from pokemonData[34] (default 2)
   - Applied only if move type matches Pokemon type
   - Uses same highest stat modifier logic

3. **Stat Modifier Calculation**
   - All stats: STR, DEX, CON, INT, WIS, CHA
   - Formula: `Math.floor((stat - 10) / 2)`
   - Reads base stats from pokemonData indices 7-12

4. **Display**
   - Green section with two-column grid
   - Large colored numbers: green for attack (+), red for damage (+)
   - Format: "Attack Roll: +7" and "Damage Roll: +5"

**Held Items Section**:
1. **Display**
   - Orange highlighted box with left border
   - Shows all held items with names and descriptions
   - Comma-separated string parsed into array
   - Each item on separate line with bold name

2. **Data Fetching**
   - Reads heldItemsStr from pokemonData[35]
   - Splits by comma, trims whitespace
   - Looks up each item in items database (sessionStorage)
   - Shows effect or description field
   - Fallback message if item not in database

3. **Purpose**
   - Helps player see item bonuses during combat
   - Reference for additional damage/effects
   - Example: "Charcoal: Increases Fire-type damage by 2"

**Technical Implementation**:
- Function reads all data from sessionStorage at runtime
- No dependency on closure scope variables
- Creates popup once, updates content on each call
- Type colors from getMoveTypeColor() function
- Text color auto-adjusted for readability (getTextColorForBackground)
- Event listeners added only on first popup creation
- Move data from window.allMoves array

**Bug Fix**:
- Fixed "Identifier 'stabBonus' has already been declared" syntax error
- Renamed stabBonus to stabBonusValue at line 2280
- Used stabBonusValue to calculate final stabBonus at line 2321

### Part 2: Held Items Display Fix (`js/pages/pokemon-card.js`)

**Problem**:
- Multiple held items displayed as single button
- Example: "Poison Barb, Sitrus Berry" shown as one item
- Clicking showed combined name in popup

**Solution**:
1. **Parse Comma-Separated Items**
   - Read pokemonData[35] as comma-separated string
   - Split by comma: `heldItemsStr.split(',')`
   - Trim whitespace: `.map(item => item.trim())`
   - Filter empty strings: `.filter(item => item)`

2. **Generate Individual Buttons**
   - Map each item to separate button with data-item-index
   - Same styling as abilities (white background, black text)
   - Each button: 2px #333 border, rounded corners
   - Consistent with ability button pattern

3. **Click Handler Updates**
   - Use querySelectorAll for multiple buttons
   - Read data-item-index from clicked button
   - Look up specific item from heldItems array
   - Show correct item description in popup

**Result**:
- "Poison Barb" gets own button
- "Sitrus Berry" gets own button
- Each clickable independently
- Shows correct description per item

### Part 3: Active Party/Utility Slot Optimistic Updates (`js/pages/pokemon-card.js`)

**Problem**:
- Checkboxes had noticeable delay before changes appeared
- User could navigate back to trainer-card before update visible
- Required leaving/re-entering page to see changes

**Solution - Optimistic Updates**:
1. **Immediate SessionStorage Update**
   - Update pokemonData and trainerData immediately on click
   - Save to sessionStorage before API call
   - Changes visible instantly on trainer-card

2. **Active Party Checkbox**
   - Find first empty slot (indices 26-31)
   - Set trainerData[slotIndex] = pokemonName
   - Update pokemonData[38] with slot number
   - Make API call in background
   - Correct slot placement if server returns different slot
   - Rollback all changes if API fails

3. **Utility Slot Checkbox**
   - Update pokemonData[56] immediately
   - Clear other Pokemon from utility slot
   - Track cleared Pokemon for rollback
   - Make API call in background
   - Restore everything if API fails

4. **Rollback Mechanism**
   - Store original state before changes
   - Active Party: Save all 6 party slot values
   - Utility: Track cleared Pokemon with keys
   - Restore on API error or failure response
   - Revert checkbox state on rollback

5. **Success Messages Removed**
   - No more "Added to active party!" notifications
   - No more "Removed from active party!" notifications
   - Updates are silent (instant feedback is enough)
   - Error messages still shown on failure

**Result**:
- Changes appear instantly (no waiting for API)
- Back button navigation shows immediate updates
- Feels as responsive as HP/VP updates
- Rollback protection ensures data consistency

### Part 4: Pokemon Card Cleanup (`js/pages/pokemon-card.js`, `js/pages/my-pokemon.js`, `js/pages/trainer-card.js`)

**Back Button Navigation**:
1. **Problem**: Always navigated to trainer-card
2. **Solution**: Remember previous route in sessionStorage
   - my-pokemon page sets `previousRoute = 'my-pokemon'`
   - trainer-card page sets `previousRoute = 'trainer-card'`
   - Back button reads previousRoute (defaults to trainer-card)
3. **Files Modified**:
   - `pokemon-card.js` line 1497: Read previousRoute
   - `my-pokemon.js` line 367: Set previousRoute
   - `trainer-card.js` lines 585, 598: Set previousRoute (party & utility slots)

**Active Party Checkbox Fix**:
1. **Problem**: "Failed to update active pokemon status" error
2. **Cause**: Wrong API method name
   - Was: `PokemonAPI.updateActiveParty()`
   - Should be: `PokemonAPI.updatePartyStatus()`
3. **Fix**: Changed method name at line 1572
4. **Result**: Checkbox now works correctly

**Movement Display**:
1. **Problem**: Duplicate "ft" suffix
   - Database values already include "ft" (e.g., "35ft")
   - Code was adding another " ft" → "35ft ft"
2. **Fix**: Removed " ft" from template string at line 126
   - Was: `${movementTypes[index]}: ${value} ft`
   - Now: `${movementTypes[index]}: ${value}`
3. **Result**: Clean display like "Walking: 35ft"

**Description Box Responsive Sizing**:
1. **Problem**: Text cut off on right side on tablets
2. **Fixes Applied**:
   - `.description-text`: Added word-wrap, overflow-wrap, max-width: 100%
   - `.right-column`: Added max-width: 100%, overflow: hidden
3. **Result**: Text wraps properly on all screen sizes

**Skills Grid Overflow Fix**:
1. **Problem**: Skills grid cut off on right side
2. **Fixes Applied**:
   - `.skills-container`: Added max-width: 100%, overflow: hidden
   - `.skills-grid`: Added max-width: 100%, box-sizing: border-box
   - `.skill-item`: Added min-width: 0, word-wrap, overflow-wrap
3. **Result**: Skills grid fits properly without overflow

### Part 5: Edit Pokemon Form Improvements (`js/pages/edit-pokemon.js`)

**Nature Field Conversion**:
1. **From**: Styled dropdown (always visible)
2. **To**: Collapsible section with radio buttons
   - Matches Abilities, Skills, and Feats sections
   - Red gradient collapsible header
   - Radio buttons for single selection (vs checkboxes for multi)
   - Arrow indicator (▶) rotates on toggle

3. **Implementation**:
   - Added 'nature' to collapsible sections array
   - HTML uses radio buttons: `<input type="radio" name="nature">`
   - All natures listed with current one pre-checked
   - Updated event listener to handle radio button change events
   - Form submission reads `form.nature.value` (works with radios)

4. **Styling**:
   - Shared CSS with checkboxes (checkbox-item class)
   - Radio buttons get same size/cursor as checkboxes
   - Consistent hover/active states

**Held Items Multi-Select**:
1. **From**: Single text input field
2. **To**: Chip-based multi-select (like Custom Moves)
   - Autocomplete dropdown for item search
   - "Add" button to add selected item
   - Visual chips with × remove button
   - Multiple items stored as comma-separated string

3. **Implementation**:
   - Input field + autocomplete dropdown
   - Add button with click handler
   - Each item rendered as removable chip
   - Chips stored in hidden field as comma-separated
   - Form submission gathers all chip values
   - Data saved to pokemonData[35]

4. **Field Positioning**:
   - Moved Nature below Custom Moves, above Abilities
   - Added padding-bottom to chip-container for spacing

---

## Session: 2025-01-27 (Part 3) - Combat Tracker Enhancements
