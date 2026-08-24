import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResultsTopBar from './ResultsTopBar';
import { I18nProvider } from '@/i18n/I18nProvider';

vi.mock('@/components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher">EN TR</div>,
}));

describe('ResultsTopBar', () => {
  it('stacks language and stats-window controls instead of sharing one overlapping row', () => {
    const { container } = render(
      <I18nProvider locale="en">
        <ResultsTopBar
          hasYearWindow
          statsWindow="lifetime"
          onStatsWindowChange={() => {}}
        />
      </I18nProvider>,
    );

    const layout = container.querySelector('.grid');
    expect(layout?.className).toMatch(/grid-cols-1/);
    expect(layout?.className).toMatch(/sm:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
    expect(screen.getByRole('button', { name: 'All Time' }).className).toMatch(/whitespace-nowrap/);
    expect(screen.getByRole('button', { name: 'Last 12 Months' }).className).toMatch(/whitespace-nowrap/);
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
  });
});
