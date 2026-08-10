/**
 * AdminGate — auth gate for the admin backend. Renders a loading spinner while
 * the session resolves, a Card gate when the user is missing or non-admin, and
 * its children otherwise. Moved verbatim from the former Admin.tsx shell.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../context/SessionContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function AdminGate({ children }: { children: ReactNode }) {
  const { user, loading } = useSession()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  // 未登录或非管理员 → 鉴权门
  if (!user || user.role !== 'admin') {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-2xl">
              舟
            </div>
            <div>
              <h1 className="text-xl font-semibold">知舟</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {user ? '当前账号没有管理权限' : '请先登录管理员账号'}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button asChild>
                <Link to="/auth">{user ? '切换账号' : '前往登录'}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/">← 返回首页</Link>
              </Button>
            </div>
            <Link to="/install" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              首次使用？创建管理员 →
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  return <>{children}</>
}
