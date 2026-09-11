import { describe, expect, it } from 'vitest';

import { desktopHandoffUrl } from './desktopHandoff';

describe('desktopHandoffUrl', () => {
  it('keeps the landing URL so export instructions survive the jump', () => {
    expect(
      desktopHandoffUrl({
        surface: 'landing',
        href: 'https://movieswrapped.com/tr?utm=x',
        origin: 'https://movieswrapped.com',
        locale: 'tr',
      }),
    ).toBe('https://movieswrapped.com/tr?utm=x');
  });

  it('copies locale home from story, because session stats cannot follow the link', () => {
    expect(
      desktopHandoffUrl({
        surface: 'story',
        href: 'https://movieswrapped.com/en/story?u=alice',
        origin: 'https://movieswrapped.com',
        locale: 'en',
      }),
    ).toBe('https://movieswrapped.com/en');
  });

  it('copies locale home from results for the same session-storage reason', () => {
    expect(
      desktopHandoffUrl({
        surface: 'results',
        href: 'https://movieswrapped.com/tr/results?u=alice',
        origin: 'https://movieswrapped.com',
        locale: 'tr',
      }),
    ).toBe('https://movieswrapped.com/tr');
  });
});
