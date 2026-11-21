export interface EndlessDefaults {
  readonly seed: number
  readonly sectors: number
  readonly startDepth: number
  readonly flagsPerSector: number
  readonly marksPerSector: number
}
export declare const ENDLESS_DEFAULTS: Readonly<EndlessDefaults>

export interface EndlessMark {
  id: string
  zh: string
  en: string
}
export interface EndlessFlag {
  flag: string
  fromZh: string
  fromEn: string
  toZh: string
  toEn: string
  narrativeZh: string
  narrativeEn: string
  atlasHookZh: string
  atlasHookEn: string
  canonEvidence: string
}
export interface EndlessSector {
  id: string
  depth: number
  seed: number
  titleZh: string
  titleEn: string
  soundZh: string
  soundEn: string
  guideZh: string
  guideEn: string
  personZh: string
  personEn: string
  marks: EndlessMark[]
  flags: EndlessFlag[]
  nextDepth: number
}
export interface EndlessWorldData {
  schema: number
  seed: number
  startDepth: number
  generatedCount: number
  sectors: EndlessSector[]
  entries: unknown[]
}
export declare function generateSector(seed: number, depth: number, opts?: {
  marksPerSector?: number
  flagsPerSector?: number
}): EndlessSector
export declare function generateWorld(opts?: {
  seed?: number
  sectors?: number
  startDepth?: number
  marksPerSector?: number
  flagsPerSector?: number
}): EndlessWorldData
export declare function endlessEchoFlowEntries(world: { sectors: EndlessSector[] }): Array<Record<string, any>>
export interface EndlessStudy {
  seed: number
  sectors: number
  marksPerSector: number
  flagsPerSector: number
  entries: number
  uniqueFlags: number
  distinctNext: boolean
  hasGuide: boolean
  noEmptySector: boolean
  deterministic: boolean
  sound: boolean
}
export declare function endlessWorldStudy(opts?: {
  seed?: number
  sectors?: number
  startDepth?: number
}): EndlessStudy
