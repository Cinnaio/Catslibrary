import { describe, expect, it } from 'vitest'
import type { SupplementaryFile } from '@shared/supplementary-source'
import { pruneStaleVersions } from './supplementary-source'

const file = (folder: string, revision: number, stale: boolean): SupplementaryFile => ({
  key: `${folder}-${revision}`,
  url: `https://www.ilanzou.com/s/bTPy1rOoO?fileId=${revision}`,
  name: `[更${revision}]《恶毒女配》作者：汐蝶.txt`,
  folder,
  size: '908 K',
  title: '恶毒女配',
  author: '汐蝶',
  revision,
  stale,
})

describe('附加源旧版本保留', () => {
  it('每本书只留最新两个过期版本，未过期整批保留', () => {
    const files = [file('11.22', 10, false), file('11.21', 9, true), file('11.20', 8, true), file('11.19', 7, true)]
    expect(pruneStaleVersions(files).map((f) => f.folder)).toEqual(['11.22', '11.21', '11.20'])
    expect(pruneStaleVersions(files)).toHaveLength(3)
  })
})
