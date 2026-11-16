# Clear-to-Build Decision Board

A working prototype for a Material Planner: which builds won't be clear when they need to be, what's blocking them, how sure we are, and what our best move is today. Fictional scenario and synthetic data.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The interface (static, no build step) |
| `rules.js` | All decision logic: ETA, confidence, allocation, clear-to-build status, recommendations, ranking, dock-to-stock. Deterministic, no AI |
| `data.js` | Synthetic data and the 11 seeded scenarios |
| `config.js` | Set `WORKER_URL` to enable live AI email extraction |
| `tests/run-tests.js` | Scenario checks: `node tests/run-tests.js` |
| `worker/worker.js` | Cloudflare Worker that calls Claude to read supplier emails (key stays server-side) |

## View locally

Double-click `index.html`. Everything runs in the browser.

## Publish on GitHub Pages (about 5 minutes)

1. On github.com, create a new **public** repository, e.g. `clear-to-build`.
2. Click **Add file → Upload files** and drag in: `index.html`, `styles.css`, `app.js`, `rules.js`, `data.js`, `config.js` (optionally `README.md`, `tests/`). Do **not** upload anything containing an API key.
3. **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)` → Save.
4. After 1–2 minutes the site is live at `https://rojomba17.github.io/clear-to-build/`.
5. To update: upload the changed file(s) again; the site refreshes in about 1–2 minutes. Bump `VERSION` in `config.js` to confirm the new version is live (shown in the footer).

## Set up the AI Worker (about 10 minutes)

1. Anthropic console → create a new key just for this prototype (e.g., `anduril-case`). Confirm your spend limit.
2. Cloudflare dashboard → **Workers & Pages → Create → Worker** → name it `ctb-extract` → Deploy.
3. **Edit code** → replace everything with `worker/worker.js` → Deploy.
4. **Settings → Variables and Secrets**:
   - `ANTHROPIC_API_KEY` = your new key (type: **Secret**)
   - `ALLOWED_ORIGINS` = `https://rojomba17.github.io,null` (type: Text). Remove `,null` after local testing.
5. Copy the Worker URL (e.g., `https://ctb-extract.<you>.workers.dev`) into `config.js` → `WORKER_URL`, then re-upload `config.js`.
6. Test: Supplier updates tab → pick a sample → **Extract with AI**. The note under the button should say "Extracted live."

If the Worker is unavailable or the spend limit is reached, sample emails fall back to a clearly labeled cached extraction.
