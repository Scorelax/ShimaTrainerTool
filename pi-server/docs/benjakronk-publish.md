# One-click publish for the Shima Pokedex admin panel

Right now, publishing a config change means: Export → download the JSON →
upload it on github.com → commit. This drop-in function replaces all of that
with one button, and also pushes the config straight to the Pi server so the
Trainer Tool sees changes in real time instead of after GitHub's 5-minute CDN
cache.

GitHub stays the source of truth — the pokedex keeps working exactly as
today. The Pi push is an extra, and a failure there never blocks the GitHub
publish.

## One-time setup

1. **GitHub token** (lets the admin panel commit for you):
   - github.com → Settings → Developer settings → Fine-grained personal
     access tokens → Generate new token
   - Repository access: **Only select repositories** → `shima-pokedex`
   - Permissions: **Contents → Read and write**. Nothing else.
   - Expiration: up to you (you'll paste a fresh one when it expires).
2. **Pi push key**: provided by Scorelax (the `CONFIG_PUSH_KEY` on the Pi).
3. Store both once from the browser console on the pokedex admin page:

   ```js
   localStorage.setItem('shima_github_token', 'github_pat_...');
   localStorage.setItem('shima_pi_push_key', '...');
   ```

   They stay in that browser's localStorage — nothing goes into the repo.

## The code

Add to `script.js`:

```js
const PI_CONFIG_URL = 'https://scorelaxpi.tail32272d.ts.net/api/pokedex-config';
const GITHUB_CONTENTS_URL = 'https://api.github.com/repos/Benjakronk/shima-pokedex/contents/pokedex_config.json';

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

    // Fast path for the Trainer Tool on the Pi. Best-effort: if the Pi is
    // unreachable it catches up from GitHub on its next refresh anyway.
    const piKey = localStorage.getItem('shima_pi_push_key');
    if (piKey) {
        try {
            const pi = await fetch(PI_CONFIG_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Push-Key': piKey },
                body
            });
            if (!pi.ok) throw new Error(`Pi returned ${pi.status}`);
            console.log('Config pushed to Pi');
        } catch (e) {
            console.warn('Pi push failed (GitHub publish still OK):', e);
        }
    }
}
```

And a button next to Export/Import in `index.html`:

```html
<button class="btn btn-primary" onclick="publishConfig()">🚀 Publish</button>
```

## Notes

- The Pi push only works from a device that's on the shared Tailscale
  network (same as using the Trainer Tool).
- Word of warning about the existing workflow: the admin panel's `loadConfig()`
  always overwrites local edits with GitHub's copy on page reload — unpublished
  changes are lost. Publishing right after editing (now one click) closes that
  gap.
