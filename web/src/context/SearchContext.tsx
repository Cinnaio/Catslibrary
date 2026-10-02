/**
 * 搜索上下文 —— Home 中央搜索框使用查询词，地址栏 ?q= 由 Home 同步。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface SearchContextValue {
  query: string
  setQuery: (q: string) => void
}

const SearchContext = createContext<SearchContextValue | null>(null)

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('')
  const value = useMemo(() => ({ query, setQuery }), [query])
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch must be used within SearchProvider')
  return ctx
}
