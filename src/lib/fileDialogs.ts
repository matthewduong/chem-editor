import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile } from '@tauri-apps/plugin-fs';
import { invokeTauri } from './tauri';

export async function writeFileAtomically(path: string, contents: Uint8Array): Promise<void> {
  await invokeTauri('atomic_write_file', { path, contents: Array.from(contents) });
}

export type ChemicalTextExtension = 'cdxml' | 'mol' | 'sdf' | 'xyz' | 'pdb' | 'cif';

const CHEMICAL_FILE_FILTERS = [
  { name: 'All Supported', extensions: ['cdxml', 'mol', 'sdf', 'xyz', 'pdb', 'cif'] },
  { name: 'Chemical Formats', extensions: ['mol', 'sdf', 'xyz', 'cdxml', 'pdb', 'cif'] },
] as const;
const IMAGE_FILE_FILTERS = [
  { name: 'Raster Images', extensions: ['png', 'jpg', 'jpeg'] },
  { name: 'All Supported Images', extensions: ['png', 'jpg', 'jpeg'] },
] as const;

function normalizedExtension(filePath: string): string | null {
  const extension = filePath.split('.').pop()?.trim().toLowerCase();
  return extension ? extension : null;
}

export function getFileDisplayName(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : filePath;
}

function assertChemicalTextExtension(filePath: string): ChemicalTextExtension {
  const extension = normalizedExtension(filePath);
  if (
    extension !== 'cdxml' &&
    extension !== 'mol' &&
    extension !== 'sdf' &&
    extension !== 'xyz' &&
    extension !== 'pdb' &&
    extension !== 'cif'
  ) {
    throw new Error(`Unsupported file extension for ${filePath}`);
  }
  return extension;
}

export async function openChemicalTextFile(): Promise<{
  filePath: string;
  extension: ChemicalTextExtension;
  content: string;
} | null> {
  const selectedPath = await open({
    multiple: false,
    filters: CHEMICAL_FILE_FILTERS.map((filter) => ({
      name: filter.name,
      extensions: [...filter.extensions],
    })),
  });
  if (!selectedPath || Array.isArray(selectedPath)) {
    return null;
  }

  const extension = assertChemicalTextExtension(selectedPath);

  return {
    filePath: selectedPath,
    extension,
    content: await readTextFile(selectedPath),
  };
}

export async function readChemicalTextFileAtPath(filePath: string): Promise<{
  filePath: string;
  extension: ChemicalTextExtension;
  content: string;
}> {
  return {
    filePath,
    extension: assertChemicalTextExtension(filePath),
    content: await readTextFile(filePath),
  };
}

export async function openImageBinaryFile(): Promise<{
  filePath: string;
  extension: 'png' | 'jpg' | 'jpeg';
  mimeType: 'image/png' | 'image/jpeg';
  content: Uint8Array;
} | null> {
  const selectedPath = await open({
    multiple: false,
    filters: IMAGE_FILE_FILTERS.map((filter) => ({
      name: filter.name,
      extensions: [...filter.extensions],
    })),
  });
  if (!selectedPath || Array.isArray(selectedPath)) return null;

  const extension = normalizedExtension(selectedPath);
  if (extension !== 'png' && extension !== 'jpg' && extension !== 'jpeg') {
    throw new Error(`Unsupported image extension for ${selectedPath}`);
  }

  return {
    filePath: selectedPath,
    extension,
    mimeType: extension === 'png' ? 'image/png' : 'image/jpeg',
    content: await readFile(selectedPath),
  };
}

export async function saveTextWithDialog(options: {
  title: string;
  defaultPath: string;
  extensions: string[];
  name: string;
  content: string;
}): Promise<string | null> {
  const selectedPath = await save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: [{ name: options.name, extensions: options.extensions }],
  });
  if (!selectedPath) {
    return null;
  }
  await writeFileAtomically(selectedPath, new TextEncoder().encode(options.content));
  return selectedPath;
}

export async function saveTextToPath(filePath: string, content: string): Promise<string> {
  await writeFileAtomically(filePath, new TextEncoder().encode(content));
  return filePath;
}

export async function saveBinaryWithDialog(options: {
  title: string;
  defaultPath: string;
  extensions: string[];
  name: string;
  content: Uint8Array;
}): Promise<string | null> {
  const selectedPath = await save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: [{ name: options.name, extensions: options.extensions }],
  });
  if (!selectedPath) {
    return null;
  }
  await writeFileAtomically(selectedPath, options.content);
  return selectedPath;
}
