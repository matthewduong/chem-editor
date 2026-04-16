import { useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent } from 'react';

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface DeferredNumberInputProps {
  value: number;
  min: number;
  max: number;
  step?: number | string;
  integer?: boolean;
  onCommit: (value: number) => void;
  style?: CSSProperties;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function DeferredNumberInput({
  value,
  min,
  max,
  step,
  integer = false,
  onCommit,
  style,
  onFocus,
  onBlur,
  onKeyDown,
}: DeferredNumberInputProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = isEditing ? draft : String(value);

  const commitDraft = () => {
    setIsEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(String(value));
      return;
    }

    const parsed = integer ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const nextValue = clampValue(integer ? Math.round(parsed) : parsed, min, max);
    setDraft(String(nextValue));
    if (nextValue !== value) onCommit(nextValue);
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={displayValue}
      onFocus={(event) => {
        setIsEditing(true);
        setDraft(String(value));
        onFocus?.(event);
      }}
      onChange={(event) => {
        setIsEditing(true);
        setDraft(event.target.value);
      }}
      onBlur={(event) => {
        commitDraft();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          commitDraft();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setIsEditing(false);
          setDraft(String(value));
        }
      }}
      style={style}
    />
  );
}
