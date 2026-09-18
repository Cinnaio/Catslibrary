import { describe, expect, it } from 'vitest'
import { flattenReaderSettings, mergeReaderSettingsDocument, parseSettingsDocument, type ReaderSettings } from './reader-settings'

describe('reader-settings device scopes', () => {
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
