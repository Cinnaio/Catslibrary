export interface ReauthenticationRequest {
  finish: (accepted: boolean) => void
}
let pending: Promise<boolean> | null = null
export function requestReauthentication(): Promise<boolean> {
  if (!pending)
    pending = new Promise<boolean>((resolve) => {
      let done = false
      const timeout = setTimeout(() => finish(false), 5 * 60000)
      function finish(value: boolean) {
        if (done) return
        done = true
        clearTimeout(timeout)
        resolve(value)
      }
      window.dispatchEvent(new CustomEvent<ReauthenticationRequest>('zz-reauthenticate', { detail: { finish } }))
    }).finally(() => {
      pending = null
    })
  return pending
}
