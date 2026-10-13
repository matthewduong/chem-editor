import { expect, type Page } from '@playwright/test';

/** Browser-only observations; no production globals or native bridge. */
export async function observe(page: Page) {
  return page.evaluate(async () => {
    const { useStore } = (await import(
      String('/src/store/index.ts')
    )) as typeof import('../../src/store');
    const s = useStore.getState();
    return {
      document: s.chemDrawDocument,
      atoms: s.atoms,
      bonds: s.bonds,
      historyIndex: s.historyIndex,
      revision: s.documentRevision,
      dirty: s.documentFile.dirty,
      selected: [...s.selectedAtomIds],
    };
  });
}
export async function openEditor(page: Page) {
  await page.goto('/');
  await expect(page.locator('.konvajs-content')).toBeVisible();
  await page.getByRole('button', { name: 'Expand Structure', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Canvas', exact: true }).click();
}
export async function tool(page: Page, title: string) {
  await page.getByTitle(title, { exact: true }).click();
}
export async function point(page: Page, x: number, y: number) {
  const box = await page.locator('.konvajs-content').boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  return { x: box.x + x, y: box.y + y };
}
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const a = await point(page, from.x, from.y),
    b = await point(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

export async function documentPoint(page: Page, x: number, y: number) {
  const view = await page.evaluate(async () => {
    const observation = (await import(
      String('/tests/browser/editorObservation.ts')
    )) as typeof import('./editorObservation');
    return observation.viewport();
  });
  return point(page, x * view.scale + view.x, y * view.scale + view.y);
}
export async function dragDocument(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const a = await documentPoint(page, from.x, from.y),
    b = await documentPoint(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}
