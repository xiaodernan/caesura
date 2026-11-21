import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(fileURLToPath(new URL('../../' + rel, import.meta.url)), 'utf8')

describe('CI 双轨（KI-722）', () => {
  it('GitHub-hosted 主门禁仍在，不被 self-hosted 取代', () => {
    const yml = read('.github/workflows/check.yml')
    expect(yml).toContain('runs-on: ubuntu-latest')
    expect(yml).toContain('npm test')
    expect(yml).toContain('npm run build')
  })

  it('本机 self-hosted Windows 门禁在本仓库内，且真跑账本自证与四门', () => {
    const yml = read('.github/workflows/local-gate.yml')
    expect(yml).toContain('runs-on: [self-hosted, Windows, X64]')
    expect(yml).toContain('npm run status:embed -- --check')
    expect(yml).toContain('doc-audit.test.ts')
    expect(yml).toContain('decl-parity.test.ts')
    expect(yml).toContain('import-targets.test.ts')
    expect(yml).toContain('phase-status.test.ts')
    expect(yml).toContain('ledger-rules.test.ts')
    expect(yml).toContain('npm run build')
    // 本机门禁不许绕过 hook 或跳过 hook 标志
    expect(yml).not.toContain('--no-verify')
  })
})
