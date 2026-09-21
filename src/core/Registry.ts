export class Registry {
  private data = new Map<string, unknown>()
  private resources = new Map<string, Promise<unknown>>()

  register<T>(id: string, value: T): void {
    if (this.data.has(id)) throw new Error(`Registry: duplicate id "${id}"`)
    this.data.set(id, value)
  }

  get<T>(id: string): T {
    const v = this.data.get(id)
    if (v === undefined) throw new Error(`Registry: missing id "${id}"`)
    return v as T
  }

  maybeGet<T>(id: string): T | undefined { return this.data.get(id) as T | undefined }
  has(id: string): boolean { return this.data.has(id) }
  ids(prefix = ''): string[] {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix))
  }

  /** async resource loading injected by render layer (keeps core three-free) */
  load(url: string, loader: (url: string) => Promise<unknown>): Promise<unknown> {
    let p = this.resources.get(url)
    if (!p) { p = loader(url); this.resources.set(url, p) }
    return p
  }
}

export const registry = new Registry()
