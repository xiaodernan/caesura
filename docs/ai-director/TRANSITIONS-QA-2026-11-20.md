# AI 导演 · 流转 QA · TRANSITIONS-QA 2026-11-20

- mode: `live` ｜ source: ai-director-latest.json @ 2026-11-19T17:35:49.707Z ｜ corpus: 11814 chunks
- LLM calls: 1 ｜ cached_tokens: 0 ｜ statuses: [200]
- 名册：dialogue flags 33 面 · quest lines 7 条

## 裁决（LLM canon gate judge · 顺序同提案）
```json
[
  {
    "flag": "flag.boat_page_left_in_place",
    "canonFit": "canon",
    "conflicts": [],
    "notesZh": "与船边一页留在原处且不替其决定去向的既有描写一致。",
    "notesEn": "Matches the page remaining in place without deciding its destination."
  },
  {
    "flag": "flag.thin_ledger_left_unrecorded",
    "canonFit": "canon",
    "conflicts": [],
    "notesZh": "与薄簿合着、页角自翻且不补记的既有描写一致。",
    "notesEn": "Matches the closed ledger, self-turning page, and deliberate lack of recording."
  },
  {
    "flag": "flag.hull_mark_left_unmeasured",
    "canonFit": "canon",
    "conflicts": [],
    "notesZh": "与干痕随潮显露覆没且阿汐不触碰、不追记的描写一致。",
    "notesEn": "Matches the hull mark being covered again and left unmeasured or recorded."
  },
  {
    "flag": "flag.threshold_seam_left_open",
    "canonFit": "new-canon",
    "requiresHumanReview": true,
    "conflicts": [],
    "notesZh": "门未关与既有描写一致，但风自行进出是新增细节。",
    "notesEn": "The open door is supported; wind passing through is newly introduced detail."
  }
]
```

## 图检查点
- ✓ load · 113ms
- ✓ retrieve · 859ms
- ✓ judge · 35370ms
- ✓ writeArtifacts · 53ms

## 错误
- 无

> 本报告由 `scripts/ai-director-transitions-qa.mjs` 机器生成；任何内容未经人工审核不进运行时数据。
