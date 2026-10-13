'use client';
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { fileLooksLikeZip, isLetterboxdExportFilename } from '@/lib/api';
import type { UploadZoneTone } from '@/components/landing/landingTypes';

type Props = {
  onFiles: (files: FileList | File[] | null) => void;
  tone?: UploadZoneTone;
};

const TONE_STYLES: Record<UploadZoneTone, {
  shell: string;
  idle: string;
  dragging: string;
  showIcon: boolean;
  showCopy: boolean;
  icon: string;
  iconGlyph: string;
  title: string;
  hint: string;
  primary: string;
  secondary: string;
  help: string;
}> = {
  default: {
    showIcon: true,
    showCopy: true,
    shell: 'min-h-[220px] sm:min-h-[240px] p-6 sm:p-8 md:p-10',
    idle: 'rounded-2xl border-slate-700/50 bg-slate-800/50 hover:border-orange-400/40 hover:shadow-[0_0_40px_-12px_rgba(251,146,60,0.15)]',
    dragging: 'rounded-2xl border-orange-300 bg-orange-400/10 shadow-[0_0_60px_-16px_rgba(251,146,60,0.45)]',
    icon: 'rounded-2xl bg-orange-500/10 border border-orange-400/25 group-hover:bg-orange-500/20',
    iconGlyph: 'text-orange-300',
    title: 'text-xl sm:text-2xl font-bold tracking-tight',
    hint: 'text-sm text-slate-400',
    primary: 'rounded-full bg-orange-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-orange-300 focus-visible:ring-orange-200',
    secondary: 'rounded-full border border-slate-600 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-orange-300/70 hover:text-orange-100 focus-visible:ring-orange-200',
    help: 'text-xs text-slate-500',
  },
  wrapped: {
    showIcon: false,
    showCopy: false,
    shell: 'p-0',
    idle: 'rounded-none border-transparent bg-transparent',
    dragging: 'rounded-sm border-[#00e054] bg-[#00e054]/8 p-4',
    icon: 'rounded-sm bg-[#00e054]/10 border border-[#303840]',
    iconGlyph: 'text-[#00e054]',
    title: 'text-lg font-bold tracking-tight sm:text-xl',
    hint: 'text-sm text-[#9ab]',
    primary: 'rounded-sm bg-[#00e054] px-5 py-3 text-sm font-bold text-[#14181c] hover:bg-[#2ee36a] focus-visible:ring-[#00e054]',
    secondary: 'rounded-sm border border-[#456] bg-transparent px-5 py-3 text-sm font-semibold text-[#def] hover:border-[#9ab] focus-visible:ring-[#456]',
    help: 'text-xs text-[#678]',
  },
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

export default function UploadZone({ onFiles, tone = 'default' }: Props) {
  const { t } = useI18n();
  const styles = TONE_STYLES[tone];
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
        className={`group mx-auto flex max-w-3xl items-center justify-center border text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e054]/40 ${styles.shell} ${
          isDragging ? styles.dragging : styles.idle
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
        <div className="flex w-full flex-col items-center">
          {styles.showIcon ? (
            <div className={`mb-5 flex h-14 w-14 items-center justify-center transition-colors ${styles.icon}`}>
              <Upload className={`h-7 w-7 ${styles.iconGlyph}`} />
            </div>
          ) : null}
          {styles.showCopy ? (
            <>
              <p className={styles.title}>{t('landing.upload.zoneTitle')}</p>
              <p className={`mt-2 ${styles.hint}`}>
                {isDragging ? t('landing.upload.drop') : t('landing.upload.drag')}
              </p>
            </>
          ) : (
            <p className="sr-only">{isDragging ? t('landing.upload.drop') : t('landing.upload.zoneTitle')}</p>
          )}
          <div className={`flex w-full flex-col gap-3 ${styles.showCopy ? 'mt-6 sm:flex-row sm:justify-center' : ''}`}>
            <button
              type="button"
              onClick={openFilePicker}
              className={`inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 ${styles.primary} ${styles.showCopy ? '' : 'w-full'}`}
            >
              <Upload className="h-4 w-4" />
              {t('landing.upload.chooseFiles')}
            </button>
            {styles.showCopy ? (
              <button
                type="button"
                onClick={openFolderPicker}
                className={`inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 ${styles.secondary}`}
              >
                <FolderOpen className="h-4 w-4" />
                {t('landing.upload.chooseFolder')}
              </button>
            ) : (
              <button
                type="button"
                onClick={openFolderPicker}
                className="text-sm text-[#9ab] underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e054]/40"
              >
                {t('landing.upload.chooseFolder')}
              </button>
            )}
          </div>
          {styles.showCopy ? <p className={`mt-3 ${styles.help}`}>{t('landing.upload.folderHelp')}</p> : null}
        </div>
      </div>
    </section>
  );
}
