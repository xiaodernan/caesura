import type { WeatherRow } from '@/data/schema'
import { weatherRows } from '@/data'

/**
 * §5.9.33③ 天气的**玩法三腿**读数层（逻辑层，不 import three；与 `world/Lighting.ts` 同族）。
 *
 * `weather.json` 一行今天有两半读者：画面那半（`fogDensity`/`brightnessMul`/`contrastMul`）归
 * `vfx/ColorGrade.ts`，玩法这半（`gameplay`）归这里。两半**不许合成一个仲裁者**——画面层不认识
 * 区域，玩法层不认识名字从哪来（那是 `world/WeatherSwitch.ts` 的事）。
 *
 * 三腿的落点（谁真的在读这三个数）：
 *  · `concentrationMul` → `world/SpawnDirector.ts`：进格落位时组内铺开半径 ÷ 它；
 *  · `corruptionMul`    → `combat/Statuses.ts > CorruptionMeter`：累积那一乘里的一份；
 *  · `ambienceGain`     → `audio/ambient-field.ts > AmbienceField`：每一声的距离衰减再乘它。
 *
 * **缺省一律是 1（中性），不是"继承基线"**：认不出的天气名 ⇒ null ⇒ 三腿全 1。这与 `ColorGrade`
 * 的"落回基线行"在今天的表上**结果相同**（判据 G4 钉着基线行不许声明 `gameplay`），但理由不同——
 * 那边退路是"画面上总得有个样子"，这边退路是"没有裁决过的乘数不许生效"。
 */

/** 三腿的中性值。抽成常量是为了让"缺省即中性"这句话在源码里有一个可被指认的主人 */
const NEUTRAL_MUL = 1

/** 天气名 → 行；认不出来（没有这一格天气）返回 null（调用方按三腿全中性走） */
export function weatherRowOf(name: string | null | undefined): WeatherRow | null {
  if (!name) return null
  return weatherRows.find((r) => r.id === name) ?? null
}

/** 这一格声明的玩法三腿（没声明 ⇒ 三格全 undefined） */
function gameplayOf(row: WeatherRow | null | undefined): WeatherRow['gameplay'] {
  return row?.gameplay
}

/** 敌人浓度乘数：`SpawnDirector` 拿它除组内铺开半径。缺省 1 = 按数据写的半径铺开 */
export function concentrationMul(row: WeatherRow | null | undefined): number {
  return gameplayOf(row)?.concentrationMul ?? NEUTRAL_MUL
}

/** 失谐累积速率乘数：`CorruptionMeter` 的环境暴露与精英命中两条路都乘它。缺省 1 = 不加速 */
export function corruptionMul(row: WeatherRow | null | undefined): number {
  return gameplayOf(row)?.corruptionMul ?? NEUTRAL_MUL
}

/** 声景层增益乘数：`AmbienceField` 每一声的距离衰减再乘它。缺省 1 = 不放大 */
export function ambienceGain(row: WeatherRow | null | undefined): number {
  return gameplayOf(row)?.ambienceGain ?? NEUTRAL_MUL
}
