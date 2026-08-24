import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useCompactLayout } from './useCompactLayout';

function stubCompact(compact: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: compact,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('useCompactLayout', () => {
  it('is compact on a 390px-class viewport', () => {
    stubCompact(true);
    const { result } = renderHook(() => useCompactLayout());
    expect(result.current).toBe(true);
  });

  it('is expanded on a desktop viewport', () => {
    stubCompact(false);
    const { result } = renderHook(() => useCompactLayout());
    expect(result.current).toBe(false);
  });
});
