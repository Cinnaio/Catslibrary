import { describe, expect, it } from 'vitest'
import { flattenReaderSettings, mergeReaderSettingsDocument, normalizeReaderDevice, parseSettingsDocument, type ReaderSettings } from './reader-settings'

describe('reader-settings device scopes', () => {
  it('识别 ios 分区，未知设备保持 desktop 兼容行为', () => {
    expect(normalizeReaderDevice('ios')).toBe('ios')
    expect(normalizeReaderDevice('mobile')).toBe('mobile')
    expect(normalizeReaderDevice(undefined)).toBe('desktop')
    expect(normalizeReaderDevice('unknown')).toBe('desktop')
  })

  it('首次拆分继承 mobile，持久化后 mobile 与 ios 双向隔离且保留 LWW', () => {
    const legacy = parseSettingsDocument(JSON.stringify({
      version: 2,
      devices: { mobile: { values: { fontSize: '4' }, updatedAt: { fontSize: 100 } } },
    }))
    expect(flattenReaderSettings(legacy, 'ios')).toEqual(flattenReaderSettings(legacy, 'mobile'))

    const mobileChanged = mergeReaderSettingsDocument(legacy, 'mobile', {
      values: { fontSize: '5' }, updatedAt: { fontSize: 200 },
    })
    const saved = parseSettingsDocument(JSON.stringify(mobileChanged))
    expect(flattenReaderSettings(saved, 'ios').values.fontSize).toBe('4')
    const iosChanged = mergeReaderSettingsDocument(saved, 'ios', {
      values: { fontSize: '1', contentMode: 'adult' }, updatedAt: { fontSize: 300, contentMode: 300 },
    })
    expect(flattenReaderSettings(iosChanged, 'mobile').values).toEqual({ fontSize: '5', contentMode: 'adult' })
    expect(flattenReaderSettings(iosChanged, 'desktop').values).toEqual({ contentMode: 'adult' })
    expect(flattenReaderSettings(iosChanged, 'ios').values).toEqual({ fontSize: '1', contentMode: 'adult' })
    const stale = mergeReaderSettingsDocument(iosChanged, 'ios', {
      values: { fontSize: '2' }, updatedAt: { fontSize: 250 },
    })
    expect(flattenReaderSettings(parseSettingsDocument(JSON.stringify(stale)), 'ios').values.fontSize).toBe('1')
  })

  it('把旧版扁平设置迁移到 desktop，并把 contentMode 提升为共享设置', () => {
    const state = parseSettingsDocument(JSON.stringify({ values: { fontSize: '4', contentMode: 'adult' }, updatedAt: { fontSize: 100, contentMode: 100 } }))

    expect(flattenReaderSettings(state, 'desktop').values).toEqual({ fontSize: '4', contentMode: 'adult' })
    expect(flattenReaderSettings(state, 'mobile').values).toEqual({ contentMode: 'adult' })
  })

  it('只合并当前设备的设置，共享设置仍可独立合并', () => {
    const current = parseSettingsDocument(
      JSON.stringify({
        version: 2,
        devices: {
          desktop: { values: { fontSize: '1' }, updatedAt: { fontSize: 100 } },
          mobile: { values: { fontSize: '4' }, updatedAt: { fontSize: 100 } },
        },
        shared: { values: { contentMode: 'safe' }, updatedAt: { contentMode: 100 } },
      }),
    )
    const incoming: ReaderSettings = {
      values: { fontSize: '5', readerTheme: 'paper', contentMode: 'adult' },
      updatedAt: { fontSize: 200, readerTheme: 200, contentMode: 200 },
    }

    const merged = mergeReaderSettingsDocument(current, 'mobile', incoming)
    expect(flattenReaderSettings(merged, 'desktop').values).toEqual({ fontSize: '1', contentMode: 'adult' })
    expect(flattenReaderSettings(merged, 'mobile').values).toEqual({ fontSize: '5', readerTheme: 'paper', contentMode: 'adult' })
  })
})
