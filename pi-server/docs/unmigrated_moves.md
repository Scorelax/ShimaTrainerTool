# Moves still without structured `effects`

_Generated 2026-09-23 (updated after migrate_effects_v13.py) against DnD_moves_categorized_draft.json -- 888 moves total, 489 with no `effects` array yet.
 See move-effects-schema.md for the schema itself and its own "Not covered yet" section for the gap-by-gap reasoning._


## 1. Fits the schema already, just not migrated yet (91)

Plain stat/advantage moves -- the exact shape Noble Roar/Withdraw/Skyward Soar etc. already use. No new mechanism needed, purely a matter of writing the OVERRIDES entries.

- **Agility** (stat_buff_self) -- You hone your abilities and feel a surge of speed course through your veins. Increase your movement speed by 20 feet for the duration. Appli
- **Air Cutter** (crit_range_mod) -- You create a gust of razor-like wind to slash an opponent. Make a ranged attack against an opponent, doing 2d8 + MOVE flying damage on a hit
- **Amnesia** (stat_buff_self, stat_debuff_self) -- Your mind elevates to a new level of focus. Add +2 to you AC and any saving throw you make for the duration, but select one of your moves th
- **Aqua Phase** (advantage_on_attack_roll) -- You disappear from view and prepare to surprise a target with an attack. When you activate this move, you become invisible and immune to any
- **Artifact Light** (stat_buff_self) -- You channel energy from ancient artifacts to enhance your combat prowess. If an ancient artifact is within range and you know it is there, a
- **Aura Theft** (potential_stat_increase) -- The user attempts to steal beneficial effects from a target within 30 feet. The target must succeed on a Charisma saving throw or lose all b
- **Aurora Veil** (stat_buff_self) -- You use the environment to create a shield of ice around your body. Only able to be activated while it is hailing, this move can be used as 
- **Autotomize** (stat_buff_self) -- You shed away part of your body to make yourself lighter and increase your speed. For the duration, your speed increases by 10 feet. This mo
- **Beat Up** (potential_disadvantage) -- You exploit a creature's vulnerable position. Make a melee attack, dealing 1d6 + MOVE dark damage on hit. Add 1d6 for each allied creature a
- **Belly Drum** (stat_buff_self) -- You sacrifice health for attack. When using this move, take damage equal to half your maximum, but increase your Strength score by 10 while 
- **Blood Shield** (stat_buff_self) -- You conjure a shield equal to melee damage you have dealt. Gain a shield equal to the damage you dealt since the beginning your last turn. T
- **Calm Mind** (stat_buff_self, increase_stab) -- You clear your mind of all distractions. For the duration, double your STAB bonus when dealing damage of your type.
- **Canopy** (stat_buff_self) -- You sprout a canopy of sap-filled leaves that surround you on all sides. Increase your AC by 1. This increase may be stacked, to a maximum o
- **Charge** (stat_buff_self) -- Electricity surges through your body, charging up for your next attack. Until your next turn, boost your AC by 2. On your next turn, double 
- **Close Combat** (stat_debuff_self) -- You get in close for a devastating strike, sacrificing your defenses. Make a melee attack on an opponent, dealing 3d10 + MOVE fighting damag
- **Corrosive Mist** (stat_debuff_enemy) -- The user exhales a 15-foot cone of corrosive mist. Each creature in the area must make a Constitution saving throw. On a failure, a creature
- **Crabhammer** (crit_range_mod) -- You slam down onto an opponent with a heavy claw. Make a melee attack roll on a target, dealing 3d10 + MOVE water damage on a hit. This move
- **Cursed Gaze** (stat_debuff_enemy) -- Your eyes open wide and fixate on one creature in range, casting a devastating curse. Make a ranged attack. On a hit, force the creature to 
- **Cut** (crit_range_mod) -- You lash out at an enemy with vine or claw or blade. Make a melee roll on an enemy, doing 1d6 + MOVE on a successful hit. This move scores a
- **Defense Curl** (stat_buff_self) -- You curl up into a tight ball, increasing your defensive stance. Until your next turn, you gain + 4 to your AC and have resistance to normal
- **Dig** (advantage_on_attack_roll) -- Your Pokémon burrows underground, disappearing from view before striking from underneath a foe. When you activate this move, you burrow unde
- **Dive** (advantage_on_attack_roll) -- When you activate this move, you dive down and disappear into the Ethereal plane. You may not be targeted by attacks in the Ethereal plane. 
- **Divine Noodle Form** (stat_buff_self) -- Your noodly appendages multiply, and your body grows to a huge size. While in this form, you gain the ability Spaghedeity; you get half of y
- **Drill Peck** (crit_range_mod) -- You hammer down on an enemy with a peck attack. Make a melee attack roll on a target, doing 1d10 + MOVE flying damage on a successful hit. D
- **Enter Formation** (stat_buff_self, stat_buff_ally, advantage_on_saving_throws) -- You enter a formation with 5 creatures of large size or smaller, that each are within 5 feet of the next. While in formation, all creatures 
- **Ether Pyre** (stat_buff_self) -- Ethereal blue flames flare up around you and cover your body. For the duration, gain 5+ to your AC, and water moves evaporate when they hit 
- **Feather Dance** (stat_debuff_enemy) -- You distract a creature in range with a beautiful dance. The target must make a WIS saving throw against your Move DC. On a fail, the target
- **Feint Attack** (advantage_on_attack_roll) -- You bring a creature close and hit it with a sucker punch. Make a melee attack on a creature, always with advantage, doing 1d10 + MOVE dark 
- **Fell Stinger** (potential_stat_increase) -- You lunge at a creature with a devastating sting attack. Make a melee attack on a creature, dealing 2d8 + MOVE bug damage on a hit. If this 
- **Fire Shield** (stat_buff_self) -- Thin, wispy flames dance around you, shedding bright light in a 10-foot radius and dim light for an additional 10 feet. The flames grant res
- **Flame Charge** (stat_buff_self) -- You cloak yourself with flame and lash out at a creature. Make a melee attack, dealing 1d10 + MOVE fire damage on a hit. With each successfu
- **Fly** (advantage_on_attack_roll) -- You fly high into the air to prepare for a dive bomb attack. When you activate this move, you flap your wings and disappear into the Etherea
- **Foresight** (stat_buff_self) -- You grant yourself a brief but incredible sixth sense. On the next ghost-, normal-, or fighting-type move you activate, ignore any immunitie
- **Gear Up** (stat_buff_ally, advantage_on_attack_roll) -- You engage your gears to raise the attack of ally creatures in range with the Plus or Minus ability. While you maintain your concentration, 
- **Grassy Terrain** (boosted_damage_rolls) -- Grass sprouts from the ground in a circle around you, coating the earth with healing energy. For 3 turns, all creatures in the affected area
- **Growl** (stat_debuff_enemy) -- You target a creature with an intimidating growl. The creature must make a WIS save against your Move DC. On a fail, it adds -1 to any attac
- **Hammer Arm** (stat_debuff_self) -- You put all your power into a strong and heavy fist attack. Make a melee attack, dealing 3d8 + MOVE fighting damage on a hit. Until the end 
- **Harden** (stat_buff_self) -- You increase your defense, able to reduce incoming damage. After activating this move, reduce any damage dealt to you by 1d4 + MOVE until th
- **Howl** (stat_buff_self, boosted_attack_rolls) -- You increase your adrenaline with a menacing howl. For the duration, add +1 to any attack roll you make. This move can be stacked for a maxi
- **Hyperspace Fury** (stat_buff_ally) -- You send a barrage of three balls of furious energy at any creature(s) in range. Each ball automatically deals 3d10 dark damage to any creat
- **Ice Hammer** (stat_debuff_enemy) -- You swing and hit with your strong, heavy fist. Make a melee attack dealing 2d8 + MOVE ice damage. Until the end of its next turn, the targe
- **Imperial Guard** (stat_buff_self) -- You set your mind to protect your allies and strike back against your enemies. A dark purple aura surrounds you. For the duration, every tim
- **Ink Veil** (stat_buff_self) -- You surround yourself with a cloud of glowing ink, protecting from any status conditions for the duration. If you a condition is inflicted o
- **Karate Chop** (crit_range_mod) -- You extend a hand towards a target creature for a savage karate chop. Make a melee attack roll, doing 1d6 + MOVE fighting damage on a hit. K
- **Kinesis** (stat_buff_self) -- You move with incredible speed. Increase your walking, flying, or swimming speed by 20 if it is greater than 0, and add +2 to AC when target
- **Leaf Blade** (crit_range_mod) -- You attempt to slash a creature with a sharp leaf. Make a melee attack against a target, dealing 2d8 + MOVE grass damage on a hit. This atta
- **Leaf Storm** (stat_debuff_self) -- You whip up a powerful storm of leaves in a 10 foot radius, centered on a point within range. All creatures in the area must make a DEX save
- **Limit Break** (crit_range_mod, advantage_on_attack_roll) -- Requires below 50% HP to activate. Make a melee attack dealing 4d12 + MOVE fighting damage. This attack has advantage and scores a critical 
- **Lock-On** (stat_buff_self) -- You hone in on your target, ready to strike. When this move is activated, a single attack roll you make next turn is guaranteed to hit. You 
- **Magnetic Flux** (stat_buff_ally) -- You use your electric energy to manipulate magnetic fields. Until the beginning of your next turn, any creature in range with the Plus or Mi
- **Mind Reader** (stat_buff_self) -- You sense the motives and moves of a creature around you. When this move is activated, a single attack roll you make next turn is guaranteed
- **Miracle Eye** (stat_debuff_enemy) -- You flash your eyes at the target, stunning them briefly and lowering their defenses. When activating this move, choose a target in range an
- **Nasty Plot** (stat_debuff_enemy, advantage_on_attack_roll) -- You stimulate your brain with nasty thoughts. For the duration, you have advantage on any attacks with the Wisdom move power. If the attack 
- **Odor Sleuth** (stat_debuff_enemy) -- When you activate this move, choose a target in range. For the duration, the target cannot activate any move that would increase its AC. If 
- **Omen Sense** (stat_debuff_enemy) -- You become highly alert, sensing incoming attacks and getting ready to respond to them. For one round, opponents have disadvantage on attack
- **Phantom Force** (advantage_on_attack_roll) -- You disappear from view and prepare to surprise your target with an attack. When you activate this move, you become invisible and immune to 
- **Play Nice** (potential_disadvantage) -- You convince a creature that you mean it no harm. Force a creature to make a CHA saving throw against your Move DC. On a failure, any attack
- **Power Split** (stat_buff_self) -- You use your psychic power to change your offense to match the target's the best you can. Force a creature in range to make a CHA save again
- **Power Trick** (stat_buff_self) -- You employ your psychic power to switch your own attack and defense. Until the end of your next turn, switch your AC with an ability score o
- **Power-Up Punch** (stat_buff_self) -- You strike out with a powerful punch that builds momentum. Make a melee attack, dealing 1d6 + MOVE fighting damage on hit. For each successf
- **Psychic Terrain** (boosted_damage_rolls) -- Psychic energy emerges from the ground in a 40ft, centered on you. Begininng at the end of your turn, for three rounds, all grounded creatur
- **Psycho Cut** (crit_range_mod) -- You tear at a target with blades formed by psychic power. Make a ranged attack on a creature, dealing 1d10 + MOVE psychic damage on a hit. T
- **Purgatory** (stat_debuff_enemy) -- You conjure a vortex of blue ethereal flames that superheats the air in a 10ft. radius, 40ft. high cylinder from a point within range. All c
- **Radiant Hope** (stat_buff_ally) -- You channel the energy of the morning sun to heal your allies. Each ally within range regains hp equal to 4d12 + MOVE. They also gain advant
- **Rage** (stat_buff_self) -- You go into a fit of rage, attacking with relentless fury. While you are raging, you gain +1 on all damage rolls (only once per move), have 
- **Razor Leaf** (crit_range_mod) -- You send a razor sharp leaf at a creature in range at tremendous speed. Make a ranged attack roll, doing 1d10 + MOVE grass damage on a hit. 
- **Roar of Time** (stat_buff_self) -- You unleash a roar that has the power to distort time. All creatures within range must make a WIS save against your Move DC, taking 10d12 + 
- **Royal Guard** (stat_buff_self, stat_buff_ally) -- A glowing barrier of hieroglyphic text surrounds you in a 15 foot radius, protecting you and any creatures within the barrier from damage an
- **Safeguard** (stat_buff_self, stat_buff_ally) -- You boost defenses for you and all allies in range. For the duration, any ally within range is protected from new negative status conditions
- **Sand Lance** (stat_debuff_enemy) -- You slam your reinforced horn through defenses. Make a melee attack dealing 3d10 + MOVE ground damage. This attack ignores resistance to Gro
- **Shadow Claw** (crit_range_mod) -- You strike with a sharp claw made from shadows in range. Make a ranged attack, dealing 1d10 + MOVE ghost damage on a hit. This moves scores 
- **Shadow Force** (advantage_on_attack_roll) -- You disappear from view and prepare to surprise a target with an attack. When you activate this move, you become invisible and immune to any
- **Shell Smash** (stat_buff_self, stat_debuff_self) -- You break off a piece of your shell, lowering your AC, but improving your attack. When you activate this move, lower your AC by 1, but incre
- **Shift Gear** (stat_buff_self) -- You rotate your gears quickly, raising your attack and speed. When you activate this move, add +1 to your attack and damage rolls, and +10 t
- **Silent Approach** (stat_buff_self) -- A ghostly darkness envelops you, hiding you, masking your scent and dampening the noise you make. For the duration, gain advantage on stealt
- **Sky Attack** (stat_debuff_enemy) -- When you use this move, you flap your wings menacingly and prepare to strike a creature within range. On your next turn’s action, if you kee
- **Slash** (crit_range_mod) -- You slash out at a creature in range. Make a melee attack, doing 2d8 + MOVE normal damage on a hit. Slash results in a critical hit on 19s a
- **Spirit Growth** (stat_buff_self) -- You channel a strong determination from deep within your mind. For the duration, all moves drawing on WIS for move power cost half their nor
- **Stockpile** (stat_buff_self) -- You use your action to store energy for a Spit Up or Swallow move, increasing your defense. Gain one point of Stockpile. Raise your AC by 1 
- **Study** (stat_buff_self, advantage_on_attack_roll) -- You study a target within 50 feet. For one minute, you have advantage on any ability checks or attack rolls against that target.
- **Surface Glide** (stat_buff_self) -- You channel water energy to boost your movement. Gain double speed on and in water. While this effect is active, you don't provoke attacks o
- **Sweet Scent** (advantage_on_attack_roll) -- You release a sweet smell directed at a target in range. The target must make a CHA save against your Move DC. On a fail, you have advantage
- **Tail Glow** (increase_stab) -- Your tail emits a flash of light, boosting your attack. For the duration, double your STAB damage.
- **Tailwind** (stat_buff_self, stat_buff_ally) -- You whip up a turbulent whirlwind that boosts the speed of you and all allies in a 30 foot circle, centered on you. The wind only follows yo
- **Thunderstorm Dance** (stat_buff_self) -- You perform a lightning fast dance, ionizing your body. For as long as you maintain concentration, all electric type moves are guaranteed to
- **Topsy-Turvy** (stat_debuff_enemy) -- You unleash a dark energy that has the power to reverse the stat changes of a creature. Force a creature in range to make a CHA save against
- **Twilight Rush** (advantage_on_attack_roll, stat_debuff_self) -- You go all out in a flurry of dark strikes, sacrificing your defenses. Make a melee attack on an opponent, dealing 3d10 + MOVE dark damage o
- **V-create** (stat_debuff_self) -- Your forehead burns like hot coals as you slam your head into a creature. Make a melee attack roll, dealing 4d12 + MOVE fire damage on a hit
- **Water Sport** (stat_buff_self, stat_buff_ally) -- You soak yourself and all allies with water, reducing the amount of fire damage taken for anyone affected. For the duration, you and any all
- **Wing Buffer** (stat_buff_self) -- You beat your wings at an incredible frequency, creating an air cushion that buffers damage towards you. Until your next turn. any successfu
- **Wing Command** (stat_buff_ally) -- You spread your wings in a majestic display, inspiring allies close by. All allies within range that can see you receive a bonus to their at

## 2. Needs a new effect kind / mechanism (149)

drain/heal_self/heal_target_or_aoe are essentially clear now (the `heal` kind, migrate_effects_v12/v13.py) -- what remains under those three tags below is each individually excluded for its own bundled/novel reason; see move-effects-schema.md's own note and migrate_effects_v13.py's module docstring.


### conditional_damage (25) -- damage that changes based on a condition (target HP, a status, terrain, ...)
- Archive Blast
- Bide
- Brine
- Cross Poison
- Crush Grip
- Electro Ball
- Facade
- Flail
- Formation Strike
- Frustration
- Gyro Ball
- Heavy Slam
- Hex
- Return
- Self-Destruct
- Smelling Salts
- Solar Beam
- Solar Blade
- Solvent Spray
- Spit Up
- Stored Power
- Trump Card
- Venoshock
- Water Spout
- Wring Out

### steal_disrupt (23) -- steals or disrupts an item/ability/stat the target has
- Clear Smog
- Covet
- Defog
- Electrify
- Entraintment
- Guard Swap
- Haze
- Heal Block
- Heart Swap
- Power Swap
- Psych Up
- Psychic Fangs
- Psycho Shift
- Role Play
- Searing Flame
- Simple Beam
- Skill Swap
- Snatch
- Spectral Surge
- Spectral Thief
- Speed Swap
- Strength Sap
- Thief

### protect_negate (21) -- blocks/negates an incoming effect (Protect-family)
- Astral Jet
- Captivate
- Crafty Shield
- Endure
- Feint
- Hover
- Hyperspace Hole
- King's Shield
- Lucky Chant
- Mat Block
- Mist
- Nature's Embrace
- Parry
- Phantom Tendril
- Protect
- Quick Guard
- Shield Dome
- Shield Guardian
- Spiky Shield
- Testudo Formation
- Wide Guard

### potential_damage_increase (13) -- damage that scales on a condition not yet modeled
- Avalanche
- Charge Beam
- Echoed Voice
- Eruption
- Fury Cutter
- Fusion Bolt
- Ice Ball
- Payback
- Power Trip
- Punishment
- Rollout
- Round
- Stomping Tantrum

### positioning (13) -- forces or requires specific battlefield positioning
- Block
- Circle Throw
- Fairy Lock
- Lava Cannon
- Magnetic Pulse
- Mean Look
- Pasta Portal
- Roar
- Spirit Shackle
- Strafe
- Strength
- U-turn
- Volt Switch

### field_terrain (12) -- sets/uses a terrain effect
- Convergence
- Electric Terrain
- Fissure
- Fortune Ring
- Ion Deluge
- Magic Room
- Misty Terrain
- Rototiller
- Shield Dome
- Spikes
- Trick Room
- Wonder Room

### heal_target_or_aoe (9) -- heals someone other than (or in addition to) the user
- Aromatherapy
- Cactus Bloom
- Harmony Breath
- Heal Bell
- Pollen Puff
- Present
- Purify
- Scrub Down
- Wish

### movement (9) -- forced or granted movement
- Ally Switch
- Ascension
- Extreme Speed
- Phase
- Quick Attack
- Retaliate
- Spectral Thief
- Splash
- Teleport

### attack_suppression (6) -- stops the target from attacking
- Disable
- Encore
- Imprison
- Oblivion Ink
- Throat Chop
- Torment

### lethal_faint (5) -- special behavior when the move would faint the target
- 10. Death Ray
- 9. Disintegration Ray
- Explosion
- Guillotine
- Horn Drill

### remove_item_on_target (5) -- removes/destroys the target's held item
- Covet
- Knock Off
- Switcheroo
- Thief
- Trick

### heal_self (5) -- heals the user
- Burning Glance
- Purify
- Refresh
- Strength Sap
- Swallow

### field_weather (5) -- sets/uses a weather effect
- Control Weather
- Hail
- Rain Dance
- Sandstorm
- Sunny Day

### drain (4) -- heals the user for a portion of damage dealt
- 5. Enervation Ray
- Energize
- Grudge
- Spite

## 3. "unknown" category, needs manual review before anything else (32)

- **After You** -- As a bonus action, choose an ally or opponent in range that has not yet taken its turn in the current round. The target must immediately tak
- **Assist** -- You call upon the help of another active Pokémon in your party. When activating this Move, another player may immediately take an action in 
- **Astral Shift** -- You project a duplicate image of yourself 5 feet beside you. The image copies every move you make. When an enemy hits you with an attack, ro
- **Black Hole** -- This move can only be activated after surviving Supernova. As a bonus action, an area in a 100ft square centered on you becomes shrouded in 
- **Breach in Time** -- You begin to focus your temporal energies. This requires concentration and uses your action and movement on each turn. After 10 rounds of co
- **Call of Ouroboros** -- While grounded, you recite the ancient vows of your sworn soldiers to the ground, calling forth a guard of Venomire to aid you. Roll 4d4, su
- **Call of the Underworld** -- While grounded, you recite the ancient vows of your sworn soldiers to the ground, calling forth a guard of Hadean to aid you. Roll 4d4, summ
- **Copycat** -- You mimic a target that acted just before you. When activating this move, you use the identical move of the creature whose turn came immedia
- **Cosmic Ward** -- You surround yourself with a protective aura, granting immunity from status conditions and resistance from one random damage type for 1 minu
- **Double Team** -- You create a duplicate image of yourself, 5 feet beside you. The image copies every move you make. When an enemy hits you with an attack, ro
- **Dream Mist** -- You reach into the Sea of Dreams to manifest something from the target's subconscious mind. This could be their greatest fear (dealing 10d12
- **Eye Rays** -- You unleash up to three eye rays. Roll a d6 to determine VP cost, and how many eye ray attacks you can perform. 1-2: One ray 3-4: Two rays 5
- **Instruct** -- You instruct a creature to act again. As an action, choose a target in range. The target must immediately repeat the move they used in their
- **Me First** -- When targeted by a move that isn't Fake Out or Sucker Punch, you may use your reaction to copy the target's move against it before it makes 
- **Metronome** -- You summon a move at random to inflict against a creature. When you use this move, roll a d100. The resulting number is the TM number for th
- **Mimic** -- You copy another creature's movements, learning its ways in battle. When used, this move is temporarily replaced by your choice of one of th
- **Murky Gaze** -- Your eyes light up with an eerie glow to attract the attention of all creatures within 50ft. that can see your eyes. Choose a direction to b
- **Nature Power** -- You call upon the powers of nature nearby and activate a move based on the terrain. The DM gets final say on what move you activate, but her
- **Parting Shot** -- You deliver a brutal parting threat. Force a creature in range to make a WIS save against your Move DC. On a failure, the targets nervousnes
- **Phantom Gate** -- You attempt to tear open a rift between the plane you currently inhabit, and the Depths of Twilight, creating a swirling portal of spectral 
- **Probability Storm** -- For 1 minute, all probability within the area becomes wildly unstable. Any time a creature rolls a d20 within the area, they must roll twice
- **Reality Shift** -- You attempt to manipulate the nature of ether energy in a target. Unless the target is willing, it must succeed a Wisdom saving throw agains
- **Record Keeper** -- You record one ability used by a creature within 30 feet during the last round.
- **Sketch** -- When any move is activated within sight of you, use a reaction to copy it to your move list, replacing it with one instance of Sketch in you
- **Sleep Talk** -- This move can only be used if you are asleep. While asleep, activate a random move from your move list (not Sleep Talk) that has a move time
- **Stellar Negation** -- When a Cosmic type move is activated within range, you may nullify all non-damaging effects from this and other Cosmic moves activated withi
- **Substitute** -- You create a duplicate of yourself that copies a quarter of your current HP (rounded down). This substitute moves with you, has an AC of 1 a
- **Swarm** -- You call for allies to aid you in battle. 1d4 + MOVE non-evolved Pokémon of the same species appear within a 20ft. radius. Your allies go af
- **Temporal Shift** -- You briefly alter the flow of time. Choose one creature within 60 feet. If the target is willing, it can immediately take an extra action. I
- **Transform** -- You attempt to morph into a near-exact copy of a creature in range. For the duration, you copy the target's type, ability scores, skills, sp
- **Void Consumption** -- Requires Reality Bend to be active. You attempt to pull in creatures in a 60ft. cone in front of you. All creatures within range must make a
- **Void Gate** -- You momentarily tear open a rift in space that creates a portal that lasts for 1 + MOVE rounds. First roll 1d4 to determine rift size. Then 

## 4. Pure mechanical shape -- correctly has no `effects`, nothing to do (217)

Plain damage / save-for-damage / multi-hit / recharge moves with no secondary effect to encode. Listed only so this file accounts for all remaining moves -- not a backlog.
