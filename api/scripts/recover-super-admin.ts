import { migrate } from '../src/db/migrate'
import { getDb, getPool } from '../src/db/pool'
import { recoverSuperAdministrator } from '../src/services/account-security'

const args = process.argv.slice(2)
const value = (name: string) => (args[args.indexOf(name) + 1] || '').trim()
if (args.length !== 4 || args.filter(value => value === '--username').length !== 1 || args.filter(value => value === '--reason').length !== 1 ||
    !value('--username') || value('--username').startsWith('--') || !value('--reason') || value('--reason').startsWith('--') || value('--reason').length > 500) {
  console.error('用法：npm run admin:recover -- --username <已有用户名> --reason <恢复原因>')
  process.exit(1)
}
try {
  await migrate({ keepPoolOpen: true })
  const id = await recoverSuperAdministrator(getDb(), value('--username'), value('--reason'))
  console.log(`已恢复超级管理员：${id}；旧会话已撤销，请重新登录。`)
} catch {
  console.error('恢复失败：请检查用户名、数据库配置和迁移状态。')
  process.exitCode = 1
} finally {
  await getPool()?.end()
}
