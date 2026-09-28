import { useId, type ReactNode } from 'react'

export function TextField(props: {
  label: string
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  hint?: string
  readOnly?: boolean
  type?: 'text' | 'number'
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type={props.type ?? 'text'}
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
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{props.label}</label>
      <select
        id={id}
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
  const id = useId()
  return (
    <div className="field field--full">
      <label className="field__label" htmlFor={id}>{props.label}</label>
      <textarea
        id={id}
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
