// EXAMPLE: Google Apps Script converted to API format
// This replaces your current doGet() function

// ============================================================================
// MAIN API ROUTER
// ============================================================================

function doGet(e) {
  // Enable CORS for GitHub Pages to access this API
  const params = e.parameter;

  try {
    const route = params.route || 'error';
    const action = params.action || 'list';

    let result;

    // Route to appropriate handler
    switch(route) {
      case 'pokemon':
        result = handlePokemonRoute(action, params);
        break;

      case 'trainer':
        result = handleTrainerRoute(action, params);
        break;

      case 'game-data':
        result = handleGameDataRoute(action, params);
        break;

      case 'battle':
        result = handleBattleRoute(action, params);
        break;

      default:
        result = { error: 'Unknown route: ' + route, status: 'error' };
    }

    // Return JSON response with CORS headers
    return createJsonResponse(result);

  } catch (error) {
    Logger.log('API Error: ' + error.toString());
    return createJsonResponse({
      error: error.toString(),
      status: 'error'
    });
  }
}

// Helper to create JSON response with CORS
function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);

  // CORS headers - allows your GitHub Pages site to call this API
  // Replace '*' with your actual GitHub Pages URL for security
  // e.g., 'https://yourusername.github.io'
  return output;
}

// ============================================================================
// POKEMON ROUTES
// ============================================================================

function handlePokemonRoute(action, params) {
  switch(action) {
    case 'list':
      // GET: ?route=pokemon&action=list
      return {
        status: 'success',
        data: getCompletePokemonData()
      };

    case 'registered-list':
      // GET: ?route=pokemon&action=registered-list
      return {
        status: 'success',
        data: getRegisteredPokemonList().data
      };

    case 'get':
      // GET: ?route=pokemon&action=get&trainer=Ash&name=Pikachu
      if (!params.trainer || !params.name) {
        throw new Error('Missing trainer or pokemon name');
      }
      return {
        status: 'success',
        data: getPokemonInfo(params.trainer, params.name)
      };

    case 'register':
      // GET: ?route=pokemon&action=register&trainer=Ash&data={...}
      if (!params.trainer || !params.data) {
        throw new Error('Missing trainer or pokemon data');
      }
      const pokemonData = JSON.parse(params.data);
      return registerPokemonForTrainer(params.trainer, pokemonData);

    case 'update':
      // GET: ?route=pokemon&action=update&data={...}
      if (!params.data) {
        throw new Error('Missing pokemon data');
      }
      const updateData = JSON.parse(params.data);
      return updatePokemonDataInSheet(updateData);

    case 'evolution-options':
      // GET: ?route=pokemon&action=evolution-options&dexEntry=25&limit=20
      const dexEntry = parseInt(params.dexEntry);
      const limit = parseInt(params.limit || 20);
      return getEvolutionOptions(dexEntry, limit);

    case 'party-status':
      // GET: ?route=pokemon&action=party-status&trainer=Ash&pokemon=Pikachu&pokeslots=6&operation=add
      return updateActivePartyStatus(
        params.trainer,
        params.pokemon,
        parseInt(params.pokeslots),
        params.operation
      );

    case 'utility-slot':
      // GET: ?route=pokemon&action=utility-slot&trainer=Ash&pokemon=Pidgey&operation=add
      return updateUtilitySlotStatus(params.trainer, params.pokemon, params.operation);

    case 'live-stats':
      // GET: ?route=pokemon&action=live-stats&trainer=Ash&pokemon=Pikachu&stat=HP&value=35
      return writePokemonLiveStats(
        params.trainer,
        params.pokemon,
        params.stat,
        parseInt(params.value)
      );

    default:
      throw new Error('Unknown pokemon action: ' + action);
  }
}

// ============================================================================
// TRAINER ROUTES
// ============================================================================

function handleTrainerRoute(action, params) {
  switch(action) {
    case 'list':
      // GET: ?route=trainer&action=list
      return {
        status: 'success',
        data: getTrainers()
      };

    case 'get':
      // GET: ?route=trainer&action=get&name=Ash
      if (!params.name) {
        throw new Error('Missing trainer name');
      }
      return {
        status: 'success',
        data: storeTrainerAndPokemonData(params.name)
      };

    case 'create':
      // GET: ?route=trainer&action=create&data={...}
      if (!params.data) {
        throw new Error('Missing trainer data');
      }
      const trainerData = JSON.parse(params.data);
      return createTrainer(trainerData);

    case 'update':
      // GET: ?route=trainer&action=update&data={...}
      if (!params.data) {
        throw new Error('Missing trainer data');
      }
      const updateData = JSON.parse(params.data);
      return updateTrainerDataInSheet(updateData);

    case 'live-stats':
      // GET: ?route=trainer&action=live-stats&trainer=Ash&stat=HP&value=42
      return writeTrainerLiveStats(
        params.trainer,
        params.stat,
        parseInt(params.value)
      );

    case 'inventory':
      // GET: ?route=trainer&action=inventory&trainer=Ash&data={...}
      return writeItems(params.trainer, params.data);

    case 'gear':
      // GET: ?route=trainer&action=gear&trainer=Ash&data={...}
      return writeTrainerGear(params.trainer, params.data);

    case 'money':
      // GET: ?route=trainer&action=money&trainer=Ash&amount=5000
      return writeMoney(params.trainer, parseInt(params.amount));

    default:
      throw new Error('Unknown trainer action: ' + action);
  }
}

// ============================================================================
// GAME DATA ROUTES
// ============================================================================

function handleGameDataRoute(action, params) {
  switch(action) {
    case 'all':
      // GET: ?route=game-data&action=all
      return {
        status: 'success',
        data: loadAllGameData()
      };

    case 'conduit':
      // GET: ?route=game-data&action=conduit
      return {
        status: 'success',
        data: loadAllConduitGameData()
      };

    case 'moves':
      // GET: ?route=game-data&action=moves
      return {
        status: 'success',
        data: fetchMoveData()
      };

    case 'natures':
      // GET: ?route=game-data&action=natures
      return {
        status: 'success',
        data: getNatureData()
      };

    case 'type-effectiveness':
      // GET: ?route=game-data&action=type-effectiveness&type1=Fire&type2=Flying
      return {
        status: 'success',
        data: calculateTypeEffectiveness(params.type1, params.type2)
      };

    default:
      throw new Error('Unknown game-data action: ' + action);
  }
}

// ============================================================================
// BATTLE ROUTES (Future functionality)
// ============================================================================

function handleBattleRoute(action, params) {
  switch(action) {
    case 'calculate-damage':
      // Future: damage calculation
      return { status: 'not_implemented' };

    case 'roll-initiative':
      // Future: initiative rolling
      return { status: 'not_implemented' };

    default:
      throw new Error('Unknown battle action: ' + action);
  }
}

// ============================================================================
// TESTING ENDPOINT
// ============================================================================

// Test with: ?route=test
function handleTestRoute() {
  return {
    status: 'success',
    message: 'API is working!',
    timestamp: new Date().toISOString(),
    endpoints: {
      pokemon: ['list', 'get', 'register', 'update', 'evolution-options'],
      trainer: ['list', 'get', 'create', 'update', 'inventory'],
      gameData: ['all', 'conduit', 'moves', 'natures', 'type-effectiveness']
    }
  };
}

// Add to main router:
// case 'test':
//   result = handleTestRoute();
//   break;

/*
DEPLOYMENT INSTRUCTIONS:

1. In Google Apps Script editor, click "Deploy" > "New deployment"
2. Type: "Web app"
3. Description: "Pokemon DnD API v1"
4. Execute as: "Me"
5. Who has access: "Anyone" (for public tool) or "Anyone with Google account"
6. Click "Deploy"
7. Copy the Web app URL - this is your API_BASE for the frontend

Example URL: https://script.google.com/macros/s/AKfycby.../exec

TEST YOUR API:
Open this URL in browser:
https://YOUR_DEPLOYMENT_URL/exec?route=test

You should see JSON response.
*/
