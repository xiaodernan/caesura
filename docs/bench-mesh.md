# 压力测试记录（CAESURA api-mesh · in-process 路由链）

> 用途：测「我们这一侧」的三件套——`createGameCloud` 内存路由、`proxyCall` 的 Path filter、100/200 路并发对同一 gate 的冲击下，平均延迟、p50/p95/p99、失败率、heap 增长。
> **诚实边界**：这不是端到端真网络压测——没有客户端 IP、没有真 Redis、没有真容器。它测的是**路由链本身的代价**与**调度开销随并发度的曲线**。真正端到端的容器压测走 `services/spring`（子模块 jars + Eureka/Config/Gateway）。

## 复跑命令（离线，< 1 分钟）

```bash
npm run mesh:stress        # 2000 次 × 100 并发
npm run mesh:stress:max    # 5000 次 × 200 并发
```

## 本机实测曲线（2026-11-15 · master `afeabeb`）

| 迭代 × 并发 | 成功率 | avg | p50 / p95 / p99 | heap 增长 | wall 时钟 |
|---|---|---|---|---|---|
| 1000 × 100 | **100%** | ~500 μs | 375 / 1000+ / ~1300 μs | +4 MB | ~10 ms |
| 2000 × 100 | **100%** | **507 μs** | 422 / 1145 / 1389 μs | +5.9 MB | 20 ms |
| 1000 × 200 | **100%** | 596 μs | 568 / 1260 / 1447 μs | +2.9 MB | 6 ms |
| 5000 × 200 | **100%** | **4.8 ms** | 3771 / 14017 / 28839 μs | +6.1 MB | 246 ms |

读数说明：

- 500μs→4.8ms 的尾部上升是**单线程事件循环被 200 路并发同时撑满**造成的队头效应（mock 没有任何异步 I/O 与之重叠，纯 CPU 排队），不是业务逻辑路径上出现锁竞争、队列积压、内存分配风暴。
- 全程零失败；heap 只涨 ~6 MB / 5000 次（RouteTable/predicate array 不复制堆积）。
- 若要看真网/内存外排队行为，请用 `services/spring` 的真 jars + `spring-family-e2e-check.mjs`（CI `spring-family-e2e` 每次 push 全跑）。

## 门控（认真对待"能不能扛大客"这句）

- `src/data/json/navmesh` + 区域解锁在客户端完成，**不需要服务端 Redis 才能跑游戏**；服务端 mesh 是给金融密态词典/行情流/积分等"直达大客"场景留的观察面。
- 真·端到端高并发见 `spring-family-e2e`（每 push 跑）：Eureka + Config + Gateway + Client 五块 jar 全绿。
- `npm run ratelimit:cluster:bench` / `cache:bench` / `slot-map:bench` 是 redis 联考（shard 连接、一致性 hash、pipeline 头店）。

## 不声称

- 不声称这是 10000 QPS 的承载能力证书——CPU-bound mock 没有 I/O。
- 不声称 P99 在生产会有同样数字——网络握手与 TLS 是另一级量纲。
