import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPhoneDevice, usePhoneLayout } from './usePhoneLayout';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 13; SM-X810) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('isPhoneDevice', () => {
  it('treats iPhone and Android phones as phones', () => {
    expect(isPhoneDevice({ userAgent: IPHONE })).toBe(true);
    expect(isPhoneDevice({ userAgent: ANDROID_PHONE })).toBe(true);
    expect(isPhoneDevice({ userAgent: DESKTOP, userAgentData: { mobile: true } })).toBe(true);
  });

  it('keeps iPad, Android tablets, and desktop (narrow or not) on desktop', () => {
    expect(isPhoneDevice({ userAgent: IPAD })).toBe(false);
    expect(isPhoneDevice({ userAgent: ANDROID_TABLET })).toBe(false);
    expect(isPhoneDevice({ userAgent: DESKTOP })).toBe(false);
    expect(isPhoneDevice({ userAgent: DESKTOP, userAgentData: { mobile: false } })).toBe(false);
  });
});

describe('usePhoneLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays false on a desktop user agent', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: DESKTOP, userAgentData: undefined });
    const { result } = renderHook(() => usePhoneLayout());
    expect(result.current).toBe(false);
  });

  it('becomes true for an iPhone user agent', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: IPHONE, userAgentData: undefined });
    const { result } = renderHook(() => usePhoneLayout());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
