import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  IconButton,
  OptionButton,
  PaletteButton,
  SegmentedControl,
} from '../../src/components/ui/Controls';

describe('Control primitives', () => {
  it('renders icon buttons with accessible labels and click handlers', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Save Image" onClick={onClick}>
        <span aria-hidden="true">icon</span>
      </IconButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Image' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('updates segmented control selection through radio buttons', () => {
    function TestSegmentedControl() {
      const [value, setValue] = useState<'2D' | '3D'>('2D');
      return (
        <SegmentedControl
          label="Preview mode"
          value={value}
          onChange={setValue}
          options={[
            { value: '2D', label: '2D' },
            { value: '3D', label: '3D' },
          ]}
        />
      );
    }

    render(<TestSegmentedControl />);

    expect(screen.getByRole('radio', { name: '2D' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '3D' }));

    expect(screen.getByRole('radio', { name: '3D' }).getAttribute('aria-checked')).toBe('true');
  });

  it('marks active option buttons with pressed state', () => {
    render(<OptionButton active>Pinned</OptionButton>);

    expect(screen.getByRole('button', { name: 'Pinned' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('renders active palette buttons with accessible labels', () => {
    render(
      <PaletteButton variant="tool" active label="Bond Tool">
        Bond
      </PaletteButton>,
    );

    expect(screen.getByRole('button', { name: 'Bond Tool' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
