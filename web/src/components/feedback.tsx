/**
 * 反馈组件 —— Toast 轻提示 + Confirm 确认弹窗（shadcn 版）。
 * 接口保持兼容：useToast().toast(msg, type?, options?) / useConfirm().confirm(opts?) 签名不变，
 * 22 处 confirm 调用点零改动。Toast 用 sonner，Confirm 用 AlertDialog。
 * options.action 用于「撤销」这类带动作的 toast：sonner 自带按钮与 10s 倒计时。
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { ControlAppearance, useControlAppearance, type ControlAppearanceName } from '@/components/ui/control-appearance'
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog'

// ---------- Toast ----------

type ToastType = 'default' | 'success' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** 动作按钮（如「撤销」），点击后立即执行；默认 10 秒后自动消失 */
  action?: ToastAction
  /** 展示时长（毫秒），默认 sonner 行为；带 action 时默认 10000 */
  duration?: number
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useCallback((message: string, type: ToastType = 'default', options?: ToastOptions) => {
    const opts = options?.action
      ? { action: { label: options.action.label, onClick: options.action.onClick }, duration: options.duration ?? 10000 }
      : options?.duration
        ? { duration: options.duration }
        : undefined
    if (type === 'success') sonnerToast.success(message, opts)
    else if (type === 'error') sonnerToast.error(message, opts)
    else sonnerToast(message, opts)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Toaster position="top-center" />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ---------- Confirm ----------

export interface ConfirmOptions {
  title?: string
  message?: string
  okText?: string
  cancelText?: string
  danger?: boolean
  items?: string[]
}

interface ConfirmContextValue {
  confirm: (opts?: ConfirmOptions) => Promise<boolean>
}

interface ConfirmRequestContext {
  confirm: (opts: ConfirmOptions | undefined, appearance: ControlAppearanceName) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmRequestContext | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { visible: boolean; appearance: ControlAppearanceName }) | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions = {}, appearance: ControlAppearanceName = 'default') => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({ visible: true, ...opts, appearance })
    })
  }, [])

  function close(result: boolean) {
    setState((s) => (s ? { ...s, visible: false } : s))
    const r = resolveRef.current
    resolveRef.current = null
    r?.(result)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <ControlAppearance appearance={state?.appearance ?? 'default'}>
        <ConfirmationDialog
          open={state?.visible === true}
          onOpenChange={(open) => {
            if (!open) close(false)
          }}
          title={state?.title || '确认操作'}
          description={state?.message}
          items={state?.items}
          confirmText={state?.okText || '确认'}
          cancelText={state?.cancelText || '取消'}
          danger={state?.danger}
          onConfirm={() => close(true)}
        />
      </ControlAppearance>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  const request = ctx?.confirm
  const appearance = useControlAppearance()['data-ui']
  const confirm = useCallback(
    (opts?: ConfirmOptions) => {
      if (!request) throw new Error('useConfirm must be used within ConfirmProvider')
      return request(opts, appearance)
    },
    [request, appearance],
  )
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return { confirm }
}
