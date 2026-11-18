# Bible School Study Buddy

Mobile-first Next.js quiz app for Acts, Path to Righteousness, Family Life, and Memory Verses.

Questions live in `src/data/questions.json`. The app shuffles each course deck, loops endlessly, and brings missed questions back sooner. Progress is saved per course in `localStorage` so reloads and tab switches resume where you left off. End-of-pass summaries let you drill misses or start the next pass.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Tap the bottom tabs anytime to switch courses. Use **Reset progress** under the course title to clear the current course’s saved state.

### Dev origins (LAN / phone testing)

When you open the app from another device on your network, set `DEV_ORIGINS` to a comma-separated list of allowed origins (hostnames or IPs without protocol):

```bash
# .env.local
DEV_ORIGINS=192.168.1.20,my-laptop.local
```

Then restart `npm run dev`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server on all interfaces |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests (answer matching) |
| `npm run audit:questions` | Report MC longest-answer bias and T/F balance |

## Studying features

- **Saved progress** — deck order, index, pass, stats, and per-question miss history persist per course
- **Weighted reshuffles** — questions missed more often tend to appear earlier on the next pass
- **Memory Verses** — built from questions tagged `"memory-verse"` in `questions.json`
- **Keyboard** — on desktop, `1–4` / `A–D` pick choices, `T`/`F` for true/false, `Enter` advances after answering (ignored while typing)
- **Dark mode** — follows `prefers-color-scheme` with the same green/paper palette
- **Install** — on a phone, use the browser “Add to Home Screen” option for a standalone icon; progress still lives in that browser’s `localStorage`

## Content notes

Question types: multiple choice, true/false, fill-in-the-blank, and short answer. Optional `tags` on questions and `shortTitle` on courses drive the Verses course and tab labels.
