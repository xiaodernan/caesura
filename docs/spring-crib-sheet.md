# Spring Cloud · 止音纪元 · 简笔手册 (Bilingual)

> 七件件我都跑过、都通。本文把 "什么是 X / 本作哪里用 X / 对应哪一个脚本" 对齐到中文。**不涉及**运行时 canon；只是后端配置/服务编排的简笔。

| 件 | 中文速写 | 英文直译 | 本作的落点 | 中文说明（本作） |
|---|---|---|---|---|
| Spring Cloud **Config** | 配置中心 | Centralized config | `scripts/caesura-spring-config.mjs` | 把散落在各个服务里的配置归集到一个可审计、可对账的位子 |
| Spring Cloud **Eureka** | 服务名册 | Service registry & discovery | `scripts/caesura-spring-eureka.mjs` | 本作里 "认识彼此的名单"：哪个服务在哪、状态是 alive/suspect/faulty |
| Spring Cloud **Gateway** | 网关 | API gateway / routing | `scripts/caesura-spring-load-balance.mjs` + `spring-gateway-*` 脚本 | 对外入口：所有 request 先经过 token bucket 和断路器 |
| Spring Cloud **Feign** | 声明式微服务 | Declarative HTTP client | `scripts/caesura-spring-feign.mjs` / `spring-cloud-openfeign-client.mts` | 写契约（interface），框架自动拼 URL / 反序列化 |
| Spring Cloud **Ribbon** | 客户端负载均衡 | Client-side LB | `scripts/spring-load-balancer.mjs` | 本作目前不依赖 Ribbon（vs 完全听话的 Spring Cloud LoadBalancer） |
| Spring Cloud **Bus** | 总线 / 广播 | Service-to-service pub/sub | `scripts/caesura-spring-bus.mjs` / `spring-bus-event.mts` | 一地有变，全网都知道——用 Redis pub/sub 模拟 |
| Spring Cloud **Circuit Breaker** | 熔断器 | Resilience breaker (resilience4j) | `scripts/spring-circuit-breaker.mjs` | 失败累加到阈值就不再调 *while we are the caller* |
| Spring Cloud **Contract** | 契约 | Consumer-driven contract | `scripts/caesura-spring-contract*` + `.github/workflows/spring-family-e2e.yml` | 出网的接口，由消费者写断言，producer pipe-passing 不过 CI 就不许 deploy |
| Spring Cloud **Gateway Retry** | 重试（网关） | Retry policy w/ budget | `gateway-retry-runner` in pipeline | 瞬断时自动重试，有限上限、熔断上限、指数退避 |
| Spring Cloud **Stream / Bindings** | 消息队列绑定 | MQ bindings | `scripts/caesura-spring-stream*` + `tests/unit/spring-*` | 接口本文连接入 Kafka/RabbitMQ 等流管道 |
| Spring Cloud **Sleuth** | 链路追踪 | Distributed tracing | `scripts/mesh-snapshot.mjs` + `spring-sleuth*` | 一个请求在多个服务里怎么连起来：spanId / traceId |
| Spring Cloud **Kubernetes** | 原生 K8s 绑定 | Kubernetes discovery | `services/spring/kubernetes/` | 引入服务发现 + 配置，不走 Eureka 走 K8s API |

## 本作"Cloud-Native 套"的真实顺序

1. 契约：先写消费者断言（Feign interface + message）
2. 名册：所有服务注册上来（Eureka）
3. 伸缩性：网关 + token bucket + 重试
4. 故障：熔断器 + 半开探针 + slack cap
5. 广播：Bus + Redis pub/sub 模拟
6. 证据：sleuth 的 zipkin-lite
7. CI：契约过 spring-family-e2e（全件同一 push）

## 中英对照速查

```
Config Server           → 配置中心
Service Discovery       → 服务发现 / 名册
API Gateway             → 网关 / 边界
Load Balancer           → 负载均衡
Circuit Breaker         → 熔断器 / 断路器
Bulkhead                → 舱壁 / 隔离
Rate Limiter            → 限流器
Retry                   → 重试
Timeout                 → 超时
Idempotency Key         → 幂等键（幂等）
Spring Cloud Bus        → 总线
Spring Cloud Stream     → 流绑定
Spring Cloud Contract   → 消费者契约
```

## 最小示意图

```
消费者                网关                       服务
+-----------+    +-----------+    +-----------+    +----------------+
| codex /   |==| token     |==| breaker    |==| Eureka Client  |
| story /   |   | bucket    |   | (count-based)  |                 |
| admin     |   +-----------+   +------------+    +----------------+
+-----------+
            上游：先写契约、后上名册
            下游：断路器 + 舱壁 + 重试
            两侧都：Kafka/RabbitMQ 异步绑定
```
