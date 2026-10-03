import { useContext, useId, useLayoutEffect, type ReactNode } from 'react'
import { PageLayoutContext } from '../context/PageLayoutContext'

interface PageStateProps {
  title: string
  description: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  /** Inline notices must not replace the page's navigation or browsing area. */
  inline?: boolean
}

/** Shared full-page access/missing-content state, with an inline notice variant. */
export default function PageState({ title, description, icon, actions, children, inline = false }: PageStateProps) {
  const setStandalone = useContext(PageLayoutContext)
  const titleId = useId()
  useLayoutEffect(() => {
    if (inline || !setStandalone) return
    setStandalone(true)
    return () => setStandalone(false)
  }, [inline, setStandalone])

  const Heading = inline ? 'h2' : 'h1'
  const content = <section className={`page-state__content${inline ? ' page-state__content--inline' : ''}`} aria-labelledby={titleId} role={inline ? 'status' : undefined}>
    {icon && <div className="page-state__icon" aria-hidden="true">{icon}</div>}
    <div className="page-state__body">
      <Heading id={titleId} className="page-state__title">{title}</Heading>
      <p className="page-state__description">{description}</p>
      {children}
      {actions && <div className="page-state__actions">{actions}</div>}
    </div>
  </section>
  return inline ? content : <main className="page-state">{content}</main>
}
