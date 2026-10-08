import { describe, expect, it } from 'vitest'
import { weatherRows } from '@/data'
import type { WeatherRow } from '@/data/schema'
import { ambienceGain, concentrationMul, corruptionMul, weatherRowOf } from '@/world/WeatherEffects'

/**
 * §5.9.33③ 天气玩法三腿的**读数层**（`world/WeatherEffects.ts`）。
 *
 * 这一份量的只有一件事：`weather.json > gameplay` 那三颗乘数，经过这个模块之后变成三个数，
 * 而**没声明的那几格一律是 1**。1 而不是 0 是这条腿的全部要点——0 会把一条腿静默关掉，
 * 而"这一腿不生效"的正确写法是不写那一格（缺省即 1）。
 *
 * 三个数各自的下游（`SpawnDirector` / `CorruptionMeter` / `AmbienceField`）不在这里重复量，
 * 那份在 `tests/flow/weather-gameplay.test.ts`：这里只对账"表 → 读数"这一跳。
 */

/** 一行只有 id/docWeather 的假行：用来量"没有 gameplay"时的缺省 */
const bare = (patch: Partial<WeatherRow> = {}): WeatherRow => ({ id: 'x', docWeather: 'clear', ...patch })

describe('天气玩法三腿：读数与缺省', () => {
  it('真表上 dissonant-storm 的三腿都是 1.5，而 clear 三腿全 1（缺省即中性）', () => {
    const storm = weatherRowOf('dissonant-storm')
    expect(storm, '真表里没有 dissonant-storm 这一行：下面每一个 1.5 都失去了着落').not.toBeNull()
    expect(concentrationMul(storm)).toBe(1.5)
    expect(corruptionMul(storm)).toBe(1.5)
    expect(ambienceGain(storm)).toBe(1.5)

    const clear = weatherRowOf('clear')
    expect(clear).not.toBeNull()
    expect(concentrationMul(clear)).toBe(1)
    expect(corruptionMul(clear)).toBe(1)
    expect(ambienceGain(clear)).toBe(1)
  })

  it('真表每一行的三个读数都从这个模块出（表与读者之间没有第二份口径）', () => {
    expect(weatherRows.length, '底是空表 = 下面这一趟什么都没走').toBeGreaterThan(0)
    for (const row of weatherRows) {
      expect(concentrationMul(row), `${row.id} 的浓度读数与表里那一格不一致`).toBe(row.gameplay?.concentrationMul ?? 1)
      expect(corruptionMul(row), `${row.id} 的失谐速率读数与表里那一格不一致`).toBe(row.gameplay?.corruptionMul ?? 1)
      expect(ambienceGain(row), `${row.id} 的声景增益读数与表里那一格不一致`).toBe(row.gameplay?.ambienceGain ?? 1)
    }
  })

  it('认不出的名字 ⇒ null，而 null 的三腿全中性（没有裁决过的乘数不许生效）', () => {
    for (const name of [null, undefined, '', 'still', 'dissonant_storm', 'Dissonant-Storm']) {
      expect(weatherRowOf(name), `'${name}' 不该读出任何一行`).toBeNull()
    }
    for (const row of [null, undefined, bare()]) {
      expect(concentrationMul(row)).toBe(1)
      expect(corruptionMul(row)).toBe(1)
      expect(ambienceGain(row)).toBe(1)
    }
  })

  it('只声明一格时另两格仍是 1：缺省不是 0（0 会把那条腿静默关掉）', () => {
    const row = bare({ gameplay: { ambienceGain: 2 } })
    expect(ambienceGain(row)).toBe(2)
    expect(concentrationMul(row)).toBe(1)
    expect(corruptionMul(row)).toBe(1)
  })
})
