import type { AiTextProgress } from '@shared/ai-text-progress'
import styles from './AiStreamPreview.module.css'

/** A preview is never an accepted result; structured outputs expose counts only. */
export default function AiStreamPreview({
  progress,
  structured = false,
  stopped = false,
}: {
  progress?: AiTextProgress | null
  structured?: boolean
  stopped?: boolean
}) {
  if (!progress) return null
  const start = progress.preview.trimStart()
  const showText = !structured && !start.startsWith('{') && !start.startsWith('[') && !start.startsWith('```')
  return (
    <div className={styles.root} aria-label="生成预览">
      <p className={styles.status} role="status">
        {stopped
          ? '生成已停止 · 以下为未完成预览'
          : progress.phase === 'thinking'
            ? `正在思考 · 已接收 ${progress.reasoningCharacters} 个思考字符`
            : `正在生成 · 已接收 ${progress.generatedCharacters} 字符，完成校验后显示结果`}
      </p>
      {showText && progress.preview && (
        <div className={styles.preview} tabIndex={0}>
          {progress.preview}
        </div>
      )}
    </div>
  )
}
