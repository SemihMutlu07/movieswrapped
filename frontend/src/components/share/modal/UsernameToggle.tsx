'use client';

import { useI18n } from '@/i18n/I18nProvider';

type UsernameToggleProps = {
  username: string;
  showUsername: boolean;
  isSaving: boolean;
  onToggle: () => void;
};

export function UsernameToggle({ username, showUsername, isSaving, onToggle }: UsernameToggleProps) {
  const { t } = useI18n();

  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
      <span>{t('share.showUsernameValue').replace('{username}', username)}</span>
      <button
        type="button"
        role="switch"
        aria-checked={showUsername}
        aria-label={t('share.showUsername')}
        onClick={onToggle}
        disabled={isSaving}
        className={`relative h-6 w-11 rounded-full transition-colors ${showUsername ? 'bg-white' : 'bg-white/20'}`}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full transition-transform ${showUsername ? 'left-6 bg-black' : 'left-1 bg-white'}`} />
      </button>
    </label>
  );
}
