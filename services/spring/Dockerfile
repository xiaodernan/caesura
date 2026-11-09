# services/spring/Dockerfile —— 这一族第一次有容器形态（KI-430，2026-11-09）
#
# **为什么镜像里必须同时有 JRE 与 Node**
#   - **JRE**：跑那几个 jar；
#   - **Node**：**门跑的是仓库既有的 npm／node 入口**（`npm run lint`／`node scripts/validate-data.mjs`）
#     ⇒ 镜像里没有 node 的话，**每一道门都会「起不来」**——那个报法本批实测过：
#     `Cannot run program "npm" ... error=2（系统找不到指定的文件）`。
#     容器里没有 node，与 Windows 上没有 npm.cmd 是**同一种死法**。
#
# **两个家当怎么凑到一块儿**：用多阶段 COPY **从 node 镜像把 node 抄过来**——
# 两条版本线各自独立：node 的版本由 node 镜像说了算，JRE 的版本由 temurin 说了算，谁也不拖累谁。
#
# **glibc 那一格是承重的**：`node:22` 是 Debian 系，`eclipse-temurin:25-jre` 是 Ubuntu 系——
# glibc 是**向后兼容**的：用旧 glibc 编出来的二进制能跑在新 glibc 上，**反过来不行**。
# 所以必须从**旧**的（Debian）往**新**的（Ubuntu）抄。
# 这一条不是嘴上说的，是**量出来的**——机器是 `services/spring/container-image-check.mjs`，
# 2026-11-09 在这台宿主上跑出的读数（那两个数以前是抄另一趟探针的，本机第一跑当场崩在半路）：
#   - node:22 的 `node` 二进制 **124,902,584 字节**，扫 ELF 里的版本化符号需求，最高只需要 **glibc 2.28**；
#   - eclipse-temurin:25-jre 是 **Ubuntu 26.04.1 LTS**，它的 libc 提供 **glibc 2.43**。
#   ⇒ 2.43 ≥ 2.28，方向对（判据里那句 `glibc_direction: OK` 就是这个比较，不是注释的复述）。
#
# **这个 Dockerfile 里一个 `RUN` 都没有**（这是本批的一个刻意选择，不是省事）：
#   构建期**不需要 exec** ⇒ 整个构建是纯声明式的（COPY 而已）。
#   代价是「node 在这个底座上真的能跑」这件事**不在构建里自证**，改由
#   `container-image-check.mjs` 在宿主侧量（静态那半用 `docker cp` 量 glibc 版本，
#   运行那半 `docker create` + `docker start -a` 问一句 `node --version`）。
#   运行那半今天的读数是 **BLOCKED**：五个 `caesura/*:0.1.0` 都构建成功、也在本机存在，
#   但 `start` 永不返回（`err=ETIMEDOUT`、`signal=null`——**不是被信号杀掉的**，
#   是客户端等不到容器退出）⇒ 容器停在 `Created` 不动，见账本 KI-431。
#   反过来这也把上面那条收益钉实了：**运行时坏掉的情况下镜像照样构建得出来**——
#   COPY 步骤全程是好的，坏的只有 exec 那一步（而那一步正是本批刻意不要的）。

# ── 第一个阶段：node 的家当从这儿来 ────────────────────────────────
FROM node:22 AS node

# ── 第二个阶段：真正交付的镜像 ────────────────────────────────────
FROM eclipse-temurin:25-jre

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules

# npm 与 npx 不是一个可执行文件，是一个 js 入口 ⇒ 给它们一个壳。
# （抄的是 node 镜像里那两个**真身**，不是链接：`ln -s` 要 RUN，而这里一个 RUN 都不留。）
COPY --from=node /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
COPY --from=node /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# 这个镜像不含仓库：仓库由 compose 以卷挂进去（`../..:/workspace`）⇒ 门跑的是**这份工作树**，
# 不是镜像里另装的一份。（代价与那笔欠账见账本 KI-432：卷里的 `node_modules` 是宿主机的，
# 原生二进制对不上容器里的平台。）
WORKDIR /workspace/services/spring
