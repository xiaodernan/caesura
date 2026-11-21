# AI 导演 · 流转 QA · TRANSITIONS-QA 2026-11-21

- mode: `live` ｜ source: ai-director-latest.json @ 2026-11-21T10:36:39.751Z ｜ corpus: 11975 chunks
- LLM calls: 1 ｜ cached_tokens: 0 ｜ statuses: [200]
- 名册：dialogue flags 33 面 · quest lines 7 条

## 裁决（LLM canon gate judge · 顺序同提案）
```json
[
  {
    "flag": "flag.door_bowl_water_left",
    "canonFit": "new-canon",
    "conflicts": [],
    "notesZh": "既有片段写碗中无水；添水是新状态，需人工审核。",
    "notesEn": "The cited canon shows the bowl empty; adding water introduces a new state.",
    "requiresHumanReview": true
  },
  {
    "flag": "flag.threshold_salt_set_by_bowl",
    "canonFit": "new-canon",
    "conflicts": [],
    "notesZh": "既有片段写盐在门槛或原处；移至碗旁是新位置，需人工审核。",
    "notesEn": "Moving the salt beside the bowl is a new location not established by the cited canon.",
    "requiresHumanReview": true
  },
  {
    "flag": "flag.boat_page_brought_inside",
    "canonFit": "new-canon",
    "conflicts": [],
    "notesZh": "既有片段写页留在船边；带回门内是新转移，未见明确矛盾，需人工审核。",
    "notesEn": "Bringing the page indoors is a new transition; the cited passages do not establish it.",
    "requiresHumanReview": true
  },
  {
    "flag": "flag.door_closed_for_one_night",
    "canonFit": "new-canon",
    "conflicts": [],
    "notesZh": "既有片段提及门缝与风，但未写合门一夜；此状态需人工审核。",
    "notesEn": "The canon mentions the door gap and wind, but not closing the door for one night.",
    "requiresHumanReview": true
  }
]
```

## 图检查点
- ✓ load · 6ms
- ✓ retrieve · 417ms
- ✓ judge · 8499ms
- ✓ writeArtifacts · 5ms

## 错误
- 无

> 本报告由 `scripts/ai-director-transitions-qa.mjs` 机器生成；任何内容未经人工审核不进运行时数据。
