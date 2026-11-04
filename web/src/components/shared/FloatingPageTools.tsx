import { Link } from 'react-router-dom'
import { scrollBehavior } from '@/lib/motion'
import { BackToTopIcon, HomeIcon } from '@/components/icons'
import styles from '@/components/shared/FloatingPageTools.module.css'

/** 详情页和阅读器共用；尺寸与定位随组件加载，不依赖其他路由的样式。 */
export default function FloatingPageTools({ reader = false }: { reader?: boolean }) {
  return (
    <nav className={`${styles.tools}${reader ? ` ${styles.reader}` : ''}`} aria-label="页面快捷操作">
      <Link to="/" className={styles.button} aria-label="回到首页" title="回到首页">
        <HomeIcon />
      </Link>
      <button
        type="button"
        className={styles.button}
        aria-label="回到顶部"
        title="回到顶部"
        onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
      >
        <BackToTopIcon />
      </button>
    </nav>
  )
}
