# One-click publish for the Shima Pokedex admin panel

Right now, publishing a config change means: Export → download the JSON →
upload it on github.com → commit. This drop-in function replaces all of that
with one button, and also pushes straight to the Pi server so the Trainer
Tool sees changes in real time instead of after GitHub's 5-minute CDN cache
(or waiting on your own script's schedule, for the pokemon/moves/items data).

Your GitHub repo / sheet stays the source of truth — the pokedex keeps
working exactly as today. The Pi push is an extra, and a failure there never
blocks your normal publish.

## What can be pushed

| Dataset | What it is |
|---|---|
| `pokedex-config` | The shared player-visible pokedex — `registered` list, `visibility`, defaults |
| `pokemon-db` | The full species database (stats, types, moves, abilities, senses, etc.) |
| `moves` | The move database |
| `items` | The item database |

Each one keeps the exact shape you already produce for the Trainer Tool's
existing pull requests — you're not inventing a new format, just sending the
same payload proactively instead of waiting to be fetched.

## One-time setup

1. **GitHub token** (lets the admin panel commit for you, unrelated to the
   Pi push):
   - github.com → Settings → Developer settings → Fine-grained personal
     access tokens → Generate new token
   - Repository access: **Only select repositories** → `shima-pokedex`
   - Permissions: **Contents → Read and write**. Nothing else.
   - Expiration: up to you (you'll paste a fresh one when it expires).
2. **Pi push key**: provided by Scorelax (the `UPSTREAM_PUSH_KEY` on the Pi).
3. Store both once from the browser console on the pokedex admin page:

   ```js
   localStorage.setItem('shima_github_token', 'github_pat_...');
   localStorage.setItem('shima_pi_push_key', '...');
   ```

   They stay in that browser's localStorage — nothing goes into the repo.

## The code

Add to `script.js`:

```js
const PI_PUSH_URL = 'https://scorelaxpi.tail32272d.ts.net/api/upstream-push';
const GITHUB_CONTENTS_URL = 'https://api.github.com/repos/Benjakronk/shima-pokedex/contents/pokedex_config.json';

// Best-effort fast path to the Pi. Never blocks your normal GitHub publish --
// if the Pi is unreachable it catches up on its own next scheduled refresh.
async function pushToPi(dataset, data) {
    const piKey = localStorage.getItem('shima_pi_push_key');
    if (!piKey) return;
    try {
        const res = await fetch(PI_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Push-Key': piKey },
            body: JSON.stringify({ dataset, data })
        });
        if (!res.ok) throw new Error(`Pi returned ${res.status}`);
        console.log(`Pushed ${dataset} to Pi`);
    } catch (e) {
        console.warn(`Pi push failed for ${dataset} (source of truth still OK):`, e);
    }
}

async function publishConfig() {
    const token = localStorage.getItem('shima_github_token');
    if (!token) {
        showToast('No GitHub token set — see publish setup notes', 'error');
        return;
    }

    const body = JSON.stringify(state.config, null, 2);

    try {
        // Current file SHA is required by the GitHub API to update a file
        const current = await fetch(GITHUB_CONTENTS_URL, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!current.ok) throw new Error(`GitHub read failed: ${current.status}`);
        const { sha } = await current.json();

        const commit = await fetch(GITHUB_CONTENTS_URL, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Update pokedex_config.json (admin panel publish)',
                content: btoa(unescape(encodeURIComponent(body))),
                sha
            })
        });
        if (!commit.ok) throw new Error(`GitHub commit failed: ${commit.status}`);
        showToast('Published to GitHub!', 'success');
    } catch (e) {
        console.error('Publish failed:', e);
        showToast('Publish to GitHub FAILED — changes are only local!', 'error');
        return;
    }

    pushToPi('pokedex-config', state.config);
}
```

And a button next to Export/Import in `index.html`:

```html
<button class="btn btn-primary" onclick="publishConfig()">🚀 Publish</button>
```

### Pushing the other three datasets

Wherever your admin panel already saves the species / move / item database
(to your sheet or repo), call `pushToPi` the same way, with the same payload
shape the Trainer Tool already pulls today:

```js
pushToPi('pokemon-db', pokemonRows);   // same rows your pokemon endpoint returns
pushToPi('moves', moveRows);           // same rows your moves endpoint returns
pushToPi('items', { status: 'success', items: itemList });
```

## Notes

- The Pi push only works from a device that's on the shared Tailscale
  network (same as using the Trainer Tool).
- Word of warning about the existing workflow: the admin panel's `loadConfig()`
  always overwrites local edits with GitHub's copy on page reload — unpublished
  changes are lost. Publishing right after editing (now one click) closes that
  gap.
