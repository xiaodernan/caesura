/**
 * 存档防损坏（需求 §45；technical-architecture §2 save/Integrity.ts）。
 * 三件事：magic+版本头、CRC32 校验和、双写交换（rename 语义）。
 * 读档校验失败 ⇒ 调用方回退到上一份并提示，绝不让半截 JSON 变成一次「读档即坏档」。
 */

export const MAGIC = 'CAESURA-SAVE'

export interface Envelope {
  magic: string
  schemaVersion: number
  crc: number
  payload: unknown
}

/** 标准 CRC32（查表，无依赖）——只用于「这份字节没被截断/改坏」，不是密码学校验 */
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(text: string): number {
  let c = 0xffffffff
  for (let i = 0; i < text.length; i++) c = TABLE[(c ^ text.charCodeAt(i)) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function wrap(schemaVersion: number, payload: unknown): string {
  const body = JSON.stringify(payload)
  const env: Envelope = { magic: MAGIC, schemaVersion, crc: crc32(body), payload }
  return JSON.stringify(env)
}

export type UnwrapResult =
  | { ok: true; schemaVersion: number; payload: unknown }
  | { ok: false; reason: 'parse' | 'magic' | 'version' | 'crc' }

/** 任何一步不合格都返回 ok:false，由调用方决定回退到哪一份 */
export function unwrap(raw: string, supportedVersions: number[]): UnwrapResult {
  let env: Envelope
  try {
    env = JSON.parse(raw) as Envelope
  } catch {
    return { ok: false, reason: 'parse' }
  }
  if (!env || env.magic !== MAGIC) return { ok: false, reason: 'magic' }
  if (!supportedVersions.includes(env.schemaVersion)) return { ok: false, reason: 'version' }
  const body = JSON.stringify(env.payload)
  if (crc32(body) !== env.crc) return { ok: false, reason: 'crc' }
  return { ok: true, schemaVersion: env.schemaVersion, payload: env.payload }
}
