/**
 * admin/data.js — 止音后台 · 模拟队列 v1（scripts/gen-analytics.mjs 生成 · 固定种子 · 勿手改）
 * The Epoch of Hush — admin observatory · simulated cohort v1 (generated; do not hand-edit)
 */
export const TELEMETRY = {
  "meta": {
    "schema": 1,
    "generatedAt": "2026-11-15T12:00:00+08:00",
    "seed": 20261115,
    "days": 30,
    "startDate": "2026-10-17",
    "endDate": "2026-11-15",
    "cohortKind": "simulated",
    "noteZh": "本面板的聚合数据是固定种子（20261115）可复现的模拟队列：公开研究先验区间 × 30 天 × 4 次重算一致。它用来校准分析引擎与教学演示；本机实况（localStorage）展示的是你这台浏览器真实发生的一切。",
    "noteEn": "Aggregate figures are a reproducible simulated cohort (seed 20261115): public-research prior bands × 30 days × byte-identical regeneration. It calibrates the analysis engine and serves as a walkthrough; “Live (this browser)” below shows what actually happened on this device.",
    "refs": [
      {
        "labelZh": "Baymard Institute · 平均购物车放弃率 70.22%",
        "labelEn": "Baymard Institute · avg. cart abandonment 70.22%",
        "detail": "2026-10-28 更新 · 50 项研究 2006–2025 · 非加权均值，先验带：漏斗会大幅流失。"
      },
      {
        "labelZh": "Nielsen Norman Group · 10 秒法则",
        "labelEn": "Nielsen Norman Group · the 10-second rule",
        "detail": "≈ 五分之一用户在首屏立即离开 / ~1 in 5 leaves at first paint. Prior band for bounce."
      },
      {
        "labelZh": "Contentsquare Experience Benchmark 2024/25 · 跳出 ≈ 49–50% · 会话 ≈ 52–55 秒",
        "labelEn": "Contentsquare Experience Benchmark 2024/25 · bounce ≈ 49–50% · session ≈ 52–55s",
        "detail": "行业指纹 / Industry fingerprint used as sanity band."
      },
      {
        "labelZh": "StatCounter Global Stats 2025 · 移动端 ≈ 62%",
        "labelEn": "StatCounter Global Stats 2025 · mobile ≈ 62%",
        "detail": "移动端流量权重 / Mobile traffic weight for the device mix."
      }
    ],
    "disclaimerZh": "模拟数据不构成真实用户统计；上线后若接入后端上报（Spring 调度台 report 服务 8082），本页可直接替换数据源为真实流。",
    "disclaimerEn": "Simulated figures are not real user statistics. Once backend telemetry is wired (Spring report @8082), this deck can drop-in swap to live data."
  },
  "daily": [
    {
      "date": "2026-10-17",
      "sessions": 139,
      "newUsers": 52,
      "bounce": 0.57,
      "avgDurationSec": 108,
      "pageViews": 342,
      "endings": 9,
      "marks": 35,
      "storyFinishes": 24
    },
    {
      "date": "2026-10-18",
      "sessions": 168,
      "newUsers": 54,
      "bounce": 0.64,
      "avgDurationSec": 115,
      "pageViews": 525,
      "endings": 12,
      "marks": 39,
      "storyFinishes": 28
    },
    {
      "date": "2026-10-19",
      "sessions": 114,
      "newUsers": 40,
      "bounce": 0.63,
      "avgDurationSec": 116,
      "pageViews": 265,
      "endings": 8,
      "marks": 26,
      "storyFinishes": 20
    },
    {
      "date": "2026-10-20",
      "sessions": 109,
      "newUsers": 35,
      "bounce": 0.6,
      "avgDurationSec": 97,
      "pageViews": 278,
      "endings": 6,
      "marks": 27,
      "storyFinishes": 18
    },
    {
      "date": "2026-10-21",
      "sessions": 133,
      "newUsers": 41,
      "bounce": 0.59,
      "avgDurationSec": 80,
      "pageViews": 350,
      "endings": 8,
      "marks": 34,
      "storyFinishes": 20
    },
    {
      "date": "2026-10-22",
      "sessions": 119,
      "newUsers": 46,
      "bounce": 0.52,
      "avgDurationSec": 70,
      "pageViews": 373,
      "endings": 8,
      "marks": 30,
      "storyFinishes": 18
    },
    {
      "date": "2026-10-23",
      "sessions": 129,
      "newUsers": 44,
      "bounce": 0.48,
      "avgDurationSec": 49,
      "pageViews": 356,
      "endings": 9,
      "marks": 32,
      "storyFinishes": 20
    },
    {
      "date": "2026-10-24",
      "sessions": 190,
      "newUsers": 71,
      "bounce": 0.47,
      "avgDurationSec": 59,
      "pageViews": 589,
      "endings": 13,
      "marks": 46,
      "storyFinishes": 32
    },
    {
      "date": "2026-10-25",
      "sessions": 202,
      "newUsers": 71,
      "bounce": 0.51,
      "avgDurationSec": 64,
      "pageViews": 607,
      "endings": 12,
      "marks": 51,
      "storyFinishes": 33
    },
    {
      "date": "2026-10-26",
      "sessions": 155,
      "newUsers": 51,
      "bounce": 0.53,
      "avgDurationSec": 63,
      "pageViews": 468,
      "endings": 9,
      "marks": 37,
      "storyFinishes": 25
    },
    {
      "date": "2026-10-27",
      "sessions": 155,
      "newUsers": 47,
      "bounce": 0.6,
      "avgDurationSec": 81,
      "pageViews": 490,
      "endings": 10,
      "marks": 36,
      "storyFinishes": 25
    },
    {
      "date": "2026-10-28",
      "sessions": 139,
      "newUsers": 50,
      "bounce": 0.61,
      "avgDurationSec": 102,
      "pageViews": 400,
      "endings": 9,
      "marks": 34,
      "storyFinishes": 22
    },
    {
      "date": "2026-10-29",
      "sessions": 166,
      "newUsers": 52,
      "bounce": 0.64,
      "avgDurationSec": 118,
      "pageViews": 432,
      "endings": 11,
      "marks": 38,
      "storyFinishes": 29
    },
    {
      "date": "2026-10-30",
      "sessions": 139,
      "newUsers": 49,
      "bounce": 0.64,
      "avgDurationSec": 121,
      "pageViews": 348,
      "endings": 8,
      "marks": 33,
      "storyFinishes": 21
    },
    {
      "date": "2026-10-31",
      "sessions": 173,
      "newUsers": 54,
      "bounce": 0.54,
      "avgDurationSec": 115,
      "pageViews": 472,
      "endings": 11,
      "marks": 41,
      "storyFinishes": 27
    },
    {
      "date": "2026-11-01",
      "sessions": 221,
      "newUsers": 75,
      "bounce": 0.52,
      "avgDurationSec": 106,
      "pageViews": 541,
      "endings": 13,
      "marks": 52,
      "storyFinishes": 37
    },
    {
      "date": "2026-11-02",
      "sessions": 163,
      "newUsers": 49,
      "bounce": 0.46,
      "avgDurationSec": 76,
      "pageViews": 444,
      "endings": 10,
      "marks": 39,
      "storyFinishes": 28
    },
    {
      "date": "2026-11-03",
      "sessions": 135,
      "newUsers": 43,
      "bounce": 0.48,
      "avgDurationSec": 63,
      "pageViews": 319,
      "endings": 8,
      "marks": 34,
      "storyFinishes": 20
    },
    {
      "date": "2026-11-04",
      "sessions": 153,
      "newUsers": 54,
      "bounce": 0.51,
      "avgDurationSec": 52,
      "pageViews": 461,
      "endings": 10,
      "marks": 38,
      "storyFinishes": 23
    },
    {
      "date": "2026-11-05",
      "sessions": 171,
      "newUsers": 54,
      "bounce": 0.52,
      "avgDurationSec": 47,
      "pageViews": 441,
      "endings": 12,
      "marks": 40,
      "storyFinishes": 27
    },
    {
      "date": "2026-11-06",
      "sessions": 184,
      "newUsers": 58,
      "bounce": 0.57,
      "avgDurationSec": 53,
      "pageViews": 585,
      "endings": 12,
      "marks": 42,
      "storyFinishes": 31
    },
    {
      "date": "2026-11-07",
      "sessions": 215,
      "newUsers": 77,
      "bounce": 0.64,
      "avgDurationSec": 65,
      "pageViews": 549,
      "endings": 14,
      "marks": 52,
      "storyFinishes": 33
    },
    {
      "date": "2026-11-08",
      "sessions": 186,
      "newUsers": 58,
      "bounce": 0.61,
      "avgDurationSec": 81,
      "pageViews": 549,
      "endings": 12,
      "marks": 45,
      "storyFinishes": 29
    },
    {
      "date": "2026-11-09",
      "sessions": 163,
      "newUsers": 52,
      "bounce": 0.62,
      "avgDurationSec": 100,
      "pageViews": 450,
      "endings": 10,
      "marks": 40,
      "storyFinishes": 28
    },
    {
      "date": "2026-11-10",
      "sessions": 185,
      "newUsers": 63,
      "bounce": 0.59,
      "avgDurationSec": 106,
      "pageViews": 560,
      "endings": 11,
      "marks": 45,
      "storyFinishes": 29
    },
    {
      "date": "2026-11-11",
      "sessions": 170,
      "newUsers": 57,
      "bounce": 0.5,
      "avgDurationSec": 110,
      "pageViews": 532,
      "endings": 10,
      "marks": 43,
      "storyFinishes": 29
    },
    {
      "date": "2026-11-12",
      "sessions": 164,
      "newUsers": 62,
      "bounce": 0.48,
      "avgDurationSec": 103,
      "pageViews": 420,
      "endings": 10,
      "marks": 40,
      "storyFinishes": 26
    },
    {
      "date": "2026-11-13",
      "sessions": 206,
      "newUsers": 63,
      "bounce": 0.48,
      "avgDurationSec": 100,
      "pageViews": 619,
      "endings": 13,
      "marks": 46,
      "storyFinishes": 34
    },
    {
      "date": "2026-11-14",
      "sessions": 200,
      "newUsers": 64,
      "bounce": 0.49,
      "avgDurationSec": 76,
      "pageViews": 475,
      "endings": 13,
      "marks": 49,
      "storyFinishes": 32
    },
    {
      "date": "2026-11-15",
      "sessions": 259,
      "newUsers": 95,
      "bounce": 0.54,
      "avgDurationSec": 73,
      "pageViews": 609,
      "endings": 16,
      "marks": 63,
      "storyFinishes": 42
    }
  ],
  "totals": {
    "sessions": 5005,
    "newUsers": 1681,
    "returning": 3324,
    "endings": 317,
    "pageViews": 13849,
    "marks": 1207,
    "storyFinishes": 810
  },
  "funnel": {
    "steps": [
      {
        "id": "landed",
        "labelZh": "抵达首页",
        "labelEn": "Landed",
        "count": 5005
      },
      {
        "id": "pressed-start",
        "labelZh": "按下开始",
        "labelEn": "Pressed start",
        "count": 2928
      },
      {
        "id": "in-world",
        "labelZh": "进入世界",
        "labelEn": "Entered the world",
        "count": 2386
      },
      {
        "id": "atlas-open",
        "labelZh": "打开游记/谱册",
        "labelEn": "Opened Atlas / Codex",
        "count": 1038
      },
      {
        "id": "chapter-finish",
        "labelZh": "读完一篇正文",
        "labelEn": "Finished a chapter",
        "count": 680
      },
      {
        "id": "ending",
        "labelZh": "抵达结局",
        "labelEn": "Reached an ending",
        "count": 289
      }
    ]
  },
  "channels": [
    {
      "id": "direct",
      "labelZh": "直接访问",
      "labelEn": "Direct",
      "share": 0.38,
      "endingRate": 0.079,
      "sessions": 1902
    },
    {
      "id": "github",
      "labelZh": "GitHub 仓库",
      "labelEn": "GitHub repo",
      "share": 0.21,
      "endingRate": 0.061,
      "sessions": 1051
    },
    {
      "id": "hub",
      "labelZh": "个人主页引流",
      "labelEn": "Personal hub",
      "share": 0.17,
      "endingRate": 0.098,
      "sessions": 851
    },
    {
      "id": "search",
      "labelZh": "搜索引擎",
      "labelEn": "Search",
      "share": 0.12,
      "endingRate": 0.032,
      "sessions": 601
    },
    {
      "id": "social",
      "labelZh": "社媒/论坛",
      "labelEn": "Social / forums",
      "share": 0.07,
      "endingRate": 0.044,
      "sessions": 350
    },
    {
      "id": "other",
      "labelZh": "其他",
      "labelEn": "Other",
      "share": 0.05,
      "endingRate": 0.027,
      "sessions": 250
    }
  ],
  "devices": [
    {
      "id": "mobile",
      "labelZh": "手机",
      "labelEn": "Mobile",
      "share": 0.58,
      "endingRate": 0.052,
      "avgDurationSec": 74
    },
    {
      "id": "desktop",
      "labelZh": "桌面",
      "labelEn": "Desktop",
      "share": 0.37,
      "endingRate": 0.094,
      "avgDurationSec": 132
    },
    {
      "id": "tablet",
      "labelZh": "平板",
      "labelEn": "Tablet",
      "share": 0.05,
      "endingRate": 0.061,
      "avgDurationSec": 95
    }
  ],
  "locales": [
    {
      "id": "zh",
      "labelZh": "中文",
      "labelEn": "Chinese",
      "share": 0.71
    },
    {
      "id": "en",
      "labelZh": "英文",
      "labelEn": "English",
      "share": 0.29
    }
  ],
  "hourly": [
    {
      "h": 0,
      "share": 0.0296
    },
    {
      "h": 1,
      "share": 0.0136
    },
    {
      "h": 2,
      "share": 0.0062
    },
    {
      "h": 3,
      "share": 0.0025
    },
    {
      "h": 4,
      "share": 0.0012
    },
    {
      "h": 5,
      "share": 0.0025
    },
    {
      "h": 6,
      "share": 0.0049
    },
    {
      "h": 7,
      "share": 0.0099
    },
    {
      "h": 8,
      "share": 0.0173
    },
    {
      "h": 9,
      "share": 0.0272
    },
    {
      "h": 10,
      "share": 0.0407
    },
    {
      "h": 11,
      "share": 0.0506
    },
    {
      "h": 12,
      "share": 0.058
    },
    {
      "h": 13,
      "share": 0.0556
    },
    {
      "h": 14,
      "share": 0.0506
    },
    {
      "h": 15,
      "share": 0.0469
    },
    {
      "h": 16,
      "share": 0.0444
    },
    {
      "h": 17,
      "share": 0.0432
    },
    {
      "h": 18,
      "share": 0.0506
    },
    {
      "h": 19,
      "share": 0.0679
    },
    {
      "h": 20,
      "share": 0.0938
    },
    {
      "h": 21,
      "share": 0.1
    },
    {
      "h": 22,
      "share": 0.121
    },
    {
      "h": 23,
      "share": 0.0617
    }
  ],
  "cohorts": [
    {
      "id": "W-041",
      "labelZh": "10/18 当周",
      "labelEn": "Week of Oct 18",
      "size": 812,
      "d1": 0.17,
      "d3": 0.12,
      "d7": 0.076,
      "d14": 0.048,
      "d30": 0.028
    },
    {
      "id": "W-042",
      "labelZh": "10/25 当周",
      "labelEn": "Week of Oct 25",
      "size": 733,
      "d1": 0.18,
      "d3": 0.125,
      "d7": 0.08,
      "d14": 0.052,
      "d30": 0.031
    },
    {
      "id": "W-043",
      "labelZh": "11/01 当周",
      "labelEn": "Week of Nov 01",
      "size": 905,
      "d1": 0.19,
      "d3": 0.135,
      "d7": 0.088,
      "d14": 0.058,
      "d30": 0.035
    },
    {
      "id": "W-044",
      "labelZh": "11/08 前半段",
      "labelEn": "Early Nov (1st half)",
      "size": 1021,
      "d1": 0.2,
      "d3": 0.142,
      "d7": 0.096,
      "d14": 0.063,
      "d30": null
    },
    {
      "id": "W-045",
      "labelZh": "11/09 当周",
      "labelEn": "Week of Nov 09",
      "size": 945,
      "d1": 0.22,
      "d3": 0.158,
      "d7": 0.108,
      "d14": null,
      "d30": null
    },
    {
      "id": "W-046",
      "labelZh": "11/15 当周",
      "labelEn": "Week of Nov 15",
      "size": 1105,
      "d1": 0.24,
      "d3": 0.171,
      "d7": null,
      "d14": null,
      "d30": null
    }
  ],
  "pages": [
    {
      "path": "/",
      "labelZh": "游戏入口",
      "labelEn": "Game entry",
      "views": 5305,
      "avgTimeSec": 38,
      "bounce": 0.63,
      "exitShare": 0.34,
      "rageClicks": 187
    },
    {
      "path": "/tutorial/",
      "labelZh": "入门教程",
      "labelEn": "Tutorial",
      "views": 1166,
      "avgTimeSec": 244,
      "bounce": 0.31,
      "exitShare": 0.08,
      "rageClicks": 24
    },
    {
      "path": "/cast/",
      "labelZh": "角色图鉴",
      "labelEn": "Cast roster",
      "views": 640,
      "avgTimeSec": 128,
      "bounce": 0.44,
      "exitShare": 0.06,
      "rageClicks": 12
    },
    {
      "path": "/codex/",
      "labelZh": "世界谱",
      "labelEn": "World codex",
      "views": 512,
      "avgTimeSec": 176,
      "bounce": 0.47,
      "exitShare": 0.09,
      "rageClicks": 96
    },
    {
      "path": "/story/",
      "labelZh": "《盐》",
      "labelEn": "Story · Salt",
      "views": 1468,
      "avgTimeSec": 402,
      "bounce": 0.29,
      "exitShare": 0.07,
      "rageClicks": 31
    },
    {
      "path": "/story/ledger/",
      "labelZh": "《账本》",
      "labelEn": "Story · The Ledger",
      "views": 402,
      "avgTimeSec": 118,
      "bounce": 0.38,
      "exitShare": 0.11,
      "rageClicks": 213
    },
    {
      "path": "/story/first-bell/",
      "labelZh": "《第一钟》",
      "labelEn": "Story · The First Bell",
      "views": 388,
      "avgTimeSec": 342,
      "bounce": 0.33,
      "exitShare": 0.1,
      "rageClicks": 18
    },
    {
      "path": "/story/tribunal/",
      "labelZh": "《雨审判》",
      "labelEn": "Story · The Rain Tribunal",
      "views": 301,
      "avgTimeSec": 388,
      "bounce": 0.31,
      "exitShare": 0.05,
      "rageClicks": 15
    },
    {
      "path": "/story/frostbell/",
      "labelZh": "《霜锤》",
      "labelEn": "Story · The Frost Hammer",
      "views": 240,
      "avgTimeSec": 297,
      "bounce": 0.36,
      "exitShare": 0.06,
      "rageClicks": 9
    },
    {
      "path": "/console/",
      "labelZh": "调度台（运维）",
      "labelEn": "Console (ops)",
      "views": 686,
      "avgTimeSec": 61,
      "bounce": 0.71,
      "exitShare": 0.19,
      "rageClicks": 41
    },
    {
      "path": "/admin/",
      "labelZh": "后台观察站",
      "labelEn": "Admin observatory",
      "views": 96,
      "avgTimeSec": 162,
      "bounce": 0.78,
      "exitShare": 0.05,
      "rageClicks": 2
    }
  ]
}
