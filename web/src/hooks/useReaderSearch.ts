import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { findStoryEchoMatches } from '@shared/story-echoes'
import { hashParagraphText } from '@shared/thought-anchor'
import { BOOK_SEARCH_MAX_QUERY, findBookMatches } from '@shared/book-search'

/** CSS ranges preserve text nodes, selection, paragraph anchors and thought highlights. */
export function useReaderSearch({ body, ready, chapterId, loading, content, pageMode, onLocate }: {
  body: RefObject<HTMLDivElement | null>; ready: RefObject<boolean>; chapterId: string
  loading: boolean; content: string; pageMode: boolean; onLocate: (range: Range) => void
}) {
  const [params, setParams] = useSearchParams()
  const { key: locationKey } = useLocation()
  const echoHash = params.get('echoHash') || ''
  const query = (params.get('find') || '').trim().slice(0, echoHash ? 200 : BOOK_SEARCH_MAX_QUERY)
  const echoParagraph = Number(params.get('echoParagraph'))
  const ranges = useRef<Range[]>([])
  const locateRef = useRef(onLocate)
  useLayoutEffect(() => { locateRef.current = onLocate }, [onLocate])
  const [position, setPosition] = useState({ total: 0, index: 0 })
  function locate(index: number) {
    if (!ranges.current.length) return
    const next = (index + ranges.current.length) % ranges.current.length
    locateRef.current(ranges.current[next]!)
    setPosition({ total: ranges.current.length, index: next })
  }
  useEffect(() => {
    ranges.current = []
    let frame = 0, cancelled = false, firstFrame = true
    const fallback = new Set<HTMLElement>()
    function apply() {
      if (cancelled) return
      if (firstFrame) { setPosition({ total: 0, index: 0 }); firstFrame = false }
      if (!query || loading || !chapterId) return
      if (!ready.current || !body.current) { frame = requestAnimationFrame(apply); return }
      const root = body.current
      let echoParagraphs: HTMLElement[] | null = null
      if (echoHash) {
        const paragraphs = Array.from(root.querySelectorAll<HTMLElement>('p'))
        const matching = paragraphs.filter(element => element.dataset.paragraphHash === echoHash || hashParagraphText(element.textContent || '') === echoHash)
        const groups = new Map<string | HTMLElement, HTMLElement[]>()
        for (const element of matching) {
          const key = element.dataset.sourceParagraphHash === echoHash && element.dataset.sourceParagraphIndex !== undefined ? `source:${element.dataset.sourceParagraphIndex}` : element
          groups.set(key, [...(groups.get(key) || []), element])
        }
        const indexed = [...groups.values()].find(group => group.some(element =>
          Number((element.dataset.sourceParagraphHash === echoHash ? element.dataset.sourceParagraphIndex : undefined) ?? element.dataset.paragraphIndex ?? paragraphs.indexOf(element)) === echoParagraph))
        echoParagraphs = indexed || (groups.size === 1 ? [...groups.values()][0]! : null)
        // A changed or ambiguous source must not jump to an identical quote elsewhere.
        if (!echoParagraphs) return
      }
      const syntheticContinuation = !!echoParagraphs && echoParagraphs.length > 1
        && hashParagraphText(echoParagraphs.map(element => element.textContent || '').join('')) === echoHash
      const nodes: { node: Text; start: number; end: number }[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let text = '', previousBlock: Element | null = null
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const block = node.parentElement?.closest<HTMLElement>('p,blockquote') || null
        if (echoParagraphs && (!block || !echoParagraphs.includes(block))) continue
        if (nodes.length && block !== previousBlock && !syntheticContinuation) text += '\n'
        const start = text.length; text += node.data
        nodes.push({ node, start, end: text.length }); previousBlock = block
      }
      for (const match of (echoHash ? findStoryEchoMatches(text, query) : findBookMatches(text, query)).slice(0, 1000)) {
        const first = nodes.find(entry => entry.end > match.start)
        const last = nodes.find(entry => entry.end >= match.end)
        if (!first || !last) continue
        const range = new Range()
        range.setStart(first.node, match.start - first.start); range.setEnd(last.node, match.end - last.start)
        ranges.current.push(range)
      }
      if (typeof Highlight !== 'undefined' && CSS.highlights) CSS.highlights.set('book-search', new Highlight(...ranges.current))
      else for (const range of ranges.current) {
        const element = range.startContainer.parentElement?.closest<HTMLElement>('p,blockquote')
        if (element) { element.dataset.searchMatch = 'true'; fallback.add(element) }
      }
      setPosition({ total: ranges.current.length, index: 0 })
      if (ranges.current[0]) locateRef.current(ranges.current[0])
    }
    frame = requestAnimationFrame(apply)
    return () => {
      cancelled = true; cancelAnimationFrame(frame); ranges.current = []
      if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete('book-search')
      fallback.forEach(element => { delete element.dataset.searchMatch })
    }
  }, [query, echoHash, echoParagraph, chapterId, loading, content, pageMode, body, ready, locationKey])
  return { query, ...position, locate, close: () => setParams(previous => {
    const next = new URLSearchParams(previous); next.delete('find'); next.delete('echoHash'); next.delete('echoParagraph'); return next
  }, { replace: true }) }
}
