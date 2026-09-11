'use client';

import { useEffect, useState } from 'react';

type NavigatorLike = {
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
};

/** Real phones only. iPad / desktop (including a shrunk window) stay on the upload path. */
export function isPhoneDevice(nav?: NavigatorLike | null): boolean {
  const source: NavigatorLike | null =
    nav ?? (typeof navigator === 'undefined' ? null : (navigator as NavigatorLike));
  if (!source) return false;
  if (source.userAgentData?.mobile) return true;
  // ponytail: UA, not viewport — Chrome device-mode still spoofs UA
  return /iPhone|iPod|Android.+Mobile/i.test(source.userAgent ?? '');
}

/**
 * Desktop-first: false until mount. Avoids flashing the phone gate on a computer,
 * and keeps jsdom on the desktop story path.
 */
export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    setPhone(isPhoneDevice());
  }, []);

  return phone;
}
