import type { RefObject } from 'react';

import type { NormalizedError } from '@/lib/errors';

export type UploadZoneTone = 'default' | 'wrapped';

export type LandingViewProps = {
  showUsernameScrape: boolean;
  allowPhoneUpload: boolean;
  isPhone: boolean;
  backendOffline: boolean;
  translatedError: NormalizedError | null;
  usernameInput: string;
  setUsernameInput: (value: string) => void;
  usernameFocused: boolean;
  setUsernameFocused: (value: boolean) => void;
  usernamePlaceholder: string;
  uploadSectionRef: RefObject<HTMLElement | null>;
  handleFiles: (files: FileList | File[] | null) => void;
  handleScrape: () => void;
  handleRetry: () => void;
  clearError: () => void;
};
