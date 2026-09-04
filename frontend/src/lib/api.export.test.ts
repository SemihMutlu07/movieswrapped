import { describe, expect, it } from 'vitest';
import { fileLooksLikeZip, isLetterboxdExportFilename, isLetterboxdZipFilename } from './api';

describe('Letterboxd export file detection', () => {
  it('treats extensionless Letterboxd utc downloads as zip names', () => {
    expect(isLetterboxdZipFilename('letterboxd-anlaki-2026-02-13-14-29-utc')).toBe(true);
    expect(isLetterboxdExportFilename('letterboxd-anlaki-2026-02-13-14-29-utc')).toBe(true);
  });

  it('detects a zip by PK magic bytes even when the name is Unknown', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const file = new File([bytes], 'Unknown', { type: 'application/octet-stream' });
    expect(isLetterboxdZipFilename(file.name)).toBe(false);
    expect(await fileLooksLikeZip(file)).toBe(true);
  });

  it('does not treat a csv as a zip', async () => {
    const file = new File(['Date,Name\n'], 'reviews.csv', { type: 'text/csv' });
    expect(isLetterboxdExportFilename(file.name)).toBe(true);
    expect(await fileLooksLikeZip(file)).toBe(false);
  });
});
