import PageState from './PageState'
import { useContentPolicy } from '../context/ContentPolicyContext'

/** 正文和详情共用授权等待/错误状态，避免将网络异常展示为 R18 拒绝。 */
export default function ContentPolicyStatus() {
  const { checking, policyError, mode, refreshPolicy } = useContentPolicy()
  if (checking) return <PageState title="正在确认访问权限" description="请稍候…" />
  if (!policyError) return null
  return <PageState inline={mode === 'adult'} title={mode === 'adult' ? '内容模式检查暂时失败' : '访问权限暂时无法确认'} description={policyError} actions={<button type="button" className="btn btn--primary" onClick={() => void refreshPolicy()}>重试</button>} />
}
