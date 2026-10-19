import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CoverStyleGallery, { COVER_STYLE_REFERENCES } from './CoverStyleGallery'

describe('CoverStyleGallery', () => {
  it('展示用户选择的 12 张真实参考封面', () => {
    render(<CoverStyleGallery value="auto" composition="auto" onChange={vi.fn()} disabled={false} />)

    expect(COVER_STYLE_REFERENCES).toHaveLength(12)
    expect(new Set(COVER_STYLE_REFERENCES.map((reference) => reference.image)).size).toBe(12)
    expect(document.querySelectorAll('.cover-style-sample--reference img')).toHaveLength(12)
  })

  it('选择参考封面时同时返回对应的风格和构图', () => {
    const onChange = vi.fn()
    render(<CoverStyleGallery value="auto" composition="auto" onChange={onChange} disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: /红墨竖题/ }))

    expect(onChange).toHaveBeenCalledWith('minimal_typographic', 'title_vertical')
  })

  it('只有风格和构图都匹配时才标记样本为选中', () => {
    render(<CoverStyleGallery value="doodle_journal" composition="title_collage" onChange={vi.fn()} disabled={false} />)

    expect(screen.getByRole('button', { name: /粉色涂鸦字卡/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /粉色泡泡字/ })).toHaveAttribute('aria-pressed', 'false')
  })
})
