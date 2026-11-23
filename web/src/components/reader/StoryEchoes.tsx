import { useEffect, useRef, useState } from 'react'
import type { StoryEchoInput, StoryEchoResponse, StoryEchoSource } from '@shared/story-echoes'
import { CHARACTER_CLUE_LABELS, type CharacterClue, type CharacterCardResponse } from '@shared/character-cards'
import { getToken, type ApiError } from '@/lib/api'
import { getStorageScope } from '@/lib/storage'
import { findCharacterCard, findStoryEchoes } from '@/lib/story-echoes'
import { loadAiStatus } from '@/hooks/useAiStatus'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ReadingDialog } from '@/components/shared/ReadingDialog'
import { Spinner } from '@/components/ui/spinner'
import styles from './StoryEchoes.module.css'

export default function StoryEchoes({ input, chapterTitle, onClose, onSource, purpose = 'echo' }: {
  purpose?: 'echo' | 'character'; input: StoryEchoInput; chapterTitle: string; onClose: () => void; onSource: (source: StoryEchoSource) => void
}) {
  const character = purpose === 'character'
  const [result, setResult] = useState<StoryEchoResponse | CharacterCardResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mustReselect, setMustReselect] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const lifetime = useRef({ active: false })
  const opener = useRef(document.activeElement)
  useEffect(() => {
    const active = { active: true }
    lifetime.current = active
    const seq = generation.current, token = getToken(), scope = getStorageScope()
    void loadAiStatus().then(status => {
      if (active.active && seq === generation.current && token === getToken() && scope === getStorageScope() && status.quota && status.quota.limit >= 0) setRemaining(Math.max(0, status.quota.limit - status.quota.used))
    })
    return () => { active.active = false }
  }, [])

  async function find() {
    if (inFlight.current) return
    inFlight.current = true
    const seq = ++generation.current, token = getToken(), scope = getStorageScope(), active = lifetime.current
    const current = () => active.active && generation.current === seq && token === getToken() && scope === getStorageScope()
    setBusy(true); setError('')
    try {
      const next = await (character ? findCharacterCard(input) : findStoryEchoes(input))
      if (!current()) return
      setResult(next)
      if (next.generated && !next.cached) setRemaining(value => value === null ? null : Math.max(0, value - 1))
    } catch (cause) {
      if (!current()) return
      const status = (cause as ApiError).status
      setMustReselect(status === 409 || status === 404 || status === 403 || status === 401)
      if (status === 429) setRemaining(0)
      setError((cause as Error).message || '暂时无法查找，请稍后重试。')
    } finally {
      if (current()) { inFlight.current = false; setBusy(false) }
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <ReadingDialog title={character ? "这个人，我见过吗？" : "故事里的回声"} description={character ? "把读到这里为止的人物线索，放在一起。" : "从这一句话，回望前文留下的细节。"} bodyLabel={character ? "有出处的人物线索" : "原文与可能的呼应"}
      onCloseAutoFocus={event => {
        event.preventDefault()
        const element = opener.current
        if (element instanceof HTMLElement && element.isConnected) element.focus()
      }}>
      <section className={styles.anchor} aria-label="当前选段">
        <span className={styles.eyebrow}>读到这里 · {chapterTitle}</span>
        <blockquote>{input.selectedText}</blockquote>
      </section>
      <p className={styles.note}>{character ? "按选中的完整名字查找此前的原文，不读取后文或全书人物档案。同名不一定是同一个人，AI 整理的线索请结合引文判断。" : "只检索这处选段之前的正文，不读取本章后文、后续章节或全书摘要。关联解释为 AI 推测，请以原文为准。"}</p>
      {!result && <div className={styles.action}>
        <Button onClick={() => void find()} disabled={busy || mustReselect}>
          {busy && <Spinner size="sm" aria-hidden="true" />}
          {busy ? '正在回望前文…' : error && !mustReselect ? '重试查找' : character ? '查看人物线索' : '查找前文的回声'}
        </Button>
        <p className={styles.note}>{remaining === null ? '生成新结果使用读者 AI 额度；短期内复用结果不计次数。' : `今日剩余 ${remaining} 次 AI 额度；复用结果不计次数。`}</p>
        {remaining === 0 && <p className={styles.note}>额度用完后仍可查看已缓存的结果。</p>}
      </div>}
      {busy && <p role="status" className={styles.note}>正在查找相关片段并核对引文，可以关闭面板继续阅读。</p>}
      {error && <p role="alert" className={styles.error}>{error}{mustReselect && ' 请关闭面板后重新选择正文。'}</p>}
      {result && <div aria-live="polite">
        {!result.items.length && <div className={styles.empty}>
          <p>{character ? "这次还没有找到可核对的人物线索。" : "这次还没有找到有充分依据的回声。"}</p>
          <p className={styles.note}>{character ? "可以选择更完整的人名或原文中的称呼再试。别名和省略称呼可能未被检索到，没有找到不代表此前没有出现。" : "可以选择更具体的人物动作、对白或物件再试；没有找到，并不代表前文没有呼应。"}</p>
        </div>}
        <ol className={styles.results}>
          {result.items.map((item, index) => {
            const clue = character ? item as CharacterClue : null
            return <li key={`${item.source.chapterId}:${item.source.paragraphIndex}:${index}`} style={{ animationDelay: `${index * 55}ms` }}>
              <p className={styles.eyebrow}>前文 · {item.source.chapterTitle}</p>
              <blockquote>{item.source.quote}</blockquote>
              <p className={styles.label}>{clue ? CHARACTER_CLUE_LABELS[clue.kind] : "可能的呼应"}</p>
              {clue?.certainty === "uncertain" && <p className={styles.note}>身份或关系待确认</p>}
              <p className={styles.explanation}>{item.explanation}</p>
              <Button variant="ghost" onClick={() => onSource(item.source)} aria-label={`回到原文：${item.source.chapterTitle}`}>回到这处原文 →</Button>
            </li>
          })}
        </ol>
        <p className={styles.note}>从 {result.searchedChapters} 个相关前文章节及本章选段之前的文字中，核对了 {result.candidateCount} 处候选片段。{character ? "只匹配选中的名字，未自动合并别名；最近动向仅指本次候选中的较近记录。" : "检索按关键词筛选，可能遗漏其他呼应。"}</p>
        {result.limited && <p className={styles.note}>相关片段较多，本次优先检查其中的一部分。</p>}
        {result.omitted > 0 && <p className={styles.note}>部分条目未通过引文核验，已省略。</p>}
        {result.cached && <p className={styles.note}>本次复用了近期结果，未使用新的 AI 额度。</p>}
        {!result.generated && !result.cached && <p className={styles.note}>未找到可核对的候选片段，本次未调用 AI。</p>}
      </div>}
    </ReadingDialog>
  </Dialog>
}
