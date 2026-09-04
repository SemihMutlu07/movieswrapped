'use client';
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { fileLooksLikeZip, isLetterboxdExportFilename } from '@/lib/api';

type Props = {
  onFiles: (files: FileList | File[] | null) => void;
};

type FileWithRelativePath = File & { webkitRelativePath?: string };
type FileSystemFileHandleLike = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
};
type FileSystemDirectoryHandleLike = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<FileSystemFileHandleLike | FileSystemDirectoryHandleLike>;
};
type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
};
type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};
type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};
type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      error?: (error: DOMException) => void,
    ) => void;
  };
};
type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

function withRelativePath(file: File, relativePath: string): FileWithRelativePath {
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relativePath,
      configurable: true,
    });
  } catch {
    // Some browser File objects are not extensible. The file still uploads.
  }
  return file as FileWithRelativePath;
}

async function collectDirectoryFiles(
  directory: FileSystemDirectoryHandleLike,
  prefix = '',
): Promise<File[]> {
  const files: File[] = [];
  for await (const handle of directory.values()) {
    const relativePath = `${prefix}${handle.name}`;
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      if (/\.csv$/i.test(file.name)) files.push(withRelativePath(file, relativePath));
    } else {
      files.push(...await collectDirectoryFiles(handle, `${relativePath}/`));
    }
  }
  return files;
}

function readFileEntry(entry: FileSystemFileEntryLike, path: string): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(withRelativePath(file, `${path}${file.name}`)),
      reject,
    );
  });
}

function readDirectoryEntries(entry: FileSystemDirectoryEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader();
  const entries: FileSystemEntryLike[] = [];

  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function collectDroppedEntryFiles(entry: FileSystemEntryLike, path = ''): Promise<File[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntryLike, path);
    if (/\.csv$/i.test(file.name) || isLetterboxdExportFilename(file.name) || await fileLooksLikeZip(file)) {
      return [file];
    }
    return [];
  }

  if (!entry.isDirectory) return [];

  const directory = entry as FileSystemDirectoryEntryLike;
  const children = await readDirectoryEntries(directory);
  const files = await Promise.all(
    children.map((child) => collectDroppedEntryFiles(child, `${path}${entry.name}/`)),
  );
  return files.flat();
}

export default function UploadZone({ onFiles }: Props) {
  const { t } = useI18n();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
        event.preventDefault();
      }
    };

    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  const openFilePicker = useCallback(() => {
    document.getElementById('upload-zone-input')?.click();
  }, []);

  const openFolderPicker = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
    if (picker) {
      try {
        const directory = await picker.call(window);
        onFiles(await collectDirectoryFiles(directory));
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    folderInputRef.current?.click();
  }, [onFiles]);

  const collectDroppedFiles = useCallback(async (dataTransfer: DataTransfer) => {
    const items = Array.from(dataTransfer.items ?? []) as DataTransferItemWithEntry[];
    const entries = items
      .map((item) => item.webkitGetAsEntry?.() as FileSystemEntryLike | null | undefined)
      .filter((entry): entry is FileSystemEntryLike => !!entry);

    if (entries.length > 0) {
      const files = (await Promise.all(entries.map((entry) => collectDroppedEntryFiles(entry)))).flat();
      if (files.length > 0) return files;
    }

    return dataTransfer.files?.length ? dataTransfer.files : null;
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);
      onFiles(await collectDroppedFiles(e.dataTransfer));
    },
    [collectDroppedFiles, onFiles],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <section aria-label={t('landing.upload.zoneLabel')}>
      <div
        data-testid="upload-drop-zone"
        className={`group flex min-h-[220px] items-center justify-center rounded-2xl border p-8 text-center transition-all duration-300 sm:min-h-[260px] md:p-10 max-w-3xl mx-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50 ${
          isDragging
            ? 'border-orange-300 bg-orange-400/10 shadow-[0_0_60px_-16px_rgba(251,146,60,0.45)]'
            : 'border-slate-700/50 bg-slate-800/50 hover:border-orange-400/40 hover:shadow-[0_0_40px_-12px_rgba(251,146,60,0.15)]'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          id="upload-zone-input"
          type="file"
          multiple
          accept=".zip,.csv,.CSV,application/zip,application/x-zip-compressed,application/octet-stream"
          onChange={(e) => onFiles(e.target.files)}
          className="sr-only"
        />
        <input
          ref={(el) => {
            (folderInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
            if (el) (el as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
          }}
          type="file"
          multiple
          onChange={(e) => onFiles(e.target.files)}
          className="hidden"
        />
        <div className="flex flex-col items-center">
          <div className="mb-5 h-14 w-14 rounded-2xl bg-orange-500/10 border border-orange-400/25 flex items-center justify-center transition-colors group-hover:bg-orange-500/20">
            <Upload className="w-7 h-7 text-orange-300" />
          </div>
          <p className="text-xl sm:text-2xl font-bold tracking-tight">{t('landing.upload.zoneTitle')}</p>
          <p className="mt-2 text-sm text-slate-400">
            {isDragging ? t('landing.upload.drop') : t('landing.upload.drag')}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={openFilePicker}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-orange-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
            >
              <Upload className="h-4 w-4" />
              {t('landing.upload.chooseFiles')}
            </button>
            <button
              type="button"
              onClick={openFolderPicker}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-600 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-100 transition-colors hover:border-orange-300/70 hover:text-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-200"
            >
              <FolderOpen className="h-4 w-4" />
              {t('landing.upload.chooseFolder')}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">{t('landing.upload.folderHelp')}</p>
        </div>
      </div>
    </section>
  );
}
