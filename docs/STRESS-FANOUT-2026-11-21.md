# 全站扇出压力测试报告（KI-730 · 2026-11-21）

## 目标

验证第 85 篇落地后全站级联的稳定性：把**全部故事页 + 关键静态页**一次性扇出冲击，
模拟「海量用户同时打开整本站」与「瞬间大数据量」。

## 工具

`scripts/stress-fanout.mjs` —— 从 `public/read-progress.js` 的 ORDER 现读全部故事 slug（唯一真源），
加上关键静态页，去重后得到 94 个独立 URL；`--multiplier=N` 把每个 URL 复制 N 份并发。
只读 GET · HTTP 200 + 非空 body 判据 · 报告 min/mean/p50/p95/p99/max、总字节、失败率。

诚实边界：本机并发 fetch 冲击 GitHub Pages CDN，受本机带宽/代理限制，数字如实读取；
不写、不伪造真实访问、不声称通过任何真实后端鉴权。

## 实测数据（gpt 无关 · 纯网络）

### multiplier=5（470 请求）

| 指标 | 值 |
|---|---|
| distinct / requests | 94 / 470 |
| failures / failureRate | **0 / 0** |
| wall | 2,494 ms |
| mean / p50 | 2,114 / 2,094 ms |
| p95 / p99 / max | 2,269 / 2,333 / 2,448 ms |
| totalBytes | 16,924,315（~16.9 MB） |

### multiplier=10（940 请求）

| 指标 | 值 |
|---|---|
| distinct / requests | 94 / 940 |
| failures / failureRate | **0 / 0** |
| wall | 4,272 ms |
| mean / p50 | 3,834 / 3,817 ms |
| p95 / p99 / max | 4,035 / 4,108 / 4,168 ms |
| totalBytes | 33,848,630（~33.8 MB） |

## 过程中的真实发现

首轮 multiplier=5 报 10 个 404，全部来自 `/caesura/anthology/` 与 `/caesura/anthology/index.html`
——这是压测脚本 key 列表写错了路径（全集实际在 `/caesura/story/anthology/`）。
修正后两轮均 0 失败。这正说明压测的价值：它把脚本自身的错误路径也暴露了出来。

## 结论

94 个独立端点（85 篇故事 + 关键静态页）在 5×/10× 扇出（470/940 并发请求、16.9/33.8 MB）下
**全部 HTTP 200、零失败**，p99 稳定在 2.3s/4.1s。全站级联稳定，"地图很大里面很空"不成立——
每一页都是真实可达的实体。

守卫：`tests/unit/stress-fanout.test.ts` 5 腿（只读/现读 slug/去重/无错路径/percentile/报告字段）。
