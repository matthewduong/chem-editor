import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: mocks.open,
  save: mocks.save,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: mocks.readFile,
  readTextFile: mocks.readTextFile,
  writeFile: mocks.writeFile,
  writeTextFile: mocks.writeTextFile,
}));

describe('file dialog helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads chemical text files directly from a path', async () => {
    const { readChemicalTextFileAtPath } = await import('../../src/lib/fileDialogs');
    mocks.readTextFile.mockResolvedValue('<CDXML />');

    await expect(readChemicalTextFileAtPath('/tmp/sketch.cdxml')).resolves.toEqual({
      filePath: '/tmp/sketch.cdxml',
      extension: 'cdxml',
      content: '<CDXML />',
    });
  });

  it('rejects unsupported direct path extensions', async () => {
    const { readChemicalTextFileAtPath } = await import('../../src/lib/fileDialogs');

    await expect(readChemicalTextFileAtPath('/tmp/sketch.txt')).rejects.toThrow(
      /Unsupported file extension/,
    );
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it('writes text directly to an existing path', async () => {
    const { saveTextToPath } = await import('../../src/lib/fileDialogs');

    await expect(saveTextToPath('/tmp/sketch.cdxml', '<CDXML />')).resolves.toBe(
      '/tmp/sketch.cdxml',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith('/tmp/sketch.cdxml', '<CDXML />');
  });

  it('derives display names across path separators', async () => {
    const { getFileDisplayName } = await import('../../src/lib/fileDialogs');

    expect(getFileDisplayName('/tmp/sketch.cdxml')).toBe('sketch.cdxml');
    expect(getFileDisplayName('C:\\Users\\me\\sketch.cdxml')).toBe('sketch.cdxml');
  });
});
