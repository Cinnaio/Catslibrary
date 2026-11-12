import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import styles from './copyright.module.css'

const title = '版权说明与联系'
const email = 'mail@notify.catrr.uk'

export default function Copyright() {
  useDocumentTitle(title)

  return (
    <main className={styles.page}>
      <h1>{title}</h1>
      <p>Cat’s Library 收录的部分书目、正文和封面来自网络，相关著作权及其他权利归各自权利人所有。</p>
      <p>
        如果你是作者、其他权利人或其授权代理人，发现站内内容涉及未经许可的转载，或发现署名、来源有误，欢迎发邮件至
        {' '}<a href={`mailto:${email}`}>{email}</a>。请在邮件中注明书名、本站页面链接和具体诉求，并附上能初步说明权利归属或代理权限的材料。
      </p>
      <p>收到来信后，我们会尽快处理，并根据具体情况暂停相关内容的访问、下架内容或更正署名与来源。</p>
    </main>
  )
}
