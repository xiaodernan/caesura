# SITE-SYNC · 个人展示页实时同步协议

目标：`https://xiaodernan.github.io/`（你的个人展示页）上"项目入口"点击进去能看到**最新 master 状态**，不是某个陈旧的快照。

## 协议：`site-latest.json`

仓库根目录发布了一个稳定 schema 的 JSON 文件，CI 在每次 master push 时自动刷新并回写（commit 前缀 `chore(status): re-embed site-latest.json`，不会触发自身循环）。

- **诚实**：它只读 `git` + `scripts/phase-status.mjs` 的机器产出，不硬编码任何数字；KV 变更随时（`KI.rows`/`SYS.rows`/`ARCH.sections` 等）反映真源。
- **低频**：每个 direct master push 才触发一次（实际节奏 ≈ 每个 /tmp 提交一次）。
- **幂等**：重跑同一 HEAD 必得字节相同的 JSON（timestamp 也不漂移），所以 CI 跑 N 次不会刷屏。

### 消费方式（给展示页作者参考）

```html
<!-- 任意 HTML / 任意 JS 框架都可以用这个fetch -->
<script>
  fetch('https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json')
    .then(r => r.json())
    .then(async j => {
      // 或者直接内联 DOM（任何无框架的静态页都能读 j 对象）
      j.kv['KI.rows'];         // 481
      j.kv['KI.Implemented'];   // 304
      j.headMgt.url;           // 当前 master 最新 commit 直链接
      j.subject;               // 最新 commit 的 message 首行
      j.date;                  // commit 时间
      j.suites.consoleFullStack; // 相关测试套
    })
</script>
```

- `schema` 当前为 `1`；key/version 在文件自身（未来不兼容时 `schema: 2`）
- `defaultBranch: master` 是事实声明；branch 永久为 master
- `headMgt.url` 是 `https://github.com/xiaodernan/caesura/commit/<sha>`；展示页 `点击进去` 合理导流目标
- CI 运行频率锁：`check + spring-family-e2e` 全绿 ⇒ master 才会有新的 site-latest.json commit（不绿的 master push 不会触发刷新）

### 真正的约束

- 这个 JSON 只用于"看得见的状态"——**不**替代任何构建期/部署期机制
- 静态 host（GitHub Pages）可以放心读它；没有其他外部调用
- 机密绝不会坐在这个文件里（sentry/token/secret/api 全不进仓库）

## 展示页侧需要做的唯一一件事

在仓库中应用 `site-latest.json` 的元素：
- `.subheading` — 放 `j.kv.KI.rows` 类目数
- `.last-updated` — 放 `j.date`
- `.go` — `href = j.headMgt.url`（或者链接到仓库主页）
register 处仍然 master 的最新 push deploy，**不需要 gh-pages 发布脚本迁移**（Pages 部署自己跑）

## 当前状态（2026-11-15）
schema 1 · defaultBranch master · KI.rows **481** (Implemented **304**) · SYS.rows **98** · ARCH.sections=**202** / 0 holes · PKG.scripts=**78** · 网格测试套 · Console Library 读取 `snapshot.json`/`decoded` 见 `console/bootstrap.js`。
