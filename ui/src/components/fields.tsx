import type { ReactNode } from 'react'

export function TextField(props: {
  label: string
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  hint?: string
  readOnly?: boolean
}) {
  return (
    <div className="field">
      <label className="field__label">{props.label}</label>
      <input
        className="field__input"
        value={props.value}
        placeholder={props.placeholder}
        readOnly={props.readOnly || !props.onChange}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      {props.hint && <span className="field__hint">{props.hint}</span>}
    </div>
  )
}

export function SelectField(props: {
  label: string
  value: string
  options: { value: string; label?: string }[]
  onChange: (value: string) => void
  allowEmpty?: boolean
}) {
  return (
    <div className="field">
      <label className="field__label">{props.label}</label>
      <select
        className="field__input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.allowEmpty && <option value="">—</option>}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    </div>
  )
}

export function TextAreaField(props: {
  label: string
  value: string
  onChange?: (value: string) => void
  rows?: number
  mono?: boolean
  className?: string
  hint?: string
}) {
  return (
    <div className="field field--full">
      <label className="field__label">{props.label}</label>
      <textarea
        className={`textarea${props.className ? ` ${props.className}` : ''}`}
        rows={props.rows ?? 4}
        value={props.value}
        readOnly={!props.onChange}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      {props.hint && <span className="field__hint">{props.hint}</span>}
    </div>
  )
}

export function KV(props: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="kv__key">{props.k}</span>
      <span className={`kv__value${props.mono ? ' kv__value--mono' : ''}`}>{props.children}</span>
    </div>
  )
}
