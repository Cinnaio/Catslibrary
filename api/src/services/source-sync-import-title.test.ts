import { expect, it } from 'vitest'
import { sourceSyncTestHelpers } from './source-sync'

it('裸数字双编号使用作者内层编号，破折号排版差异不应造成目录漏配', () => {
  const helpers = sourceSyncTestHelpers()
  expect(helpers.chapterNumber('0047 46.风雪之后的重逢')).toBe(46)
  expect(helpers.chapterNumber('38 36.5 论坛番外')).toBe(38)
  expect(helpers.normalizedTitle('0047 46.风雪之后——“归途”')).toBe(helpers.normalizedTitle('46.风雪之后“归途”'))
  const p = helpers.buildPreview(
    [{ key: 'source', order: 47, title: '46.风雪之后——“归途”', url: 'https://source.example/books/1/articles/47' }],
    [{ id: 'local', order: 46, title: '0047 46.风雪之后“归途”' }],
    { title: '', author: '', description: '', coverUrl: '', category: '', categories: [], status: '', sourceUrl: '' },
    true,
    { runId: 'run', bindingId: 'binding', novelId: 'novel', site: 'fixture', sourceUrl: '' },
    [],
  )
  expect(p.matchedSourceCount).toBe(1)
  expect(p.unmatchedLocal).toHaveLength(0)
  expect(p.mappings[0]?.matchReason).toBe('exact-title')
})
