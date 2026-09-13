import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Table } from './table'

describe('Table', () => {
  it('keeps vertical overflow hidden while allowing horizontal scrolling', () => {
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>内容</td>
          </tr>
        </tbody>
      </Table>,
    )

    expect(container.firstElementChild).toHaveClass('overflow-x-auto', 'overflow-y-hidden')
  })
})
