import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';

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

  const extension = normalizedExtension(selectedPath);
  if (
    extension !== 'cdxml' &&
    extension !== 'mol' &&
    extension !== 'sdf' &&
    extension !== 'xyz' &&
    extension !== 'pdb' &&
    extension !== 'cif'
  ) {
    throw new Error(`Unsupported file extension for ${selectedPath}`);
  }

  return {
    filePath: selectedPath,
    extension,
    content: await readTextFile(selectedPath),
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
  await writeTextFile(selectedPath, options.content);
  return selectedPath;
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
  await writeFile(selectedPath, options.content);
  return selectedPath;
}
