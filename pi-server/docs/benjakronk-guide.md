# Connecting to the Trainer Tool API

This replaces the old Google Apps Script backend with a server running on
Scorelax's Raspberry Pi. Two things changed: where the API lives, and how
you reach it. The write actions you already use (registering a pokemon for
a trainer, handing over loot) work exactly the same as before — same
`route`/`action` contract, same params — you're just pointing at a new URL
and you need to be on the shared network to reach it.

## 1. Join the Tailscale network

The Pi isn't reachable from the open internet — only from devices on its
Tailscale network (this is intentional, not a bug: it's how player devices
reach it too).

1. Install Tailscale: https://tailscale.com/download, sign in with a free
   account (any email works, no relation to Scorelax's).
2. Send Scorelax your Tailscale account/email so he can share the Pi's node
   with you from his admin console.
3. Once shared, the app is reachable at:

   ```
   https://scorelaxpi.tail32272d.ts.net/
   ```

   from any device signed into that Tailscale account.

## 2. The game-write API (unchanged)

Same GET contract as the old Apps Script deployment — `?route=...&action=...`
— just at the URL above instead of `script.google.com/...`. If you already
have code that registers a pokemon for a trainer or hands over items/gear/
money, point it at the new base URL and it should work as-is once you're on
the tailnet. No separate auth on these — reachability on the tailnet is the
only gate, same as before.

```
GET https://scorelaxpi.tail32272d.ts.net/api?route=pokemon&action=register&trainer=<name>&data=<url-encoded JSON>
GET https://scorelaxpi.tail32272d.ts.net/api?route=trainer&action=inventory&trainer=<name>&data=<url-encoded JSON>
GET https://scorelaxpi.tail32272d.ts.net/api?route=trainer&action=gear&trainer=<name>&data=<url-encoded JSON>
GET https://scorelaxpi.tail32272d.ts.net/api?route=trainer&action=money&trainer=<name>&amount=<int>
```

The `data` payload shapes (field order for a pokemon row, inventory/gear
JSON shape) are unchanged from what you were already sending — if you need
to double check the pokemon field order, it's `POKEMON_COLUMNS` in
[`app/db.py`](../app/db.py) in this repo, same order as the old sheet columns.

## 3. New: pushing the pokedex config in real time

This part is new. `pokedexConfig` (the `registered`/`visibility`/defaults
data — i.e. which species are currently visible to players) used to only
update on the Trainer Tool's side every 5 minutes via GitHub raw's CDN.
Now you can push it directly so the change is live immediately:

```
POST https://scorelaxpi.tail32272d.ts.net/api/upstream-push
Header: X-Push-Key: <secret Scorelax gives you>
Body (JSON): { "dataset": "pokedex-config", "data": <your config object> }
```

Example from a browser/admin-panel context:

```js
async function pushConfigToPi(config) {
    try {
        const res = await fetch('https://scorelaxpi.tail32272d.ts.net/api/upstream-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Push-Key': PI_PUSH_KEY },
            body: JSON.stringify({ dataset: 'pokedex-config', data: config })
        });
        if (!res.ok) throw new Error(`Pi returned ${res.status}`);
    } catch (e) {
        console.warn('Pi push failed (GitHub stays source of truth):', e);
    }
}
```

Your GitHub repo stays the source of truth — keep committing `pokedex_config.json`
as normal. This push is just a fast path so players don't wait on the CDN;
if it ever fails, the Trainer Tool catches up on its own next refresh.

## 4. What stays as-is (no action needed from you)

- **Species/move/item databases** — these barely change mid-session, so
  they're still pulled on a schedule (nightly + the app's own Reset Cache
  button), not pushed. Keep maintaining them wherever you already do.
- **Splash images** — still a nightly `git pull` mirror from your repo's
  `images/splashes` folder. Just commit as normal.

## Questions

Ping Scorelax directly — this is a two-person integration, not a public API.
