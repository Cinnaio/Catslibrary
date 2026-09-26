/**
 * 反馈组件 —— Toast 轻提示 + Confirm 确认弹窗（shadcn 版）。
 * 接口保持兼容：useToast().toast(msg, type?, options?) / useConfirm().confirm(opts?) 签名不变，
 * 22 处 confirm 调用点零改动。Toast 用 sonner，Confirm 用 AlertDialog。
 * options.action 用于「撤销」这类带动作的 toast：sonner 自带按钮与 10s 倒计时。
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

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
      <Toaster position="bottom-center" />
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

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { visible: boolean }) | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({ visible: true, ...opts })
    })
  }, [])

  function close(result: boolean) {
    setState((s) => (s ? { ...s, visible: false } : s))
    const r = resolveRef.current
    resolveRef.current = null
    r?.(result)
  }

  // danger 默认 false：只有显式传入 danger: true 的调用点（删除等破坏性操作）显示红色
  const danger = state?.danger === true

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialog
        // 必须给布尔而不是 undefined：首帧 state 为 null 时 open=undefined
        // 会让 Radix 按「非受控」初始化，第二帧传入 true 再切成受控——
        // React 会就此告警，且非受控初值在部分版本下会让关闭回调不可靠。
        open={state?.visible === true}
        onOpenChange={(open) => {
          if (!open) close(false) // Esc / 遮罩点击（按钮路径已由 resolveRef 去重）
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title || '确认操作'}</AlertDialogTitle>
            {state?.message && <AlertDialogDescription>{state.message}</AlertDialogDescription>}
          </AlertDialogHeader>
          {state?.items && state.items.length > 0 && (
            <div className="max-h-[240px] overflow-y-auto rounded-md border bg-muted/50 p-2 text-sm">
              {state.items.map((item, i) => (
                <div key={i} className="rounded px-2 py-1 text-foreground">
                  {item}
                </div>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            {/* 危险操作显式把初始焦点钉在「取消」。
                Radix 的 AlertDialog 默认会把焦点给 Cancel，但这是实现细节、
                不是契约；本条显式声明它，让「危险确认框的初始焦点绝不落在
                执行键上」成为可读、可测的约定而不是顺带得到的行为。
                这样即使日后替换弹窗原语或调整 Radix 版本，误触 Enter
                （键盘场景下最廉价的按键，操作员刚点完行内删除、手还在原位）
                也只会安全关闭确认框，而不是直接执行不可逆操作。 */}
            <AlertDialogCancel autoFocus={danger} onClick={() => close(false)}>
              {state?.cancelText || '取消'}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={danger ? 'destructive' : 'default'}
              onClick={() => close(true)}
            >
              {state?.okText || '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
