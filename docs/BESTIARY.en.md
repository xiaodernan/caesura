# CAESURA Bestiary — Enemy Codex (BESTIARY · 2026-11-15 · design record only, runtime untouched)

> This volume is a complete audit of the ten monsters of CAESURA — a line-by-line verification against `src/data/json/enemies.json`, with a pause written for every enemy shade.
> The same discipline as `docs/WORLD-BIBLE.md`: **record only, never rewrite**. It does not replace the curated data and rewrites no fields; every HP/POISE/AI/attacks/weakpoint number comes from that data file.
> Names match `src/combat/CombatManager.ts#NAME_MAP`; where no English counterpart exists, only the nameKey is used.

---

## 0 · Full-Spectrum Quickview

| id | Name (NAME_MAP) | archetype | HP | POISE | Speed | Weakness multiplier | Tactical core count |
|---|---|---|---|---|---|---|---|
| `en_murkshell` | Murkshell | basic | 45 | 20 | 3.0 | ×1.8 | 2 |
| `en_driftsinger` | Driftsinger | ranged | 70 | 26 | 3.6 | — | 3 |
| `en_tympanus` | Tympanus | heavy | 240 | 90 | 1.8 | ×1.5 | 2 |
| `en_skewer` | Skewer | ranged | 55 | 22 | 2.4 | ×1.6 | 3 |
| `en_refrein` | Refrein | support | 65 | 30 | 2.0 | — | 1 |
| `en_phantome` | Phantome | assassin | 80 | 24 | 4.2 | — | 3 |
| `en_hanged_knight` | The Hanged Knight | elite | 320 | 80 | 2.6 | ×1.5 | 3 |
| `en_ostlara` | Ostlara, the Hanged Knight | miniboss | 420 | 120 | 2.4 | ×1.5 | 6 + the bell set |
| `en_hersil` | The Beatless Chief — Hersil Vaanlay | boss | 620 | 160 | 2.2 | ×1.5 | 8 + three phases |
| `en_myriad` | The Myriad | boss | 380 | 140 | 3.2 | ×1.5 | 2 + sound hunt (`huntsSound`) |

> The "bell" and the "chime" in this codex share their root with the "Sunken Bell" and the "Ringing Chime" of the main world: the root tone of the ten enemy shades awaits the strike of the gong, and most of them hang on the ♭ register — Tympanus / The Hanged Knight / The Myriad lean low; Murkshell / Skewer lean high.

---

## 1 · Batch (basic)

### Murkshell `en_murkshell` (→ `enemy.murkshell`)
- **Stats**: HP 45 / POISE 20 / speed 3.0; fissure ×2 (`fissureMul=2`), weakness **×1.8** (the highest in the whole codex).
- **AI**: sight range 12 / FOV 80° / hearing range 15 / below 20% HP it falls back; out-of-sight callAlly broadcast (14 tiles, 36 ticks).
- **Moves**: basicBite (R1, 24f startup · cone 60°, dmg 7 + status.fissure 1 stack · parryable) / Shellburst (R2, 30f, rng 2.2 ring · dmg 10, poise 10 · loudness 4 · parryable).
- **Tactics**: land 2 hits on the weakpoint and it opens up (×1.8 → POISE breaks in a blink); when status.fissure stacks to two layers it actively flees → the chase has to be fast.
- **Field annotation**: Murkshell is the stripped-down edition of "the bell that stopped inside its shell" — it is just that no one ever gets around to it; within a few dozen minutes in the Central Plains its throat starts up on its own.

---

## 2 · Archers / Shooters (ranged)

### Driftsinger `en_driftsinger` (→ `enemy.driftsinger`)
- **Stats**: HP 70 / POISE 26 / speed 3.6; no weakness multiplier.
- **AI**: sight range 22 / FOV 100° / callAlly when out of sight; retreatHpFrac 0.25.
- **Moves**: Claw1/2/3 (melee cone, R1/R1/R2) / Scream (zero damage, loudness 9 · parryable=false — **a disruptor**) / **Shrill** (R1, 40f startup · projectile note, speed 13, range 20 · dmg 12 · parryable) · vfx `ring_echo`.
- **Tactics**: cut the mournhowl (Scream) first — otherwise it and its allies beat one single note in unison; Shrill travels in a straight line, jumpable; a parried Shrill makes it stall and open itself to a counter.
- **Field annotation**: The Driftsinger's throat makes no sound; what sounds is the small bell in its chest that shattered long ago — it hears you for you, on your behalf, and that is your first weariness.

### Skewer `en_skewer` (→ `enemy.skewer`)
- **Stats**: HP 55 / POISE 22 / speed 2.4; weakness **×1.6**.
- **AI**: sight range 30 / hearing range 20 / kite 18 · chaseBeyond 26; retreatHpFrac 0.3 — **one of the longest sight ranges in the codex**.
- **Moves**: Snipe (R1, 48f startup · projectile shard, speed 18 · telegraph+vfx ring_echo · blockable) / **Tri-Shot** (R1, double Feint `feint shot:1 punishMs=600`, the mid false-star bait · vfx spike_chord) / Stab (R3, cone 110°, can interrupt its charge-up) / Tri-snare (burst at [0,32,42]).
- **Tactics**: use the gaps between its phrasing segments to close in (kite 18 is its soul line; get inside the cone and it is finished); before Tri-Shot's fx lands, **dodge first, then parry** — the third shot is the real damage, the second shot is the trap.
- **Field annotation**: Its voice is not its own — before the bowstring is drawn it has already heard the single instant your skin is scratched, and that instant is your life.

---

## 3 · Heavy / Elite / Support

### Tympanus `en_tympanus` (→ `enemy.tympanus`)
- **Stats**: HP 240 / POISE 90 / speed 1.8 / DEF 20; weakness **×1.5**.
- **AI**: sight range 18 / hearing range 14 / callAlly(16, 48t); signature mechanic `drumSurfaceHits=4` + `drumMuteRadius=6` — **after 4 drum hits it goes silent, entering a kind of "silence that does not drum"**.
- **Moves**: Mallet (R3 · cone 110° radius 3.4 · dmg 34) / **Stomp** (= ring. `ratelimit`; dmg 20 · mute 240t status.mute · worldShake:stomp).
- **Tactics**: near 2.5 no retreat → a direct attack is fastest (POISE 90 will not break in 4 hits); whether to dodge the circle or hit through it when the mute lands depends on whether you have `status.mute` resist.
- **Field annotation**: Tympanus is the earliest bell that would not sing — it simply believed that singing is idling, so it drums.

### Refrein `en_refrein` (→ `enemy.refrein`)
- **Stats**: HP 65 / POISE 30 / speed 2.0; no weakness multiplier; **support aura**: +15% atkSpeed / +10% dmg (radius 12).
- **AI**: `buffAura band`; castBearSense silence; on death it triggers `offTuneOnDeath` — all aggro reverts to default silence Lv0 + 90 tick stun.
- **Moves**: Noise (R1, 36f → moving wave · muteOnHit 120 tick · projectile note · speed 20).
- **Tactics**: **kill it first.** A Refrein alive for one more second is a party-wide variable worth an extra 15% damage; killing it collapses the whole party by 1 phase.
- **Field annotation**: Refrein teaches you to sing. It does not want to hurt you; it only wants you to forget something... so we came.

### Phantome `en_phantome` (→ `enemy.phantome`)
- **Stats**: HP 80 / POISE 24 / speed 4.2; no weakness multiplier; **beatGhost**: dodge i-frame window 12 ticks / reveal 60t / fakeBeat 180t loudness 0.6.
- **AI**: FOV 110° / hearing range 18; beatGhost mechanic = **alternating true and false notes** — it strikes both windows at once (true = now, false = 180t later), extremely easy to misread.
- **Moves**: BackCut (R2 · within ±0.5 beat of the grid · cone 100° dmg 22 · status.mute 240t) / Synco1 (R1 ring · interrupt) / Synco2 (R2 ring · parryable=false) · samples [1.5,2.5,3.5,4.5] off the half-beat.
- **Tactics**: the screen-pull `pulseWatch` first screen = its real-deal first strike; the final boss always appears paired with it (the "Phantome ×8 + the stacked chorus" three-piece set) — **screen-pull `phantomHUD` → disable auto lock-on**.
- **Field annotation**: The name Phantome is a string of numbers, and you cannot count past the ninth.

### The Hanged Knight `en_hanged_knight` (→ `enemy.hangedKnight`)
- **Stats**: HP 320 / POISE 80 / speed 2.6 / DEF 24; frontal `armorFront` 60° ×0.6; **selfToll**: every 4 bars it recovers 15 HP ("self-ash"); weakness **×1.5**.
- **AI**: sight range 22 / hearing range 16 / callAlly 25.
- **Moves**: bellSwing1 (R2 · cone 100° → bellSwing2 chain, R3 parryStun 120t) / Sway (R3 · ring, outer 3 · not parryable) / **Toll** (every 4 bars it must sound once: `beatLossOnDeath pauseBars=1`; healing / chime) / tactical objective: **break combo on Toll turn**.
- **Field annotation**: Every plate of the Hanged Knight's armor is a small bell — when struck, what you hear is not Death; it is the sound of something about to smash into you.

### Ostlara, the Hanged Knight `en_ostlara` (→ `enemy.ostlara`) · miniboss ★
- **Stats**: HP 420 / POISE 120 / speed 2.4 / DEF 30; weakness **×1.5**.
- **Three phases**: `bellshell` (shield: shell, `dh×0.1` damage taken, immuneToPoise, fissure×2 — **the front shell cannot be broken by POISE damage; swap to heavy fire / cleave the shell points**) → `twinfugue` (<60%: `barCast every 2 bars phrase attackId=phrase` · phrase deals zero damage but interrupts) → `greatbell` (<25%: Pendulum + Bellsmash 36dmg+bands (2.5 dmg36 / 5 dmg20)).
- **The bell set**: three bells `{270,-40,90}, {330,-40,90}, {300,-40,140}` · `hitRadius 3.6` · `breaksAt 2` (**break 2 bells → the shell layer's `whole-phase` disappears entirely**).
- **Tactics**: early phase shell → later, prioritize finding the second bell to break the shell; pendulum rings can be parried from inside; greatbell phase, listen to the rhythm (108bpm 3/4); on Bellsmash, a fulex-quick withdrawal away from the shellcast.
- **Field annotation**: He was sentenced to "you are the very swing you yourself struck" — the verdict was written on his armor long ago.

### The Beatless Chief — Hersil Vaanlay `en_hersil` (→ `enemy.hersil`) · boss ★★
- **Stats**: HP 620 / POISE 160 / speed 2.2 / DEF 40; FOV 360°; weakness **×1.5**.
- **Three phases**: `registr` → `stealthebeat` (<60%: BPM drift ±10%, re-drift 90t · staRegenMul .75 · dodgeJitterTicks 4 · reclaim: neutralTicks 480 → overdrive 2 × hitStop 180) → `finale` (<25%: ×1.25 BPM @120 · startupMul .8 · interruptOnHit).
- **Moves**: Bar Sweep (R3 · cone 90° radius 6) / Notes3 (R1 3-note wave, parryable) / Tutti (R4 · parryStun 180t · mute 2 stacks 360t) / **No-Beat Lunge** (×3 chain: off-beat positions R2,R2,R3, nonGrid lunge 4.2,4.2,3) / Voice Chain / Breath (`reclaimWindow` · 8 bars barCast).
- **Cover**: 4 covering Cover pieces (positions in the 180, 200, 200, 300 series · radius 3.2, height 7.5) — when the bells shatter there is no cover left.
- **Tactics**: slow 4/4 at 92BPM forces the player to absorb the beat; in the stealthebeat segment, after `neutralTicks=480` it flips to overdrive — hold out for half a minute, and the BPM reaches 120 with startup ×0.8.
- **Field annotation**: "Hersil" echoes by near-assonance the phrase "the grasp of the bell-masterless hand"; "Vaanlay" is the silence that holds up all things itself — he is not a bell, he is the quiet that remembers the bell.

### The Myriad `en_myriad` (→ `enemy.myriad`) · boss ★★★
- **Stats**: HP 380 / POISE 140 / speed 3.2 / DEF 30; FOV 0° / sight range 0 — **hearing hunt**.
- **AI**: `huntsSound` attackId=bite minLoudness 0.05 cooldown 150t maxRange 45; `hearsHeartbeat` stillTicks 180 decay 40/s.
- **Mechanic**: **Sound is aggro.** Silence → it sleeps; making a sound with loudness ≥0.05 → it hunts. The deaf_rage phase opens after the sound-`spine` props are broken (all objects smashed → `props atMost=0 → it goes deaf, enabling vibrationRange 10` — semi-visual).
- **Moves**: Bite (R3 · nonGrid cone 70 lunge 1 · dmg 36) / Rend (R2 · ring · dmg 28).
- **Tactics**: sound-aware slow combat: weapon-attack volume must stay < 0.05, or use ranged fuses to create decoys; **a pistol → it hunts the sound → turn and run — but it is useless: FOV 0 + vibrationRange 10 applies only in `phase2`**.
- **Field annotation**: The Myriad has no eyes. What it listens to is the place inside each heart that has never finished sounding.

---

## 4 · Counterplay Quick Reference

| archetype | Typical | Primary threat | Counter |
|---|---|---|---|
| basic | Murkshell | status.fissure stack buildup | Weakness ×1.8 · hit it first |
| ranged | Driftsinger · Skewer | ranged POISE chip | cut the range line · parry projectile |
| heavy | Tympanus | 220+ dmg by default (stomp) | on-contact `det` parry R2 · dodge the mute |
| assassin | Phantome | off-beat non-grid R2 | synco1 parry → backcut punish window |
| support | Refrein | aura +15% speed | kill it first |
| elite | The Hanged Knight | armorFront 60°; toll self-heal | flank the sides · answer the Toll's rhythm |
| miniboss | Ostlara | bellshell; phrase interrupt | break the bell set → crack the shell; `phase2` listen to 3/4 at 108BPM |
| boss | Hersil | stealthebeat drift | weather 480 neutralTicks · finale parry 3 consecutive |
| boss | The Myriad | huntsSound | silent movement + fuse decoys |

---

## 5 · Appendix · Name Table (NAME_MAP cross-reference)

```
enemy.murkshell   : Murkshell        enemy.refrein    : Refrein
enemy.driftsinger : Driftsinger      enemy.phantome   : Phantome
enemy.tympanus    : Tympanus         enemy.hangedKnight: The Hanged Knight
enemy.skewer      : Skewer           enemy.ostlara    : Ostlara, the Hanged Knight
                                     enemy.hersil      : The Beatless Chief — Hersil Vaanlay
                                     enemy.myriad      : The Myriad
```

> Everything in this volume comes from `enemies.json` and `CombatManager.NAME_MAP`; not a single segment here is an invented new monster. It merely **spreads the data flat against the scheme and takes one look** — what you see is the shape fear takes when it has been written down.
