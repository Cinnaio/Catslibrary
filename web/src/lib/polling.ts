/** 一轮结束后才计时；隐藏页面暂停，恢复可见时刷新。返回 false 可停止轮询。 */
export function startPolling(work: () => Promise<unknown>, interval: number, immediate = true): () => void {
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
  const schedule = () => {
    clearTimeout(timer)
    if (!stopped && !document.hidden) timer = setTimeout(() => void run(), interval)
  }
  const run = async () => {
    if (stopped || running || document.hidden) return
    clearTimeout(timer)
    running = true
    try {
      if (await work() === false) stop()
    } catch {
      // 错误文案由调用方处理；失败后仍按间隔重试，避免未处理的 Promise 拒绝。
    } finally {
      running = false
      schedule()
    }
  }
  function onVisibility() {
    clearTimeout(timer)
    if (!document.hidden) void run()
  }
  document.addEventListener('visibilitychange', onVisibility)
  if (immediate) void run()
  else schedule()
  return stop
}
