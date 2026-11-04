import { useState, useRef, useEffect, useMemo } from 'react'
import { Clock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import './TimeField.css'
import { useFieldControl } from '@/components/ui/field-context'

export interface TimeFieldProps {
  id?: string
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  className?: string
  placeholder?: string
  presets?: readonly string[]
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

export default function TimeField({
  id,
  value = '00:00',
  onChange,
  disabled = false,
  className = '',
  placeholder = '00:00',
  presets = [],
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: TimeFieldProps) {
  const fieldProps = useFieldControl({ id, 'aria-describedby': ariaDescribedBy })
  const [open, setOpen] = useState(false)
  const hourListRef = useRef<HTMLDivElement>(null)
  const minuteListRef = useRef<HTMLDivElement>(null)

  // 解析当前时分
  const [currentHour, currentMinute] = useMemo(() => {
    if (!value || typeof value !== 'string') return ['00', '00']
    const parts = value.split(':')
    const h = parts[0]?.padStart(2, '0') || '00'
    const m = parts[1]?.padStart(2, '0') || '00'
    return [h, m]
  }, [value])

  // 打开时自动平滑滚动到当前选中的时与分
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      const selectedHourEl = hourListRef.current?.querySelector<HTMLElement>(`[data-hour="${currentHour}"]`)
      const selectedMinuteEl = minuteListRef.current?.querySelector<HTMLElement>(`[data-minute="${currentMinute}"]`)
      selectedHourEl?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      selectedMinuteEl?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 50)
    return () => clearTimeout(timer)
  }, [open, currentHour, currentMinute])

  const handleHourSelect = (h: string) => {
    if (disabled) return
    onChange(`${h}:${currentMinute}`)
  }

  const handleMinuteSelect = (m: string) => {
    if (disabled) return
    onChange(`${currentHour}:${m}`)
  }

  const handlePresetSelect = (preset: string) => {
    if (disabled) return
    onChange(preset)
  }

  const displayTime = value ? `${currentHour}:${currentMinute}` : placeholder

  return (
    <div className={`custom-time-picker ${className}`}>
      <Popover
        open={open && !disabled}
        onOpenChange={(next) => {
          if (!next || !disabled) setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <button
            {...fieldProps}
            type="button"
            disabled={disabled}
            aria-labelledby={ariaLabelledBy}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="custom-time-picker__trigger"
          >
            <span>{displayTime}</span>
            <Clock size={15} className="custom-time-picker__clock-icon" aria-hidden="true" />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" sideOffset={6} className="custom-time-picker__content">
          {/* 预设由业务提供，通用字段不决定任务执行时段。 */}
          {presets.length > 0 && (
            <div className="custom-time-picker__presets" role="group" aria-label="快捷时段">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`custom-time-picker__preset-btn ${displayTime === preset ? 'custom-time-picker__preset-btn--active' : ''}`}
                  onClick={() => handlePresetSelect(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}

          {/* 时与分双列平滑联动滚动选择器 */}
          <div className="custom-time-picker__columns">
            <div className="custom-time-picker__column">
              <span className="custom-time-picker__column-header">时 (00-23)</span>
              <div ref={hourListRef} className="custom-time-picker__column-list">
                {HOURS.map((h) => {
                  const isSelected = h === currentHour
                  return (
                    <button
                      key={h}
                      type="button"
                      data-hour={h}
                      className={`custom-time-picker__item ${isSelected ? 'custom-time-picker__item--selected' : ''}`}
                      onClick={() => handleHourSelect(h)}
                    >
                      {h}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="custom-time-picker__column">
              <span className="custom-time-picker__column-header">分 (00-59)</span>
              <div ref={minuteListRef} className="custom-time-picker__column-list">
                {MINUTES.map((m) => {
                  const isSelected = m === currentMinute
                  return (
                    <button
                      key={m}
                      type="button"
                      data-minute={m}
                      className={`custom-time-picker__item ${isSelected ? 'custom-time-picker__item--selected' : ''}`}
                      onClick={() => handleMinuteSelect(m)}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 底部确认栏 */}
          <div className="custom-time-picker__footer">
            <span className="custom-time-picker__footer-label">设定为 {displayTime}</span>
            <button type="button" className="custom-time-picker__footer-confirm" onClick={() => setOpen(false)}>
              完成
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
