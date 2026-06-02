import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from 'react';

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function IconButton({
  label,
  size = 'md',
  className,
  children,
  type = 'button',
  title,
  ...buttonProps
}: IconButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      className={classNames('ui-icon-button', `ui-icon-button--${size}`, className)}
      aria-label={label}
      title={title ?? label}
    >
      {children}
    </button>
  );
}

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  onMouseDown,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={classNames('ui-segmented-control', className)}
      role="radiogroup"
      aria-label={label}
      onMouseDown={onMouseDown}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={classNames('ui-segmented-option', active && 'ui-segmented-option--active')}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface OptionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export function OptionButton({
  active = false,
  className,
  children,
  type = 'button',
  ...buttonProps
}: OptionButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      className={classNames('ui-option-button', active && 'ui-option-button--active', className)}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
