import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeFiles, fileLooksLikeZip, handleApiError, isLetterboxdExportFilename, isLetterboxdZipFilename } from './api';

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

  it('treats Windows application/x-zip-compressed names as zip', () => {
    expect(isLetterboxdZipFilename('letterboxd-anlaki-2026-02-13-14-29-utc.zip')).toBe(true);
  });

  it('does not treat octet-stream CSV as a zip when magic is missing', async () => {
    const file = new File(['Date,Name,Year\n'], 'watched.csv', { type: 'application/octet-stream' });
    expect(await fileLooksLikeZip(file)).toBe(false);
  });
});

describe('handleApiError network failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not console.error Failed to fetch', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = handleApiError(new TypeError('Failed to fetch'), 'the backend');
    expect(spy).not.toHaveBeenCalled();
    expect(err.message).toMatch(/Failed to fetch/);
    expect((err as { code?: string }).code).toBe('backend_unreachable');
  });

  it('still console.errors unexpected API failures', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    handleApiError(new Error('boom'), 'file analysis');
    expect(spy).toHaveBeenCalled();
  });
});

describe('analyzeFiles cancellation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts the in-flight request instead of reporting a network error', async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }));
    const formData = new FormData();
    formData.append('files', new File(['Date,Name\n'], 'letterboxd.zip', { type: 'application/zip' }));

    const pending = analyzeFiles(formData, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
  });
});
