export interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id: string) => void
}
let scriptPromise: Promise<TurnstileApi> | null = null
export function loadTurnstile(): Promise<TurnstileApi> {
  const getApi = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile
  if (getApi()) return Promise.resolve(getApi()!)
  if (!scriptPromise)
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      const timer = window.setTimeout(() => {
        script.remove()
        reject(new Error('验证组件加载超时，请检查网络后重试'))
      }, 15000)
      script.onload = () => {
        clearTimeout(timer)
        const api = getApi()
        if (api) resolve(api)
        else reject(new Error('验证组件不可用，请稍后重试'))
      }
      script.onerror = () => {
        clearTimeout(timer)
        script.remove()
        reject(new Error('无法加载人机验证，请检查网络后重试'))
      }
      document.head.appendChild(script)
    }).catch((error) => {
      scriptPromise = null
      throw error
    })
  return scriptPromise
}
