import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../../src/components/ui/Menu';

function TestMenu({ onSelect = vi.fn() }: { onSelect?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <MenuRoot open={open} onOpenChange={setOpen}>
        <MenuTrigger open={open} onClick={() => setOpen((value) => !value)}>
          File
        </MenuTrigger>
        {open && (
          <MenuContent>
            <MenuItem onClick={onSelect}>Open</MenuItem>
            <MenuItem disabled>Disabled</MenuItem>
          </MenuContent>
        )}
      </MenuRoot>
      <button type="button">Outside</button>
    </div>
  );
}

describe('Menu primitives', () => {
  it('opens from the trigger and invokes enabled items', () => {
    const onSelect = vi.fn();
    render(<TestMenu onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not invoke disabled items', () => {
    render(<TestMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }));

    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Escape and outside pointer down', () => {
    render(<TestMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
