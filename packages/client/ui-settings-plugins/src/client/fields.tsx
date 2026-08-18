/**
 * Hand-written controls for the plugin configuration forms. Each renders one
 * field's label, its staged text, whether saving would leave an override, and
 * — when one stands — the reset that stages a clear back to the composition
 * layer. Nothing here writes: a control reports what the user typed, and the
 * card's save is the single point where a draft becomes a document mutation.
 */

import { useState } from 'react'
import css from './fields.module.css'

/** What every field control needs regardless of its value type. */
export interface FieldProps {
  /** Stable id associating the label with its control. */
  id: string
  /** Visible label. */
  label: string
  /** One-line explanation rendered under the control. */
  hint: string
  /** Draft text this control renders. */
  text: string
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** True when the draft is not a value this field accepts. */
  invalid: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Copy shown in place of the hint while the draft is invalid. */
  invalidLabel: string
  /** Disables every control (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled control.
 */
export function ValueField(props: FieldProps & {
  /** Hints a numeric keypad without narrowing what the control accepts. */
  numeric?: boolean
  /** Placeholder shown while the draft is empty. */
  placeholder?: string
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{props.overriddenLabel}</span>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className={props.invalid ? css.inputInvalid : css.input}
        type="text"
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...props.invalid ? { 'aria-invalid': true } : {}}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? css.invalid : css.hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/**
 * A credential control. Shows exactly the text the user typed (password-masked
 * by default; the eye reveals that draft). The Host never seeds a previously
 * saved literal, so a blank control is blank — no placeholder mask.
 * @param props - the field's copy, its staged text, and the configured state.
 * @returns the labelled control.
 */
export function SecretField(props: Pick<FieldProps, 'id' | 'label' | 'hint' | 'text' | 'disabled' | 'onEdit'> & {
  /** Whether the Host reports a configured credential for this reference. */
  configured: boolean
  /** Copy describing the configured state. */
  stateLabel: string
  /** Accessible name for revealing the staged draft. */
  showLabel?: string
  /** Accessible name for hiding the staged draft. */
  hideLabel?: string
}) {
  const [visible, setVisible] = useState(false)
  const showLabel = props.showLabel ?? 'Show API key'
  const hideLabel = props.hideLabel ?? 'Hide API key'
  const blank = props.text.length === 0
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        <span className={css.badges}>
          <span className={props.configured ? css.badge : css.badgeMuted}>{props.stateLabel}</span>
        </span>
      </div>
      <div className={css.secretRow}>
        <input
          id={props.id}
          className={css.secretInput}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          name={`${props.id}-draft`}
          value={props.text}
          disabled={props.disabled}
          onChange={(event) => { props.onEdit(event.target.value) }}
        />
        <button
          type="button"
          className={css.eye}
          disabled={props.disabled || blank}
          aria-label={visible ? hideLabel : showLabel}
          title={visible ? hideLabel : showLabel}
          onClick={() => { setVisible(current => !current) }}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}

/** Open-eye glyph for revealing the staged secret draft. */
function EyeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.25C4.5 3.25 1.73 5.52.5 8c1.23 2.48 4 4.75 7.5 4.75S14.27 10.48 15.5 8C14.27 5.52 11.5 3.25 8 3.25Zm0 7.5A2.75 2.75 0 1 1 8 5.25a2.75 2.75 0 0 1 0 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Closed-eye glyph for hiding the staged secret draft. */
function EyeOffIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.22 2.22a.75.75 0 0 0-1.06 1.06l1.2 1.2C1.2 5.4.5 6.6.5 8c1.23 2.48 4 4.75 7.5 4.75 1.2 0 2.32-.27 3.32-.74l2.46 2.46a.75.75 0 1 0 1.06-1.06L2.22 2.22ZM8 11.25c-1.9 0-3.55-1.1-4.55-2.55.4-.58.9-1.1 1.48-1.52l1.2 1.2A2.74 2.74 0 0 0 8 10.75c.4 0 .78-.09 1.12-.24l1.12 1.12c-.7.4-1.45.62-2.24.62Zm0-6.5c.3 0 .58.04.85.12l-1.2 1.2A1.25 1.25 0 0 0 6.8 7.8L5.55 6.55C6.2 5.55 7.05 4.75 8 4.75Zm6.5 3.25c-.35.7-.82 1.35-1.38 1.9l-1.1-1.1c.3-.35.55-.75.73-1.18C11.55 5.85 9.9 4.75 8 4.75c-.2 0-.4.02-.6.05L6.22 3.62C6.8 3.4 7.4 3.25 8 3.25c3.5 0 6.27 2.27 7.5 4.75-.3.6-.7 1.18-1.18 1.7l.18.18Z"
        fill="currentColor"
      />
    </svg>
  )
}
