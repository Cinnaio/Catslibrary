import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'
import { DialogFrame, DialogBody } from './shared/DialogFrame'
import { Button } from './ui/button'
import { InlineError } from './shared/AsyncStates'
import { loadTurnstile } from '@/lib/turnstile'
import type { ChallengeRequest } from '@/lib/security-challenge'
import { SECURITY_ACTION_LABELS } from '@shared/security'

export default function SecurityChallengeDialog() {
  const [task, setTask] = useState<ChallengeRequest | null>(null),
    current = useRef<ChallengeRequest | null>(null)
  const [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [round, setRound] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const show = (event: Event) => {
      current.current?.finish(null)
      const next = (event as CustomEvent<ChallengeRequest>).detail
      current.current = next
      setTask(next)
      setToken('')
      setError('')
    }
    const finished = (event: Event) => {
      if (current.current?.finish === (event as CustomEvent).detail) {
        current.current = null
        setTask(null)
        setToken('')
      }
    }
    const cancel = () => current.current?.finish(null)
    const changed = (event: StorageEvent) => {
      if (event.key === 'user_session_marker' || event.key === 'user_session_token' || event.key === null) cancel()
    }
    window.addEventListener('zz-security-challenge', show)
    window.addEventListener('zz-challenge-finished', finished)
    window.addEventListener('zhizhou-session-expired', cancel)
    window.addEventListener('storage', changed)
    return () => {
      window.removeEventListener('zz-security-challenge', show)
      window.removeEventListener('zz-challenge-finished', finished)
      window.removeEventListener('zhizhou-session-expired', cancel)
      window.removeEventListener('storage', changed)
      current.current?.finish(null)
    }
  }, [])
  useEffect(() => {
    if (!task) return
    let alive = true,
      remove: (() => void) | undefined
    // Dialog content mounts through a portal before this animation frame.
    const frame = requestAnimationFrame(() => {
      void loadTurnstile()
        .then((api) => {
          if (!alive || !container.current) return
          const id = api.render(container.current, {
            sitekey: task.config.siteKey,
            action: task.config.action.replace(/-/g, '_'),
            theme: 'auto',
            size: 'flexible',
            callback: (value: string) => {
              if (alive) {
                setToken(value)
                setError('')
              }
            },
            'expired-callback': () => {
              if (alive) setToken('')
            },
            'error-callback': () => {
              if (alive) {
                setToken('')
                setError('验证组件不可用，请重试')
              }
            },
          })
          remove = () => api.remove(id)
        })
        .catch(() => {
          if (alive) setError('验证组件加载失败，请检查网络后重试')
        })
    })
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      remove?.()
    }
  }, [task, round])
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) task?.finish(null)
      }}
    >
      <DialogFrame>
        <DialogHeader>
          <DialogTitle>安全验证</DialogTitle>
          <DialogDescription>{task ? SECURITY_ACTION_LABELS[task.config.action] : ''}需要完成验证，验证后继续提交。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div ref={container} />
          {error && <InlineError message={error} />}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setToken('')
              setError('')
              setRound((n) => n + 1)
            }}
          >
            重新验证
          </Button>
          <Button variant="secondary" onClick={() => task?.finish(null)}>
            取消
          </Button>
          <Button disabled={!token} onClick={() => task?.finish(token)}>
            继续
          </Button>
        </DialogFooter>
      </DialogFrame>
    </Dialog>
  )
}
