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
npm run check          # tsc --noEmit + validate:data + full suite (6885 legs, 523 files, 0 reds)
npm test               # the suite, one green pass after another
npm run validate:data  # schema linter — current: 0 ERROR / 2 WARN (pre-registered)
npm run build          # tsc + vite build + dist text scan — 0 findings
```

**Live**: <https://xiaodernan.github.io/caesura/?fresh=1> (always rebuilds from `master`)  
- Tutorial: <https://xiaodernan.github.io/caesura/tutorial/> (bilingual · 8 steps · lives with the game) ·  
- Console: <https://xiaodernan.github.io/caesura/console/> (Wave 56 / Eight-Region Worldview panel) ·  
- Cast Roster: <https://xiaodernan.github.io/caesura/cast/> (Cast roster — 15 roles · regions · NPCs · bosses · bilingual EN/zh)  
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
