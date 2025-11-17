// Trainer Card Component
import { PokemonAPI, TrainerAPI } from '../api.js';
import { showToast } from '../utils/notifications.js';

export class TrainerCard {
  constructor(data) {
    this.trainerData = data.trainerData;
    this.pokemonData = data.pokemonData;
  }

  render() {
    const [
      image, name, level, hitDice, vitalityDice,
      str, dex, con, int, wis, cha,
      hp, vp, ac, walkingSpeed, savingThrows, initiative, proficiency,
      skills, money, inventory, leaguePoints, pinCode,
      affinity, specialization, trainerPath, pokeslots,
      strMod, dexMod, conMod, intMod, wisMod, chaMod,
      feats, currentHP, currentVP, currentAC, gear, region, trainerClass
    ] = this.trainerData;

    return `
      <div class="trainer-card-full">
        <!-- Header -->
        <div class="trainer-header">
          <img src="${image}" alt="${name}" class="trainer-portrait"
               onerror="this.src='assets/default-trainer.png'">
          <div class="trainer-title">
            <h1>${name}</h1>
            <div class="trainer-badges">
              <span class="badge badge-level">Level ${level}</span>
              <span class="badge badge-class">${trainerClass || 'Pokemon Trainer'}</span>
              ${region ? `<span class="badge badge-region">${region}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Stats Grid -->
        <div class="stats-grid">
          <!-- Combat Stats -->
          <div class="stat-section">
            <h3>Combat Stats</h3>
            <div class="stat-group">
              <div class="stat editable" data-stat="HP">
                <label>HP</label>
                <input type="number"
                       value="${currentHP || hp}"
                       max="${hp}"
                       data-max="${hp}">
                <span class="stat-max">/ ${hp}</span>
              </div>
              <div class="stat editable" data-stat="VP">
                <label>VP</label>
                <input type="number"
                       value="${currentVP || vp}"
                       max="${vp}"
                       data-max="${vp}">
                <span class="stat-max">/ ${vp}</span>
              </div>
              <div class="stat editable" data-stat="AC">
                <label>AC</label>
                <input type="number" value="${currentAC || ac}">
              </div>
              <div class="stat">
                <label>Initiative</label>
                <strong>${this.formatModifier(initiative)}</strong>
              </div>
              <div class="stat">
                <label>Speed</label>
                <strong>${walkingSpeed} ft</strong>
              </div>
              <div class="stat">
                <label>Proficiency</label>
                <strong>+${proficiency}</strong>
              </div>
            </div>
          </div>

          <!-- Ability Scores -->
          <div class="stat-section">
            <h3>Ability Scores</h3>
            <div class="ability-scores">
              ${this.renderAbility('STR', str, strMod)}
              ${this.renderAbility('DEX', dex, dexMod)}
              ${this.renderAbility('CON', con, conMod)}
              ${this.renderAbility('INT', int, intMod)}
              ${this.renderAbility('WIS', wis, wisMod)}
              ${this.renderAbility('CHA', cha, chaMod)}
            </div>
          </div>

          <!-- Resources -->
          <div class="stat-section">
            <h3>Resources</h3>
            <div class="resource-group">
              <div class="resource">
                <label>💰 Money</label>
                <strong>${money || 0} ₽</strong>
              </div>
              <div class="resource">
                <label>🏆 League Points</label>
                <strong>${leaguePoints || 0}</strong>
              </div>
              <div class="resource">
                <label>🎒 Pokéslots</label>
                <strong>${pokeslots}</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- Features -->
        ${specialization || trainerPath || affinity ? `
          <div class="features-section">
            <h3>Features</h3>
            ${specialization ? `<div class="feature"><strong>Specialization:</strong> ${specialization}</div>` : ''}
            ${trainerPath ? `<div class="feature"><strong>Path:</strong> ${trainerPath}</div>` : ''}
            ${affinity ? `<div class="feature"><strong>Affinity:</strong> ${affinity}</div>` : ''}
          </div>
        ` : ''}

        <!-- Pokemon Party -->
        <div class="pokemon-section">
          <h3>Pokemon Party (${this.getActiveParty().length}/${pokeslots})</h3>
          <div class="pokemon-party">
            ${this.renderPokemonParty()}
          </div>
          ${this.getInactiveParty().length > 0 ? `
            <details class="inactive-pokemon">
              <summary>Inactive Pokemon (${this.getInactiveParty().length})</summary>
              <div class="pokemon-grid">
                ${this.renderInactivePokemon()}
              </div>
            </details>
          ` : ''}
        </div>

        <!-- Skills & Feats -->
        ${skills || feats ? `
          <div class="details-section">
            ${skills ? `
              <details>
                <summary>Skills</summary>
                <div class="skills-list">
                  ${skills.split(',').map(skill => `<span class="skill-badge">${skill.trim()}</span>`).join('')}
                </div>
              </details>
            ` : ''}
            ${feats ? `
              <details>
                <summary>Feats</summary>
                <div class="feats-list">
                  ${feats.split(',').map(feat => `<span class="feat-badge">${feat.trim()}</span>`).join('')}
                </div>
              </details>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  renderAbility(name, score, modifier) {
    return `
      <div class="ability">
        <div class="ability-name">${name}</div>
        <div class="ability-score">${score}</div>
        <div class="ability-modifier">${this.formatModifier(modifier)}</div>
      </div>
    `;
  }

  renderPokemonParty() {
    const activeParty = this.getActiveParty();

    if (activeParty.length === 0) {
      return '<div class="empty-state">No Pokemon in active party</div>';
    }

    return activeParty.map(pokemon => {
      const [
        trainername, image, name, dexentry, level,
        primarytype, secondarytype, ability, ac, hitdice, hp,
        vitalitydice, vp, speed, totalstats, str, dex, con, int, wis, cha,
        savingthrows, skills, startingmoves, level2moves, level6moves,
        level10moves, level14moves, level18moves, evolutionreq, initiative,
        proficiencybonus, nature, loyalty, stab, helditem, nickname,
        custommoves, inactiveparty, strmod, dexmod, conmod, intmod, wismod, chamod,
        currentHP, currentVP, currentAC
      ] = pokemon;

      return `
        <div class="pokemon-party-item" data-pokemon="${name}">
          <img src="${image}" alt="${name}"
               onerror="this.src='assets/default-pokemon.png'">
          <div class="pokemon-info">
            <strong>${nickname || name}</strong>
            <span class="pokemon-level">Lv. ${level}</span>
            <div class="pokemon-hp-bar">
              <div class="hp-fill" style="width: ${(currentHP || hp) / hp * 100}%"></div>
              <span class="hp-text">${currentHP || hp}/${hp}</span>
            </div>
          </div>
          <button class="btn-icon" data-action="view-pokemon">👁️</button>
        </div>
      `;
    }).join('');
  }

  renderInactivePokemon() {
    return this.getInactiveParty().map(pokemon => {
      const [, image, name, , level, , , , , , , , , , , , , , , , ,
        , , , , , , , , , , , , , , nickname
      ] = pokemon;

      return `
        <div class="pokemon-card-small" data-pokemon="${name}">
          <img src="${image}" alt="${name}">
          <span>${nickname || name}</span>
          <span class="level">Lv. ${level}</span>
          <button class="btn-small" data-action="add-to-party">Add to Party</button>
        </div>
      `;
    }).join('');
  }

  getActiveParty() {
    return this.pokemonData.filter(p => p[38]); // inactiveparty index
  }

  getInactiveParty() {
    return this.pokemonData.filter(p => !p[38]);
  }

  formatModifier(value) {
    const num = parseInt(value);
    return num >= 0 ? `+${num}` : `${num}`;
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  attachEventListeners() {
    // Editable stats
    document.querySelectorAll('.stat.editable input').forEach(input => {
      input.addEventListener('change', (e) => {
        this.handleStatChange(e.target);
      });
    });

    // Pokemon actions
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const pokemon = e.target.closest('[data-pokemon]')?.dataset.pokemon;

        switch(action) {
          case 'view-pokemon':
            this.viewPokemon(pokemon);
            break;
          case 'add-to-party':
            this.addToParty(pokemon);
            break;
        }
      });
    });
  }

  async handleStatChange(input) {
    const stat = input.closest('.stat').dataset.stat;
    const value = parseInt(input.value);
    const max = parseInt(input.dataset.max);

    // Validate
    if (max && value > max) {
      input.value = max;
      showToast(`${stat} cannot exceed ${max}`, 'warning');
      return;
    }

    if (value < 0) {
      input.value = 0;
      showToast(`${stat} cannot be negative`, 'warning');
      return;
    }

    // Update via API
    try {
      const trainerName = this.trainerData[1];
      await TrainerAPI.updateLiveStats(trainerName, stat, value);
      showToast(`${stat} updated to ${value}`, 'success');

      // Update visual feedback
      if (stat === 'HP' || stat === 'VP') {
        const fill = input.closest('.stat').querySelector('.hp-fill');
        if (fill) {
          fill.style.width = `${(value / max) * 100}%`;
        }
      }

    } catch (error) {
      showToast(`Failed to update ${stat}: ${error.message}`, 'error');
      // Revert value
      input.value = input.defaultValue;
    }
  }

  viewPokemon(pokemonName) {
    // Navigate to pokemon detail view
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { route: 'pokemon-detail', params: { name: pokemonName } }
    }));
  }

  async addToParty(pokemonName) {
    try {
      const trainerName = this.trainerData[1];
      const pokeslots = this.trainerData[26];

      await PokemonAPI.updatePartyStatus(trainerName, pokemonName, pokeslots, 'add');
      showToast(`${pokemonName} added to party!`, 'success');

      // Refresh the page
      location.reload();

    } catch (error) {
      showToast(`Failed to add to party: ${error.message}`, 'error');
    }
  }
}
