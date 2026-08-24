/** Shared story-shell metrics so top chrome, safe-area, and locale control stay aligned. */

export function isStoryPath(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  return path === '/story' || path.endsWith('/story');
}
