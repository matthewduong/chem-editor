import { useEffect, useRef } from 'react';

interface MenuRootProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
}

export function MenuRoot({ open, onOpenChange, children, align = 'left' }: MenuRootProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className={`ui-menu-root ui-menu-root--${align}`}>
      {children}
    </div>
  );
}

interface MenuTriggerProps {
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export function MenuTrigger({ open, onClick, children }: MenuTriggerProps) {
  return (
    <button
      type="button"
      className="ui-menu-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface MenuContentProps {
  children: React.ReactNode;
  width?: number;
  className?: string;
}

export function MenuContent({ children, width, className = '' }: MenuContentProps) {
  return (
    <div
      role="menu"
      className={`ui-menu-content ${className}`}
      style={width ? { minWidth: width } : undefined}
    >
      {children}
    </div>
  );
}

interface MenuItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  shortcut?: string;
  trailing?: React.ReactNode;
}

export function MenuItem({
  children,
  onClick,
  disabled = false,
  danger = false,
  accent = false,
  shortcut,
  trailing,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={[
        'ui-menu-item',
        danger ? 'ui-menu-item--danger' : '',
        accent ? 'ui-menu-item--accent' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ui-menu-item__label">{children}</span>
      {shortcut ? <span className="ui-menu-shortcut">{shortcut}</span> : trailing}
    </button>
  );
}

interface MenuCheckboxItemProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

export function MenuCheckboxItem({ label, checked, onChange }: MenuCheckboxItemProps) {
  return (
    <label className="ui-menu-checkbox">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function MenuSeparator() {
  return <div className="ui-menu-separator" role="separator" />;
}

export function MenuSectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="ui-menu-section-label">{children}</div>;
}
