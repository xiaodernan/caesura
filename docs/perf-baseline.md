# 基本盘 —— Phase 9 的第一张性能盘（KI-335／KI-418）

> 这不是 Phase 9 的通过、也不是速度背书。
> 它是 Phase 9 的**起点盘**：任何"优化前／优化后"的对比都必须先面对**这一盘上的数**，
> 谁改一行代码，谁就应该再跑一次 `node scripts/measure-probe.mjs` 再对比。
>
> 所有数字均来自 2026-11-09 在本开发机上的实测。环境：Windows、headless（无可见窗口／无 WebGL），
> 不代表目标平台（Steam wishlist 的桌面档）、nightly CI、或任何其他节点。

---

## 1. 量法（谁想复量都可以）

```bash
node scripts/measure-probe.mjs
# ⇒ 打印本趟读数并追加 artifacts/perf-probe-<date>.log（不入库；KI-410）
```

测量的是 `ai.update` —— 敌人侧决策这一格，在 12 只混编（`en_murkshell×4 / en_driftsinger×3 /
en_tympanus×2 / en_myriad / en_refrein / en_hanged_knight`）开局即最大负载、`enter('combat')`+警觉满、
`TICK_HZ=60` 下的 3600 拍（1 分钟）耗时分布。由 `tests/flow/perf-probe.test.ts` 承载，
`scripts/test.mjs` 的磁盘名册包含它；断言只钉与时机无关的两样（样本数=3600、全有限）——
**帧预算 <2ms 不进断言**（同一份码换一趟就换一个数；KI-336 系读数）。

拼出的同一量（**两趟**）：

| 指标 | 趟 A | 趟 B |
|---|---|---|
| mean | 0.1165 ms | 0.1599 ms |
| p50 | 0.0897 ms | 0.1048 ms |
| p95 | 0.2816 ms | 0.3816 ms |
| p99 | 0.6193 ms | 0.8387 ms |
| max | 4.8284 ms | 8.4685 ms |
| over2ms | 2（0.06%） | 8（0.22%） |

**结论的一部分就是 run-to-run 方差**：mean 从 0.116 → 0.160（+37%）、max 从 4.83 → 8.47（+75%）。
任何单趟读数只有量级意义；真正改善必须能在多趟上重复出现。Phase 9 的 Before/After 对比
必须同一台机器、至少 3 趟取中位。

---

## 2. 顺便量到的（2026-11-09）

| 项目 | 读数 | 来源 |
|---|---|---|
| 全量测试 wall 时间 | ~132–152 s | `npm run release` 本次会话两趟汇总 |
| red-rate（ui-intents／cinematic 三件套） | idle reds/4 = 0、loaded reds/4 = 0；负载倍数 2.34× | KI-409 |
| 主干计数 | 4550 条 / 389 文件全绿 | `npm run check` |
| tsc / validate:data | 0 错 / 0 ERROR／2 WARN（既有） | `npm run release` |

---

## 3. 明确不量、也不背书（读数真相）

| 项 | 为什么不在这盘上 |
|---|---|
| FPS / 帧预算总表（16.6ms） | headless 无可见窗口 ⇒ GPU 那半句（draw call、管线、KTX2、像素）从未采集过（KI-335／KI-418 同因） |
| Windows 其他节点一致性 | 本机单节点；nightly CI 不做性能门（目前是 lint+test+build，0 FPS 轴） |
| "<2ms 每 tick 上限" | 设计目标，**不是机器承诺**——本机上的 min 就能看到 0.05ms 与 8ms 并存 |
| 关键路径渲染成本 | 本表只量逻辑侧 `ai.update`；`combat`／`player`／`camera rig` 各段未单列 |
| JSGC 噪点 vs 真峰值 | `max` 里的 4–8ms 是 JIT/GC 噪点还是真峰值，本盘**没分辨**（KI-418 不分辨声明） |

---

## 4. Phase 9 要兑现的对比（下一位接手时的清单）

1. 先在干净机器上 re-run（KI-407 那道环境债：覆盖率空报表）再落基线；本仓没量过第三趟。
2. 每一项优化批（InstancedMesh / KTX2 / 粒子预算 / 状态机分片）落盘时同命令复量、记三列对比表，
   像 KI-317's `n=32` 那趟实验一样把方差写进答案，不写成"修好了"。
3. 每一笔 Phase 9 优化结案必须带：命令 + commit hash + 至少 3 趟读数（mean/p95/max）+ 方差句。
4. 帧预算 Failures 不归 perf-probe 背书；Phase 9 的 exit 由「可见窗口里 1080p 60FPS 站桩实测」裁决（KI-010 同因），这盘只是逻辑侧底账。

---

## 5. 相关锚点

- KI-335 — PerfSampler / F5 面板 / 池命中率（地板已落）
- KI-418 — measure-probe（本基本盘的出生地）
- KI-300 / KI-317 — 设计稿 §17 半句「每 tick <2ms」裁给文档侧之后的那份读数
- `scripts/coverage-floor.json` — 行覆盖 94.95%+ 棘轮；`scripts/red-rate.mjs` — 红率哨兵
- `docs/production-plan.md` §Phase 9 — Optimization 的验收口径（profile 先行、记录 Before/After/Trade-offs、≥10fps 预算、≥30 FPS 场景）
