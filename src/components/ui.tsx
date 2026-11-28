"use client";

import React, { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  pending?: boolean;
};

export function Button({ variant = "primary", pending = false, type = "button", children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`button button-${variant}`}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
    >
      {children}
    </button>
  );
}

export function Banner({ tone, children }: { tone: "error" | "info" | "success"; children: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="loading" role="status" aria-live="polite" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "decimal" | "numeric";
  maxLength?: number;
  spellCheck?: boolean;
};

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  disabled,
  readOnly,
  autoComplete,
  inputMode,
  maxLength,
  spellCheck,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="req"> (required)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        spellCheck={spellCheck}
      />
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextArea({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required,
  disabled,
  maxLength,
}: Omit<FieldProps, "autoComplete" | "inputMode" | "readOnly" | "spellCheck">) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="req"> (required)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-required={required || undefined}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
      />
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError("");
    } catch {
      setCopied(false);
      setError("Select the text and copy it from the field.");
    }
  }

  return (
    <div className="copy-row">
      <TextField id={id} label={label} value={value} onChange={() => undefined} readOnly />
      <Button variant="secondary" onClick={() => void copy()} aria-live="polite">
        {copied ? "Copied" : "Copy"}
      </Button>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
