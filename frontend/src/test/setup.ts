import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('next/image', async () => {
  const React = await import('react');
  return {
    default: ({
      src,
      alt,
    }: {
      src: string | { src?: string };
      alt?: string;
    }) => {
      const href = typeof src === 'string' ? src : src?.src ?? '';
      return React.createElement('img', { src: href, alt: alt ?? '' });
    },
  };
});

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
}
