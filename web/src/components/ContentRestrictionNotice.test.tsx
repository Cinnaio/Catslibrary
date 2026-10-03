import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import ContentRestrictionNotice from './ContentRestrictionNotice'

const session = vi.hoisted(() => ({ user: null as null | { id: string } }))
vi.mock('../context/SessionContext', () => ({ useOptionalSession: () => session }))
beforeEach(() => { session.user = null })

function LocationProbe() {
  const location = useLocation()
  return <output>{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>
}

it('游客登录入口保留原始路径与查询参数', () => {
  render(<MemoryRouter initialEntries={['/novel/test?source=bookshelf']}>
    <ContentRestrictionNotice mode="safe" onModeChange={vi.fn()} />
    <LocationProbe />
  </MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: '登录后开启' }))
  expect(screen.getByText(/"pathname":"\/auth"/)).toHaveTextContent('"from":"/novel/test?source=bookshelf"')
})

it('登录用户通过原有模式切换发起成年验证', () => {
  session.user = { id: 'reader' }
  const onModeChange = vi.fn()
  render(<MemoryRouter><ContentRestrictionNotice mode="safe" onModeChange={onModeChange} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '查看限制级内容' }))
  expect(onModeChange).toHaveBeenCalledWith('adult')
  expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
})

it('adult 状态仍被拒绝时提供重新验证入口', () => {
  session.user = { id: 'reader' }
  const onModeChange = vi.fn()
  render(<MemoryRouter><ContentRestrictionNotice mode="adult" onModeChange={onModeChange} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '重新验证' }))
  expect(onModeChange).toHaveBeenCalledWith('adult')
})

it('站点禁用成人内容时只提供返回入口', () => {
  render(<MemoryRouter><ContentRestrictionNotice mode="safe" canUnlock={false} onModeChange={vi.fn()} /></MemoryRouter>)
  expect(screen.getByText(/站点当前未开放成人内容模式/)).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '登录后开启' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '返回首页' })).toBeInTheDocument()
})
