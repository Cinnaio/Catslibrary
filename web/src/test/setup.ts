import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// 未开启 vitest globals 时 testing-library 不会自动 cleanup，手动挂上
afterEach(() => {
  cleanup()
})
