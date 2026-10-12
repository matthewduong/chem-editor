import { test, expect } from '@playwright/test';

const xml =
  '<CDXML><page id="1"><fragment id="2"><n id="3" p="20 20"/><n id="4" p="40 20" Element="8"/><b id="5" B="3" E="4"/></fragment></page><page id="6"><t id="7"><s>Second page</s></t></page></CDXML>';

test('real module worker loads and saves the same document as synchronous processing', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (source) => {
    // Vite serves the real application modules, including the emitted module Worker.
    const asyncApi = (await import(
      /* @vite-ignore */ String('/src/lib/chemdrawDocumentCommandsAsync.ts')
    )) as typeof import('../../src/lib/chemdrawDocumentCommandsAsync');
    const syncApi = (await import(
      /* @vite-ignore */ String('/src/lib/chemdrawDocumentCommands.ts')
    )) as typeof import('../../src/lib/chemdrawDocumentCommands');
    const OriginalWorker = window.Worker;
    let started = 0;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        started++;
      }
    };
    try {
      const loaded = await asyncApi.loadChemDrawDocumentForCanvasAsync(source);
      const saved = await asyncApi.prepareChemDrawDocumentForSaveAsync({
        document: loaded.document,
      });
      const expected = syncApi.prepareChemDrawDocumentForSave({
        document: syncApi.loadChemDrawDocumentForCanvas(source).document,
      });
      return {
        started,
        pages:
          loaded.document.pages.length +
          (loaded.document.metadata?.preservedExtraPages?.length ?? 0),
        xml: saved.xml,
        expected: expected.xml,
      };
    } finally {
      window.Worker = OriginalWorker;
    }
  }, xml);
  expect(result.started).toBe(2);
  expect(result.pages).toBe(2);
  expect(result.xml).toBe(result.expected);
});

test('worker parser rejects malformed XML and cancellation without synchronous retries', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const api = (await import(
      /* @vite-ignore */ String('/src/lib/chemdrawDocumentCommandsAsync.ts')
    )) as typeof import('../../src/lib/chemdrawDocumentCommandsAsync');
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(String(args[0]));
    const capture = async (task: Promise<unknown>) => {
      try {
        await task;
        return 'resolved';
      } catch (e) {
        return (e as Error).name + ': ' + (e as Error).message;
      }
    };
    try {
      const malformed = await capture(
        api.loadChemDrawDocumentForCanvasAsync('<CDXML><page></CDXML>'),
      );
      const controller = new AbortController();
      const pending = api.loadChemDrawDocumentForCanvasAsync('<CDXML/>', {
        signal: controller.signal,
      });
      controller.abort();
      const aborted = await capture(pending);
      const timeout = await capture(
        api.loadChemDrawDocumentForCanvasAsync('<CDXML/>', { timeoutMs: 0 }),
      );
      return { malformed, aborted, timeout, warnings };
    } finally {
      console.warn = originalWarn;
    }
  });
  expect(result.malformed).toContain('Invalid CDXML');
  expect(result.aborted).toContain('AbortError');
  expect(result.timeout).toContain('timed out');
  expect(result.warnings).toEqual([]);
});
