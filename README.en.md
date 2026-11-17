# CAESURA · The Epoch of Hush — English edition

> Chinese-language original at `README.md`. New player: see [`docs/PLAYER-GUIDE.md`](docs/PLAYER-GUIDE.md) (bilingual walkthrough). Console 51-dim is documented in `docs/ENCYCLOPEDIA.md`. Design pillars and all KI ledgers live in Chinese; this English mirror covers the same ground for collaborators who read it first.

## What it is

A Chinese MMORPG-grade action RPG — third-person, TypeScript + Three.js, deterministic at the data layer: every foe, item, region, quest, and line of dialogue ships in JSON and is validated before commit.

**CAESURA** is the story about a world whose bells stopped ringing. The player is the only one whose hands still hold a bell cord. The game is **not finished** and does not pretend to be; this is a working document of the build, not a polished pitch.

Play it on a developer machine:

```bash
npm install
npm run dev            # Vite dev server → http://localhost:5173/?fresh=1
```

`?fresh=1` wipes any existing save state on entry — leave in-game progress alone or pick a fresh boot for demos.

## Verify

```bash
npm run check          # tsc --noEmit + validate:data + full suite (6988 legs, 539 files, 0 reds)
npm test               # the suite, one green pass after another
npm run validate:data  # schema linter — current: 0 ERROR / 2 WARN (pre-registered)
npm run build          # tsc + vite build + dist text scan — 0 findings
```

**Live**: <https://xiaodernan.github.io/caesura/?fresh=1> (always rebuilds from `master`)  
- Tutorial: <https://xiaodernan.github.io/caesura/tutorial/> (bilingual · 9 steps · lives with the game) ·  
- Console: <https://xiaodernan.github.io/caesura/console/> (Wave 56 / Eight-Region Worldview panel) ·  
- **The Observatory (user analytics)**: <https://xiaodernan.github.io/caesura/admin/> (passphrase **123** · conversion funnel · retention cohorts · anomaly-day detection · exit & rage-click hotspots · 10 ranked moves derived from the data · bilingual · static seeded dataset + live local telemetry in localStorage · KI-583) ·  
- Cast Roster: <https://xiaodernan.github.io/caesura/cast/> (Cast roster — 15 roles · regions · NPCs · bosses · bilingual EN/zh)  
- World Codex: <https://xiaodernan.github.io/caesura/codex/> (74 real project texts · bilingual BM25 in-browser index · no network · no LLM · updated 2026-11-16)  
- "Salt" (original short story): <https://xiaodernan.github.io/caesura/story/> (Windbell Coast · the Listening Post · bilingual · zero LLM · added 2026-11-15)  
- "The Nameless Stone" (original short story, no. 2): <https://xiaodernan.github.io/caesura/story/unnamed-stone/> (Resthold · at the foot of the hill · bilingual · zero LLM · added 2026-11-15)  
- "The Empty Bar" (original short story, no. 3): <https://xiaodernan.github.io/caesura/story/empty-bar/> (Unfinished Hall · seventy-three years of rotation · Hersil · bilingual · zero LLM · added 2026-11-15)  
- "The Ledger" (original short story, no. 4): <https://xiaodernan.github.io/caesura/story/ledger/> (Resthold · the page Meg never dared to close · bilingual · zero LLM · added 2026-11-15)  
- "The Garden of Return" (original short story, no. 5): <https://xiaodernan.github.io/caesura/story/garden/> (The Afterland · the sixth sound · The Owner of the Old Bell · bilingual · zero LLM · added 2026-11-15)  
- "The Rain Tribunal" (original short story, no. 6): <https://xiaodernan.github.io/caesura/story/tribunal/> (The Afterland · the Rainbell Valley · The Drowning Jurist · seven years between sessions · bilingual · zero LLM · added 2026-11-15)  
- "The Aftermath" (complete short fiction, whole-volume portal — printable as one paper volume): <https://xiaodernan.github.io/caesura/story/anthology/> (all twenty-one stories · EPIC-VII draft now inside · updated 2026-11-17)  
- "The Frostbell" (original short story, no. 7): <https://xiaodernan.github.io/caesura/story/frostbell/> (The Frostbell Cliff · The Last Frostwright · the sound the ice kept · bilingual · zero LLM · added 2026-11-15)  
- "The Thousand Doors" (original short story, no. 8): <https://xiaodernan.github.io/caesura/story/doors/> (The Arcade of Echoes · the Gatekeeper of a Thousand Doors · bilingual · zero LLM · added 2026-11-15)  
- "The Stone-Throat" (original short story, no. 9): <https://xiaodernan.github.io/caesura/story/stonethroat/> (The City of Low Tones · The Stone-Throat Matriarch · the pitch that costs nothing · bilingual · zero LLM · added 2026-11-15)  
- "The First Bell" (original short story, no. 10 · the creation): <https://xiaodernan.github.io/caesura/story/first-bell/> (Before the Sounding · The Last Bell-Smith · the sound this world began with · bilingual · zero LLM · added 2026-11-15)  
- "The Dark Tide" (original short story, no. 11 · the Dark Forest): <https://xiaodernan.github.io/caesura/story/dark-tide/> (Windbell Coast · the Ninth Night-Keeper · cosmic sociology · bilingual · zero LLM · added 2026-11-16)  
- "Epilogue · The Twelfth Listener" (original short story, no. 12 · the coda): <https://xiaodernan.github.io/caesura/story/twelfth-listener/> (written for the one who got this far · three beats and a stop · bilingual · zero LLM · added 2026-11-16) 
- "The Bell-Picker" (original short story, no. 13 · what the bells left behind): <https://xiaodernan.github.io/caesura/story/bell-picker/> (the one who walked the eight reaches gathering the bells’ remains — left for the one who rings the fourth · bilingual · zero LLM · added 2026-11-16) 
- "The Lampwright" (original short story, no. 14 · the copper that remembers): <https://xiaodernan.github.io/caesura/story/lampwright-bell/> (the lampforge at the eastern end of Windbell Coast — the bells that were broken still remember · bilingual · zero LLM · added 2026-11-16)  
- "The City of Low Tones" (original short story, no. 15 · a debt paid in listening): <https://xiaodernan.github.io/caesura/story/lowtone-city/> (the Bass Citadel · the Stone-Throat Matriarch · a girl who owes the sea one E♭ · bilingual · zero LLM · added 2026-11-16)  
- "The Pendulum Ferryman" (original short story, no. 16 · swinging for time itself): <https://xiaodernan.github.io/caesura/story/pendulum-ferryman/> (the pendulum in the Unfinished Hall · the keeper who kept what every traveler set down · bilingual · zero LLM · added 2026-11-16)  
- "The Unfinished Ledger Page" (short fiction No.17): <https://xiaodernan.github.io/caesura/story/unfinished-ledger/> (The Unfinished Hall · the blank in the final line, waiting to be claimed · bilingual · zero LLM · 2026-11-17) ·  
- "The Fourth Strike" (short fiction No.18): <https://xiaodernan.github.io/caesura/story/fourth-strike/> (Windbell Coast · the clapper on the broken mast never struck · the fourth never needed a bell — it always lands in your own chest · bilingual · zero LLM · 2026-11-17) ·  
- "The Last String" (short fiction No.19): <https://xiaodernan.github.io/caesura/story/last-string/> (the North Cliff · the world was loud — a string on the north cliff found its own frequency · bilingual · zero LLM · 2026-11-17) ·  
- "The String-Listener" (short fiction No.20): <https://xiaodernan.github.io/caesura/story/string-listener/> (the North Cliff · The Unfinished Hall · the string asks who is listening — someone finally answers · bilingual · zero LLM · 2026-11-17) ·  
- "The Third Voice" (short fiction No.21): <https://xiaodernan.github.io/caesura/story/third-voice/> (the Windbell Coast · the night the lamp went out — the sea says, I hear too · bilingual · zero LLM · 2026-11-17) ·  
- Sync truth: `https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json`

## Where to read

| Doc | What it covers |
|---|---|
| `docs/production-plan.md`, `docs/WORKPLAN.md` | phase map, collaborator assignments, KI slots |
| `docs/KNOWN_ISSUES.md` | the canonical KI ledger; severity + status field for every open row |
| `docs/technical-architecture.md` | `§5.9.*` chapter map + `§M.` forward arcs; gaps are hot-checked |
| `docs/combat.md` · `docs/gameplay.md` · `docs/progression.md` · `docs/narrative.md` · `docs/ui-ux.md` | the design corpus |
| `docs/art-direction.md` · `docs/audio.md` | visuals / sound and how they cross-cue each other |
| `docs/WORLD-BIBLE.md` · `docs/BESTIARY.md` · `docs/lore/NEW-LANDS.md` · `docs/EPIC-V.md` · `docs/EPIC-VI.md` | the expanding fiction (all design-draft only — nothing here is playable yet beyond what `src/` already ships) |
| `docs/ENCYCLOPEDIA.md` | master index of the project (one page, every kit, every gate) |
| `docs/llm-cache-fix.md` | the F-lane LLM prefix-cache root-cause case study |
| `docs/llm-dialogue-qa.md` | how NPC voice lanes are audited (`npm run llm:qa`) |
| `docs/PLAYER-GUIDE.md` | the manual. How to actually play. |

## Repo layout

- `src/` — runtime. No content lives in code; JSON in `src/data/json/**`.
- `scripts/` — offline toolchains (`caesura-*.mjs`). Each teaching kit has: `.mjs` + `.d.mts` + unit tests + a `*:bench` script + a game-cloud opt-in + a mesh-e2e leg.
- `console/` — the mesh observatory: 104 panels / 51 dims (manifest-driven), 4 skins, full-screen immersion mode. `npm run console:data` rebuilds `snapshot.json` (the UI reads only that file, plus `bootstrap.js` for file:// boot).
- `tests/` — vitest suites. `npm test` is the full gate; `npm run check` runs tsc + validate:data + the suite.

## Building & running the console

```bash
npm run console:data   # rebuilds console/snapshot.json from a live probe
npm run build
```

Open `console/index.html` over `https://xiaodernan.github.io/caesura/` once CI ships the latest master.

## License & rule at the gate

- Player process: **zero LLM calls at runtime**. The `LLM` integration is strictly author tooling (`scripts/llm-*`, `npm run llm:*`). Setups that mutate `dialogue.json` through LLM output are refused.
- `dialogue.json` and NPC canon strings are **not rewritten or reordered without authorization**; new quests advance on pre-existing `advanceOn` flags or states.
- `npm run check` must remain green on push; CI enforces it on `master` as `check` + `spring-family-e2e`.

## Fifty-two KIs, shipping

Current state at master (run `npm run phase:status`): KI.rows=**481**, Implemented=**304**, Blocked=**10**, Placeholder=**0**. SYS.rows=**98**; ARCH.sections=**202** / 0 holes; PKG.scripts=**78**.

The ten blocked KIs are blocked by real human gates (e.g. hardware-eyebrow frames, physical playtesting), not by engineering capacity. See `docs/KNOWN_ISSUES.md` §"Blocks that need humans".
