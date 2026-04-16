import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectMenuProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  isDarkMode: boolean;
  textColor: string;
  borderColor: string;
  backgroundColor?: string;
  menuBackgroundColor?: string;
  activeBackgroundColor?: string;
  width?: number | string;
  minWidth?: number | string;
  fontSize?: number;
  padding?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
}

export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  isDarkMode,
  textColor,
  borderColor,
  backgroundColor,
  menuBackgroundColor,
  activeBackgroundColor,
  width,
  minWidth,
  fontSize = 12,
  padding = '6px 8px',
  disabled = false,
  align = 'left',
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );
  const buttonBg = backgroundColor ?? (isDarkMode ? '#333' : '#fff');
  const menuBg = menuBackgroundColor ?? buttonBg;
  const hoverBg = activeBackgroundColor ?? (isDarkMode ? '#2a5a8a' : '#dfeeff');

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', width, minWidth }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        style={{
          width: '100%',
          minWidth,
          padding,
          fontSize,
          background: buttonBg,
          color: textColor,
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.label ?? value}
        </span>
        <span style={{ opacity: 0.65, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            [align]: 0,
            background: menuBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            boxShadow: '0 8px 18px rgba(0,0,0,0.25)',
            zIndex: 3000,
            minWidth: '100%',
            overflow: 'hidden',
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  fontSize,
                  background: active ? hoverBg : 'transparent',
                  color: textColor,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
