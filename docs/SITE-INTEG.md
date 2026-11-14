# SITE-INTEG · 个人展示页集成卡（实拍命令 + `.card` 样例）

> 与 `docs/SITE-SYNC.md` 互为表里：那一份说**为什么**要有 `site-latest.json`，这一份说**怎么嵌**。

## 第一件
站点已经可以直连 `https://xiaodernan.github.io/caesura/` —— `Deploy CAESURA to GitHub Pages` workflow 每次 master push build+deploy 一次，约 3–5 分钟后这条 URL 返回的就是当前 master。

## 第二件：把 latest commit + KV 渲染到入口
`https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json` 在每次 master push 时由 `.github/workflows/site-sync.yml > Build site-latest.json` 自动重嵌。你的展示卡可以这样：

```html
<a class="proj proj--caesura" href="https://xiaodernan.github.io/caesura/" id="caesura-card">
  <span class="proj-label">CAESURA·止音纪元</span>
  <span class="proj-chip live">live</span>
  <span class="proj-meta" id="caesura-meta">最新提交 …</span>
</a>

<script>
  fetch('https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json')
    .then(r => r.json())
    .then(j => {
      const sha = j.head.slice(0, 7);
      const kv  = j.kv;
      document.getElementById('caesura-meta').textContent =
        `${sha} · KI ${kv['KI.rows']} = Implemented ${kv['KI.Implemented']} · SYS.rows ${kv['SYS.rows']} · SECTIONS ${kv['ARCH.sections']}`;
    })
    .catch(() => { document.querySelector('.proj-chip').textContent = 'offline'; });
</script>
```

* 卡片风格：冷黑底 + 暗金描边 + CTA 按钮同 `--gold`（文案 `#ffeabf` 浅调）
* fetch 发一次即可：`site-latest.json` 的 5 分钟 TTL 足够快
* a href 用常驻 URL（`/caesura/` 永远是最新 master）
* 注：不在本仓库再 fork 一份到个人站 repo——避免双源漂移；个人页直接 `fetch` master 即可

## schema = 1
`schema: 1` · `defaultBranch: master` · `headMgt.url: https://github.com/xiaodernan/caesura/commit/<sha>` 指向最新 master；`kv` 从 `scripts/phase-status.mjs` 现读。不读取外部任何缓存、不在该文件放置密钥、不硬编码数值。

## 约束
* 不要把 `caesura-*` 复制进个人站的 repo（避免双源）
* 不要覆写 `schema: 1`，将来字段变更会走 schema: 2
* `site-latest.json` 只能由 CI 写入
