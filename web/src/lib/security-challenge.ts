import type { ChallengeConfiguration } from '@shared/security'
export interface ChallengeRequest {
  config: ChallengeConfiguration
  finish: (token: string | null) => void
}
export function requestSecurityChallenge(config: ChallengeConfiguration): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let done = false
    const finish = (token: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      window.dispatchEvent(new CustomEvent('zz-challenge-finished', { detail: finish }))
      if (token) resolve(token)
      else reject(new Error('已取消或超时，请重新发起安全验证'))
    }
    const timer = setTimeout(() => finish(null), 5 * 60000)
    window.dispatchEvent(new CustomEvent<ChallengeRequest>('zz-security-challenge', { detail: { config, finish } }))
  })
}
