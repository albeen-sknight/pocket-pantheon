# Pocket Pantheon

A tiny pixel world that lives on its own, until you decide it shouldn't. Pocket Pantheon is a browser god game: people are born, farm, pray and go to war, and you can step in with a blessing or a meteor whenever you like.

**Play it:** https://albeen-sknight.github.io/pocket-pantheon/

The game is still being built, one playable phase at a time. The full plan lives in [docs/PLAN.md](docs/PLAN.md), and the look we're aiming for is in [docs/preview.html](docs/preview.html).

## Run it locally

You need Node 20 or newer and Python 3.

```bash
npm install
npm run dev
```

Then open http://localhost:5173/.

| Command | What it does |
| --- | --- |
| `npm run dev` | Local server that rebuilds when you save |
| `npm run build` | Builds the site into `dist/` |
| `npm test` | Type check, text lint and unit tests |
| `npm run lint:text` | Checks every English and Spanish string |
| `npm run test:e2e` | Browser tests with Playwright (run `npx playwright install chromium` once first) |

Every push to `main` runs the tests and publishes the site to GitHub Pages.
