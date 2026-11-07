import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DEFAULT_PAGE_SIZE_OPTIONS } from '@/lib/pagination'
import './Pagination.css'

/** Loaded only by callers that actually expose a page-size selector. */
export default function PaginationPageSize({ pageSize, busy, onChange }: {
  pageSize: { value: number; options?: readonly number[] }
  busy: boolean
  onChange: (size: number) => void
}) {
  return <Select disabled={busy} value={String(pageSize.value)} onValueChange={value => onChange(Number(value))}>
    <SelectTrigger size="sm" aria-label="每页显示数量"><SelectValue /></SelectTrigger>
    <SelectContent position="popper" align="end" sideOffset={4}>
      {(pageSize.options || DEFAULT_PAGE_SIZE_OPTIONS).map(size => <SelectItem key={size} value={String(size)}>{size} 条</SelectItem>)}
    </SelectContent>
  </Select>
}
