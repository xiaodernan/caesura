# Spring Cloud 微服务族 — 本机端到端验证实录（2026-11-10）

> 本文件记录 **host 直跑路径** 是怎么走通的：六件 jar 依次起在默认端口，
> 并用 Node 探针实测整条调用链路。
> 镜像/容器路径仍被 **KI-431** 卡住（本机 docker 的容器运行时从不返回）；
> 本机验证走的是 **host 直跑**，不是 container。

## 与 `services/spring/docker-compose.yml` 的关系

| 项目 | 容器路径（KI-431 卡住） | 本机路径（本文件，已实测） |
|---|---|---|
| 构建 | `docker compose build`（成功，`build_rc=0`） | `mvn -DskipTests package`（"全家六件 jar 齐位"） |
| 启动 | `docker compose up`（卡住：进程停在 `Created`，`start` 永不返回） | `java -jar <each>/target/caesura-*.jar` |
| 网络 | compose 网络（hostname＝容器名） | 127.0.0.1（各服务默认 YAML） |
| 端口 | 8761/8888/8081/8082/8083/8099 | 同（宿主空闲时默认就是这几个） |
| 判定权 | 仍是 Node 侧 | 同上 |

## 启动次序（本机实证）

```powershell
# 工作目录：services/spring（这一族的约定）
# 六件都在这个目录里起；每条命令返回后下一件再起，给 JVM 一点启动时间。

# 1. 注册中心（Eureka）——其余五件都要它
Start-Process -FilePath java -ArgumentList '-jar','caesura-registry/target/caesura-registry-0.1.0.jar' -WindowStyle Hidden

# 2. 配置服务器（Config Server）——gate/report 的名册唯一出处
Start-Process -FilePath java -ArgumentList '-jar','caesura-config/target/caesura-config-0.1.0.jar' -WindowStyle Hidden

# 3. 门执行器（/gate 为 context-path）
Start-Process -FilePath java -ArgumentList '-jar','caesura-gate/target/caesura-gate-0.1.0.jar' -WindowStyle Hidden

# 4. 汇总（报告）——经 Eureka @LoadBalanced 调 caesura-gate
Start-Process -FilePath java -ArgumentList '-jar','caesura-report/target/caesura-report-0.1.0.jar' -WindowStyle Hidden

# 5. 配置客户端（本族最小示例）
Start-Process -FilePath java -ArgumentList '-jar','caesura-client/target/caesura-client-0.1.0.jar' -WindowStyle Hidden

# 6. 网关（Spring Cloud Gateway，/gate/** 与 /report/**）
Start-Process -FilePath java -ArgumentList '-jar','caesura-gateway/target/caesura-gateway-0.1.0.jar' -WindowStyle Hidden
```

停服务：按 PID 各 `Stop-Process -Id <pid>`（`Get-NetTCPConnection -State Listen` 找端口→进程）。
**不要**按端口范围 `taskkill`——本机上有别的项目（另一个 Spring Cloud 族）也在用邻近端口（8090/8080 等），
按名字或按精确 PID 停，不要按区间扫。

## 验证记录（2026-11-10，本机实测原话）

### 端点

| 端点 | 结果 |
|---|---|
| `GET  :8761/eureka/apps` | 200，`apps__hashcode=UP_4_`（CAESURA-GATE / CAESURA-REPORT / CAESURA-GATEWAY 注册，hostname=127.0.0.1） |
| `GET  :8888/actuator/health` | 200（`{"name":"actuator","profiles":["health"],…}`） |
| `GET  :8083/actuator/health` | 200 `{"status":"UP"}`（client 已修复，见 KI-453） |
| `GET  :8081/gate/gates` | 200，5 道门名册，`source: config-server:caesura-gates`，`repoRoot: "../.."` |
| `GET  :8099/gate/gates` | 200，与直连同一份形状（gateway 路由 `/gate/** → lb://caesura-gate`） |
| `GET  :8099/report/roster` | 200，report 经 Eureka `@LoadBalanced` 调 gate，返回同一份 5 门名册 |

### 两道真门（经网关 POST）

```
POST :8099/gate/gates/gate-data/run
→ {"id":"gate-data","command":"node scripts/validate-data.mjs","exitCode":0,"verdict":"green","durationMs":999, …}

POST :8099/gate/gates/gate-types/run
→ {"id":"gate-types","command":"npm run lint","exitCode":0,"verdict":"green","durationMs":32464, …, "circuitState":"CLOSED"}
```

两次 `verdict` 都是 **green**，含 `circuitState:"CLOSED"`（KI-429 熔断器在本族上真闭合，不是纸面）。

## 常见坑（本次全部现踩过）

| 坑 | 现象 | 修复 |
|---|---|---|
| **容器路径** | `docker compose up` 起不来（容器停在 `Created`，`docker start` 永不返回） | host 直跑（本文）；KI-431 仍 Blocked |
| **client 缺 `spring.config.import`** | 启动即 `No spring.config.import property has been defined` | `application.yml` 加 `spring.config.import=optional:configserver:…`（KI-453） |
| **client BOM 漂移** | `compatibility-verifier` 硬拒："Spring Boot [3.5.16] is not compatible" | client pom 删掉自钉的 boot/cloud 版本，继承父 BOM |
| **client finalName 不一致** | compose 找不到 `caesura-client-0.1.0.jar` | `<finalName>caesura-client-0.1.0</finalName>`（KI-452） |
| **测试里局部变量叫 `bus`** | `event-rules` 主干自证门红（按应用总线收 `.subscribe()`） | 改名 `evbus`（本会话两处踩） |
| **容器专用 hostname** | 服务间经 Eureka 互调失败（`caesura-gate` 在本机不解） | 本机走 YAML 默认 127.0.0.1，不传 `--eureka.instance.hostname=` |
| **成本：另一项目在跑** | 8888/8080/8090 等端口可能被**另一个** Spring Cloud 族占用 | 不动别人的进程；先 `Get-NetTCPConnection -State Listen` 盘端口，冲突就换端口或只验可起的（8080 被 Docker Desktop 占、8090 被 Nexus 占；caesura-gateway 用 8099 同理） |
| **共享机器** | 六件 JVM 各 100–400 MB 内存，用完请停掉 | `Get-CimInstance Win32_Process -Filter "Name='java.exe'"` |

## 未验证 / 未完成

- 容器路径（KI-431：环境 Blocked，不因为本文件就能起）。
- ~~`/report/family` 汇总真跑整族（跑的是 gate-suite `npm run test`，85s 量级）——只验了 `/roster` 的 Eureka 调用链路和 `/gate/*/run` 两条真门。~~ **2026-11-10 本机实测整族 GREEN（见下节）。**
- `bus-refresh`（配置热刷新经总线广播）——Java 家族侧未跑；Node 侧已落地（KI-450）。
- Eureka 自保阈值与租约清理在**长时间高负载**下的行为——本次只覆盖"起起来 + 注册 + 反注册"级别。

## 2026-11-10 整族终局验证实录（`POST /report/family` 全绿）

整族并行跑完，五道门全部 green、`circuitState=CLOSED`：

```json
{"kind":"green","reds":0,"total":5,"ranFiles":5,"expectedFiles":5,"redTitles":[],
 "blockingReds":0,"concurrency":3,"wallMs":170293,
 "gates":[
   {"id":"gate-types","command":"npm run lint","exitCode":0,"durationMs":122650,"verdict":"green","circuitState":"CLOSED"},
   {"id":"gate-data","command":"node scripts/validate-data.mjs","exitCode":0,"durationMs":1308,"verdict":"green","circuitState":"CLOSED"},
   {"id":"gate-head-selfcheck","command":"node scripts/head-compiles-rules.mjs","exitCode":0,"durationMs":122640,"verdict":"green","circuitState":"CLOSED"},
   {"id":"gate-suite","command":"npm run test","exitCode":0,"durationMs":159221,"verdict":"green","circuitState":"CLOSED",
    "stdoutTail":"[test] RESULT {\"kind\":\"green\",\"reds\":0,\"total\":4907,\"ranFiles\":415,…}"},
   {"id":"gate-ship","command":"npm run build","exitCode":0,"durationMs":47051,"verdict":"green","circuitState":"CLOSED",
    "stdoutTail":"dist/index.html ✓ built in 686ms … [dist] 文本 10 份 / 0 findings"}
 ]}
```

三条要点：

1. **并发那一格真的在跑**：`concurrency=3`，gate-executor 的 Java 线程池并发执行 `lint`/`validate-data`/`head-compiles-rules`/`test`/`build`，wall time 170s ≈ 最慢那道（gate-suite），不是串行加法。
2. **熔断器全程 CLOSED**（KI-429）：五次连续 `verdict=green`，无一开闸。
3. **`.scratch/` 不入库**、`dist/` 不被本条改动（gate-ship 重建了 `dist/` 且本仓 `npm run build` 过 `check-dist` 文本 10 份 / 0 findings）。

**未在这一趟量出来的**：hot path 下的 Eureka 租约过期行为、`bus-refresh` 的 Java 侧、`.dockerignore` 覆盖——各自独立，不替它们作证。
