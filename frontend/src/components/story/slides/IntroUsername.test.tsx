import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IntroUsername } from './IntroUsername';

const CASES = [
  'sam',
  'semihmutsuz',
  'averyverylongletterboxdusername',
  'abcdefghijklmnopq',
] as const;

describe('IntroUsername', () => {
  it.each(CASES)('renders @%s with wrapping type instead of nowrap clipping', (username) => {
    render(
      <div style={{ width: 320 }}>
        <IntroUsername username={username} />
      </div>,
    );

    const text = screen.getByText(`@${username}`);
    expect(text).not.toHaveClass('whitespace-nowrap');
    expect(text.className).toMatch(/break-words/);
    expect(text.className).toMatch(/min-w-0/);
    expect(text.className).not.toMatch(/overflow-wrap:anywhere/);
  });

  it('uses the shared Big type scale', () => {
    render(<IntroUsername username="sam" />);
    const container = screen.getByTestId('intro-username-headline');
    const headline = container.querySelector('p');
    expect(headline).toBeTruthy();
    expect(headline?.className).toMatch(/clamp\(1\.45rem/);
  });
});
