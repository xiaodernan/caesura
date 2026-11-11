/** `scripts/redis-protocol-rules.mjs` 的声明：RESP 协议编解码。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。
 */

export function parseCommand(text: string): { args: string[] } | null
export function parseOne(text: string): { value: unknown; rest: string } | null
export function parseArray(text: string): { value: unknown[]; rest: string } | null
export function parseBulkString(text: string): { value: string | null; rest: string } | null
export function parseInteger(text: string): number | null
export function parseSimpleString(text: string): string | null
export function parseErrorString(text: string): string | null
export function buildSimpleString(s: string): string
export function buildError(msg: string): string
export function buildInteger(n: number): string
export function buildBulkString(s: string | null): string
export function buildArray(arr: ReadonlyArray<unknown>): string
