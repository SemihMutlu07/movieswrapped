import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@/i18n/I18nProvider';
import ExportInstructions from '@/components/landing/ExportInstructions';

describe('ExportInstructions', () => {
  it('opens Letterboxd Data settings in a new tab', () => {
    render(
      <I18nProvider locale="en">
        <ExportInstructions />
      </I18nProvider>,
    );

    const link = screen.getByRole('link', { name: /open letterboxd export/i });
    expect(link).toHaveAttribute('href', 'https://letterboxd.com/settings/data/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
