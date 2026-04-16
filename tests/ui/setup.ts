import React from 'react';
import { cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { afterEach } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
  writable: true,
});

Object.defineProperty(window.navigator, 'platform', {
  value: 'MacIntel',
  configurable: true,
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(window, 'requestAnimationFrame', {
  writable: true,
  value: (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
});

Object.defineProperty(window, 'cancelAnimationFrame', {
  writable: true,
  value: (handle: number) => window.clearTimeout(handle),
});

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window, 'print', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window.URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'blob:mock'),
});

Object.defineProperty(window.URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: vi.fn(() => ({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
    })),
  })),
});

Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  writable: true,
  value: vi.fn(() => 'data:image/png;base64,AAAA'),
});

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn(),
});

if (typeof window.atob !== 'function') {
  window.atob = (value: string) => Buffer.from(value, 'base64').toString('binary');
}

if (typeof window.btoa !== 'function') {
  window.btoa = (value: string) => Buffer.from(value, 'binary').toString('base64');
}

window.initRDKitModule = vi.fn(async () => {
  throw new Error('RDKit is not available in UI tests');
});

afterEach(() => {
  cleanup();
});

vi.mock('react-konva', () => {
  const createNode = (displayName: string) => {
    const Component = React.forwardRef<unknown, React.PropsWithChildren<{ text?: string }>>(
      ({ children, text }, ref) => {
        React.useImperativeHandle(ref, () => ({}));
        return React.createElement(
          'div',
          { 'data-konva-node': displayName },
          text ?? null,
          children,
        );
      },
    );
    Component.displayName = displayName;
    return Component;
  };

  const Stage = React.forwardRef<unknown, React.PropsWithChildren>(({ children }, ref) => {
    const elementRef = React.useRef<HTMLDivElement | null>(null);
    React.useImperativeHandle(ref, () => ({
      toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
      container: () => elementRef.current ?? document.createElement('div'),
      getPointerPosition: () => ({ x: 0, y: 0 }),
    }));
    return React.createElement('div', { ref: elementRef, 'data-konva-node': 'Stage' }, children);
  });
  Stage.displayName = 'Stage';

  return {
    Stage,
    Layer: createNode('Layer'),
    Circle: createNode('Circle'),
    Line: createNode('Line'),
    Text: createNode('Text'),
    Group: createNode('Group'),
    Rect: createNode('Rect'),
    Shape: createNode('Shape'),
    Star: createNode('Star'),
  };
});
