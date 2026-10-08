import { useEffect, useState } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { thoughtsApi } from '../../lib/api'

/** 通过带会话的请求读取图片，兼容受限章节和管理员查看已隐藏图片。 */
export default function ThoughtImage({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  const key = `${id}:${attempt}`
  const [state, setState] = useState({ key: '', src: '', failed: false })
  const { src, failed } = state.key === key ? state : { src: '', failed: false }
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    void thoughtsApi
      .imageBlob(id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setState({ key, src: objectUrl, failed: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, src: '', failed: true })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, key])
  return (
    <figure className="thought-image">
      {src && !failed ? (
        <Dialog.Root open={previewOpen} onOpenChange={setPreviewOpen}>
          <Dialog.Trigger asChild>
            <button type="button" className="thought-image__trigger" aria-label="放大查看插画">
              <img src={src} alt="根据引用文字生成的 AI 插画" onError={() => setState({ key, src: '', failed: true })} />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="thought-image-preview-overlay" />
            <Dialog.Content className="thought-image-preview" aria-describedby={undefined}>
              <Dialog.Title className="sr-only">插画大图</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="thought-image-preview__close" aria-label="关闭图片预览">
                  <X size={22} aria-hidden="true" />
                </button>
              </Dialog.Close>
              <img src={src} alt="根据引用文字生成的 AI 插画（大图）" />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        !failed && <span role="status">正在加载插画…</span>
      )}
      {failed && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          图片加载失败，点击重试
        </button>
      )}
      <figcaption>AI 生成插画{src && !failed ? ' · 点击查看大图' : ''}</figcaption>
    </figure>
  )
}
