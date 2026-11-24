import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { allGearItems } from '@/rpg/Loot'
import { ATTR_KEYS } from '@/rpg/Progression'
import { getLang, setLang, t, toTraditional } from '@/i18n/Lang'
import { titleCards } from '@/ui/TitleScreen'
import type { ProgressionData } from '@/data/schema'

registerGameData()

afterEach(() => setLang('zh'))

const cjk = /[\u3400-\u9fff]/

describe('KI-746 · 标题出身卡双语', () => {
  it('英文五张卡的姓名、简介、武器、六维与被动都没有中文或未解析键', () => {
    setLang('en')
    const cards = titleCards()
    expect(cards).toHaveLength(5)
    for (const card of cards) {
      const text = [card.name, card.blurb, card.weaponName, ...card.attrs.map((a) => a.label), card.passive ?? ''].join('\n')
      expect(text, card.id).not.toMatch(cjk)
      expect(text, card.id).not.toMatch(/(?:origin|weapon|attr)\.[a-zA-Z.]+/)
    }
    expect(cards.find((c) => c.id === 'origin_scavenger')?.passive).toBeTruthy()
  })

  it('英文逐格读 nameKey，简介与被动由出身 nameKey 派生', () => {
    setLang('en')
    const d = registry.get<ProgressionData>('progression')
    const cards = titleCards()
    for (let i = 0; i < d.origins.length; i++) {
      const origin = d.origins[i]
      const card = cards[i]
      const gear = allGearItems().find((item) => item.gear?.weaponId === origin.weaponId)!
      expect(card.name).toBe(t(origin.nameKey))
      expect(card.blurb).toBe(t(`${origin.nameKey}.blurb`))
      expect(card.weaponName).toBe(t(gear.nameKey))
      expect(card.attrs.map((a) => a.label)).toEqual(ATTR_KEYS.map((key) => {
        const attr = d.attrs.find((row) => row.key === key)!
        return t(attr.nameKey)
      }))
      expect(card.passive).toBe(origin.passive ? t(`${origin.nameKey}.passive`) : null)
    }
  })

  it('繁体卡面仍从原始数据现读并即时转换', () => {
    setLang('zh-TW')
    const d = registry.get<ProgressionData>('progression')
    const cards = titleCards()
    for (let i = 0; i < d.origins.length; i++) {
      const origin = d.origins[i]
      const gear = allGearItems().find((item) => item.gear?.weaponId === origin.weaponId)!
      expect(cards[i].name).toBe(toTraditional(origin.displayName))
      expect(cards[i].blurb).toBe(toTraditional(origin.blurb ?? ''))
      expect(cards[i].weaponName).toBe(toTraditional(gear.displayName))
      expect(cards[i].attrs.map((a) => a.label)).toEqual(d.attrs.map((a) => toTraditional(a.displayName)))
      expect(cards[i].passive).toBe(origin.passive ? toTraditional(origin.passive.label) : null)
    }
  })

  it('简体中文仍让可变原始字段直接上脸', () => {
    setLang('zh')
    const d = registry.get<ProgressionData>('progression')
    const origin = d.origins.find((row) => row.id === 'origin_scavenger')!
    const gear = allGearItems().find((item) => item.gear?.weaponId === origin.weaponId)!
    const attr = d.attrs[0]
    const backup = [origin.displayName, origin.blurb, origin.passive!.label, gear.displayName, attr.displayName]
    try {
      origin.displayName = '临时出身'
      origin.blurb = '临时简介'
      origin.passive!.label = '临时被动'
      gear.displayName = '临时武器'
      attr.displayName = '临时属性'
      const card = titleCards().find((row) => row.id === origin.id)!
      expect(card.name).toBe('临时出身')
      expect(card.blurb).toBe('临时简介')
      expect(card.passive).toBe('临时被动')
      expect(card.weaponName).toBe('临时武器')
      expect(card.attrs[0].label).toBe('临时属性')
    } finally {
      origin.displayName = backup[0]
      origin.blurb = backup[1]
      origin.passive!.label = backup[2]
      gear.displayName = backup[3]
      attr.displayName = backup[4]
    }
  })

  it('合成表缺简介、武器、被动与属性元数据时保留安静回落', () => {
    setLang('en')
    const data = (registry as unknown as { data: Map<string, unknown> }).data
    const base = registry.get<ProgressionData>('progression')
    const previous = data.get('progression')
    data.set('progression', {
      ...base,
      attrs: [],
      origins: [{ id: 'origin_bare', displayName: '素衣', weaponId: 'wp_not_in_the_table', attrs: {} }]
    })
    try {
      const card = titleCards()[0]
      expect(getLang()).toBe('en')
      expect(card.name).toBe('素衣')
      expect(card.blurb).toBe('')
      expect(card.weaponName).toBe('wp_not_in_the_table')
      expect(card.passive).toBeNull()
      expect(card.attrs.map((a) => a.label)).toEqual(ATTR_KEYS)
    } finally {
      data.set('progression', previous)
    }
  })
})
