/**
 * useDialogHotkeys —— 弹窗表单的键盘路径。
 *
 * 问题：后台的编辑弹窗（小说、章节、合并章节名）都只有鼠标路径。填完最后一个
 * 字段后手要么离开键盘去点「保存」，要么按 Tab 逐格穿过整个表单；长正文编辑
 * （章节弹窗约 300px 高的 textarea）里 Tab 是插入制表符的直觉，误触后又要重新
 * 定位。写作者一天里重复几十次的动作，值得一条键盘直达。
 *
 * 契约：
 *   Ctrl/Cmd + Enter —— 提交（与浏览器内常见的「提交表单」惯例一致，
 *                       且不与 textarea 的换行冲突）；
 *   Ctrl/Cmd + S     —— 同为提交，拦截浏览器「保存网页」；
 *   两个键都可被 submitting 阻断，避免重复提交。
 *
 * 只在弹窗打开时挂监听，关闭即摘除——避免后台常驻全局快捷键与阅读器
 * 的键盘绑定打架。
 */
import { useEffect } from 'react'

interface UseDialogHotkeysOptions {
  /** 弹窗是否打开；false 时不挂监听。 */
  open: boolean
  /** 提交回调。即使回调是异步函数也无需在外部 await。 */
  onSubmit: () => void | Promise<void>
  /** 正在提交：为 true 时快捷键不触发，防止重复提交。 */
  submitting?: boolean
  /** 弹窗内存在必须走独立入口的字段（如未加载完成的正文）时，可整体关闭。 */
  enabled?: boolean
}

export function useDialogHotkeys({ open, onSubmit, submitting = false, enabled = true }: UseDialogHotkeysOptions) {
  useEffect(() => {
    if (!open || !enabled) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' && e.key.toLowerCase() !== 's') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.altKey) return
      if (submitting) return
      e.preventDefault()
      void onSubmit()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, enabled, submitting, onSubmit])
}

/**
 * 弹窗打开后把焦点落到指定控件上，关闭时归还给触发元素。
 *
 * 问题：Radix Dialog 默认把焦点给第一个可聚焦子元素，添加小说弹窗的首个
 * 可聚焦元素是关闭按钮（X）——键盘用户按 Enter 会关掉自己刚打开的弹窗。
 * 关闭后焦点丢到 body，再要打开同一行必须从头 Tab。
 *
 * 做法：打开时聚焦 selector 命中的控件（回退到弹窗容器本身，让读屏先念标题），
 * 关闭时把焦点还给打开前记录的元素——行内按钮位置不动，肌肉记忆得以延续。
 */
export function useDialogFocus(dialogOpen: boolean, selector: string) {
  useEffect(() => {
    if (!dialogOpen) return
    const opener = document.activeElement as HTMLElement | null

    // Radix 完成 portal 挂载与自身 autofocus 需要一帧；用 rAF 在之后抢占，
    // 否则会被 Radix 的聚焦覆盖回关闭按钮。
    const raf = requestAnimationFrame(() => {
      const scope = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
      const target = scope?.querySelector<HTMLElement>(selector) ?? scope
      target?.focus({ preventScroll: false })
    })

    return () => {
      cancelAnimationFrame(raf)
      // opener 仍在文档中才归还：行被删除/列表重渲染后元素已脱离文档，
      // 强行 focus 会静默失效并把焦点留在 body。
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [dialogOpen, selector])
}
