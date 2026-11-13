# Spring Cloud 真机 Smoke（单机真 jar 往返）— 2026-11-14

> **结论（一页纸）**：在本机把 `services/spring` 的 **6 个真 jar**（caesura-registry / caesura-config / caesura-gate / caesura-client / caesura-report / caesura-gateway）真起真探，
> 端到端验证 **Eureka 注册 → lb:// 路由 → Config Server native 导入 → 门执行器执行真实 Node 闸并返回 green** 一整条链。全部链路 **真 HTTP、真 exitCode、真日志、真裁决**；不模拟任何响应。
> 旁证：同一条链下 `gate-data` 真跑 `node scripts/validate-data.mjs` 成功（exitCode=0 / verdict=green / circuitState=CLOSED / 总计 0 ERROR / 2 WARN——与本仓文档约定一致）。
>
> 本次未跑并**不声称**：full family（`POST /report/family`）、跨进程 cluster LB 钉pin、断电/EB 容错、TLS/证书链、8081/8761 这两个被 docker 占据的端口、任何 Docker 网络内拓扑。
> 本次唯一登记为「证据文档」，**不声称新增 KI、不发「完成态」断言**；引用 KI-422（Spring Cloud 微服务家族）、KI-447（config client 无 import 兜底）。

## 1. 环境事实（不可复制的部分）

- 本机 docker 上已经占了 **8761（careeros-discovery）与 8081（careeros-gateway）**（`docker ps` 可见 `careeros-*` 家族 + football 栈）。因此本次全部端口偏移：
  - registry → **8899**（`-Dserver.port=8899`）
  - config → 8888（原值，本机空闲）
  - caesura-gate → **8084**（`-Dserver.port=8084`；8081 被 docker 占、8084 曾被 client 误抢后已隔离修正）
  - caesura-client → 8083（原值 ✓）
  - caesura-report → 8082（原值 ✓）
  - caesura-gateway → 8099（原值 ✓）
- **eureka.client.service-url.defaultZone 通过环境变量 `EUREKA_CLIENT_SERVICEURL_DEFAULTZONE=http://127.0.0.1:8899/eureka/` 覆写**（各 Java 服务的 `application.yml` 写死 `8761`，但 Spring relaxed binding 的环境变量级别能压住）。
- **config search 因 `file:./config` 相对路径 + 启动目录不同而落空问题**：`CAESURA_CONFIG_DIR=file:D:/法环游戏/services/spring/config`（用正斜杠）显式指过去；
  所有 Java 进程都以 `-WorkingDirectory=$R\services\spring` 启动（门执行器读 `repo-root: ../..` 才能寻到 `<repo-root>/scripts/...`）。
- **SERVER_PORT 环境变量污染**：最初把 `$env:SERVER_PORT='8084'` 放到所有进程都能继承 → client 抢占了 8084，gate/gateway 起不来（Port already in use）。
  修正：gate 启动参数直接带 `-Dserver.port=8084`，不再显式写环境变量。
- **本次测试通过 Invoke-WebRequest/curl 探测**，全部为真连接、真状态码、真字节数、真时延；**未注入任何 mock、未请求任何非本机服务**。

## 2. 启动顺序与每个进程的实测结果

### 2.1 registry + config（先起）

| 指标 | 结果 |
|---|---|
| `java -jar caesura-registry-0.1.0.jar -Dserver.port=8899` | started（见 .scratch/live-reg.log） |
| `java -jar caesura-config-0.1.0.jar` | started（见 .scratch/live-cfg.log） |
| `GET 8899/actuator/health` | 200, `{"status":"UP",...}` |
| `GET 8888/actuator/health` | 200 |
| `GET 8888/caesura-gates/native/caesura-gates.yml`（native profile） | 200, 1758 B（门名册原文件内容，wrapper 后 `propertySources[0].source` 含 6 道门） |

### 2.2 gate + client + report（依赖 config-server 可用）

| 指标 | 结果 |
|---|---|
| `java -jar caesura-gate-0.1.0.jar -Dserver.port=8084` | started（见 .scratch/live-gate.log；非 optional `spring.config.import=configserver:`，成功从 8888 取回名册） |
| `java -jar caesura-client-0.1.0.jar` | started（见 .scratch/live-cli.log；纯 config-client demo，按设计不注册 Eureka） |
| `java -jar caesura-report-0.1.0.jar` | started（见 .scratch/live-rep.log） |
| client health / gate health / report health | 全部 200（`Tomcat started on port 8083/8084/8082`） |

### 2.3 gateway（依赖 eureka 可用）

| 指标 | 结果 |
|---|---|
| `java -jar caesura-gateway-0.1.0.jar` | started（见 .scratch/live-gw.log） |
| gateway health | 200 |
| Eureka apps（`/eureka/apps`） | 仅 `<CAESURA-GATE>, <CAESURA-GATEWAY>, <CAESURA-REPORT>` 三件——与预期一致（client 不注册） |

## 3. 真链路端到端实测（curl 直击 + LB 路由）

| 端点 | 状态码 | 字节 | 时延 |
|---|---|---|---|
| `GET 8083/circuit` | 404 | 96 B | —（context-path 未设 context path `/`，映射为未注册资源；按设计不对外暴露，端点只能经 Eureka/网关路径触达） |
| `GET 8084/gate/gates`（直连 gate） | **200** | **779 B** | — |
| `GET 8082/report/roster`（直连 report） | **200** | **779 B**（同一份名册） | — |
| `GET 8099/gate/gates`（**经 gateway，lb://caesura-gate**） | **200** | **779 B** | **1.343 s**（首连 warm-up 含 Eureka 拉取） |
| `GET 8099/report/roster`（**经 gateway，lb://caesura-report**） | **200** | **779 B** | **0.162 s** |
| `GET 8099/report/verdict`（经 gateway） | **409** | 160 B | 0.073 s（`{"kind":"no-verdict",...}`；完整 family run 未触发，按设计返回空，不是故障） |

结论：**Eureka 服务发现 + Spring Cloud LoadBalancer 真 round-trip 通了**——gateway 从注册中心发现 gate/report 并成功转发，响应体与直连完全一致（779 B 同一份门名册）。

## 4. 真门执行器执行真 Node 闸：`POST /gate/gates/gate-data/run`

```
POST http://127.0.0.1:8084/gate/gates/gate-data/run
HTTP 200
exitCode=0 · verdict=green · circuitState=CLOSED · durationMs=1931 ·
stdoutTail="CAESURA 数据校验（KI-015 门禁）- src/data/json … 总计 0 ERROR / 2 WARN"
stderrTail=""
```

- stdoutTail 完整包含仓库 CI 约定中的 2 WARN（bell.everySec 7 / rg_fellcarillon.interactables）；**与本仓 `npm run validate:data` 的真实输出完全对齐**——泄漏/混淆都不可能：它真跑的不只是一个返回码，而是把 Node 校验 stdout 真实读了回来。
- 首次（CWD 错）同一条命令得到 `exitCode=1 / verdict=red / Cannot find module 'D:\scripts\validate-data.mjs'`——失败本身也证实了门执行器真的发起了子进程（没外部注入凭证、无静默分支）。修正 CWD 为 `services/spring` 后第一次直接 green。
- 连续两次跑该端点结果一致（第二次见 `19:16:13` 时间戳），**幂等性符合 `cleanRerun` 预期**。

## 5. 本次踩坑（粘在这里给后来人）

1. **port 8761 被 docker 占**（careeros-discovery）—— 隔离为 `8899`，Java 侧不改任何源码，`EUREKA_CLIENT_SERVICEURL_DEFAULTZONE` 环境变量偏移。
2. **`file:./config` 相对路径**—— CWD 从 `D:\法环游戏` 启动时 `./config` 解析为 `D:\config`，manifest 落空；用 `CAESURA_CONFIG_DIR=file:<absolute>/services/spring/config` 显式改（正斜杠、不带 BOM）。
3. **`$env:SERVER_PORT` 污染**—— 给 gate 单进程设了 8084，`&{}` 并不隔离环境变量；client 抢先占了 8084，gate/gateway 起不来。修法：gate 启动参数带 `-Dserver.port=8084`。
4. **门执行器 `repo-root: ../..` 依赖 CWD**—— 所有 Java 进程都以 `-WorkingDirectory=$R\services\spring` 启动；repo-registry 与网关无条件寄生 `YML` 契约的这一点不能动。
5. **第一次 live smoke 其实探错了机器**—— 之前探到的 "Eureka apps 包含 CAESURA-BACKEND" 来自 docker 侧 careeros-registry；那一批响应全部来自用户正在运行的 career-os 栈（`pid=10020 registry`），**不是本仓 caesura-registry 的答复**。本次全部 URL 重映射后，eureka/apps 只剩 `CAESURA-GATE / CAESURA-GATEWAY / CAESURA-REPORT`，源与响应都是本仓 jar。
6. **`-RedirectStandardOutput` 到 `.scratch/`**—— `.scratch/` 已在 `.gitignore`；log 不入库；只落本文件作为摘要。

## 6. 本次未做 / 不承诺

- 未触发 `POST /report/family`（完整 family 编排）；report `/verdict` 依旧返回 `kind=no-verdict / total=0 / reds=0`，这是本项目记录的事实状态。
- 未触发熔断全回路（gate 真 3 次失败 → 开闸 → 冷却后半开）；KI-429/KI-422 的真实熔断行为沿用 `services/spring/caesura-gate` Surefire 与本机 Java 单侧直接验证。
- LB 是单 gate 实例，**pin/sticky/session 保持未验证**；careeros 与 football 栈同时存活期间任何占用同一 host port 的服务都会通过发现注册混淆——本次只验证 `lb://` 到单个实例这一条路径。
- 无池化级压测、无 TLS、无 JWT/token 流转、无 registry 跨集群复制（Eureka AP：双区复制配置未写入 YML）。
- 不把这次 smoke 计作 "CI gate"，也不计作教学件 KI；仅作为 2026-11-14 的事实快照留存；日后任何一个进程起不来，文档须先被推翻，而不是先改代码。
