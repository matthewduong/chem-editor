import { test, expect } from '@playwright/test';
import {
  openEditor,
  tool,
  drag,
  point,
  observe,
  documentPoint,
  dragDocument,
} from './editorHelpers';

for (const scale of [1, 2]) {
  test.describe(`gestures at device scale ${scale}`, () => {
    test.use({ deviceScaleFactor: scale, viewport: { width: 1440, height: 1000 } });
    test('bond drawing, cancellation, undo/redo and native serialization', async ({ page }) => {
      await openEditor(page);
      await tool(page, 'Bond Tool');
      const before = await observe(page);
      await drag(page, { x: 500, y: 400 }, { x: 540, y: 420 });
      await expect.poll(async () => (await observe(page)).atoms.length).toBe(2);
      const drawn = await observe(page);
      expect(drawn.historyIndex).toBe(before.historyIndex + 1);
      expect(drawn.bonds).toHaveLength(1);
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await observe(page)).atoms.length).toBe(0);
      await page.keyboard.press('Control+y');
      await expect.poll(async () => (await observe(page)).atoms.length).toBe(2);
      const p = await point(page, 700, 500);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 70, p.y + 40);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect((await observe(page)).document).toEqual(drawn.document);
      expect((await observe(page)).historyIndex).toBe(drawn.historyIndex);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 50, p.y);
      await tool(page, 'Select');
      await page.mouse.up();
      expect((await observe(page)).document).toEqual(drawn.document);
      const reopened = await page.evaluate(async (document) => {
        const codec = (await import(
          String('/src/utils/cdxml.ts')
        )) as typeof import('../../src/utils/cdxml');
        const xml = codec.chemDrawDocumentToCDXML(document!);
        const reopened = codec.cdxmlToChemDrawDocument(xml).document;
        return {
          xml,
          again: codec.chemDrawDocumentToCDXML(reopened),
          ids: reopened.pages[0].objects.map((o) => o.id),
        };
      }, drawn.document);
      expect(reopened.again).toBe(reopened.xml);
      expect(reopened.ids).toHaveLength(drawn.document!.pages[0].objects.length);
      expect(new Set(reopened.ids).size).toBe(reopened.ids.length);
    });
    test('ring closure, attached ring template, label edit and selection movement', async ({
      page,
    }) => {
      await openEditor(page);
      await tool(page, 'Bond Tool');
      await drag(page, { x: 500, y: 400 }, { x: 540, y: 400 });
      let state = await observe(page);
      const first = state.atoms[0]!,
        second = state.atoms[1]!;
      await dragDocument(page, second, { x: second.x + 25, y: second.y + 30 });
      state = await observe(page);
      const third = state.atoms[2]!;
      await dragDocument(page, third, first);
      state = await observe(page);
      expect(state.atoms).toHaveLength(3);
      expect(state.bonds).toHaveLength(3);
      const oldIds = state.atoms.map((a) => a.id);
      // Ring presets retain their established atom-attachment gesture.
      await page.getByTitle('Cyclohexane', { exact: true }).first().click();
      const target = await documentPoint(page, third.x, third.y);
      await page.mouse.click(target.x, target.y);
      state = await observe(page);
      expect(state.atoms.length).toBeGreaterThan(3);
      for (const id of oldIds) expect(state.atoms.some((a) => a.id === id)).toBe(true);
      await tool(page, 'Select');
      const p = await documentPoint(page, first.x, first.y);
      await page.mouse.dblclick(p.x, p.y);
      await page.locator('input[value="C"]').first().fill('N');
      await page.keyboard.press('Enter');
      state = await observe(page);
      expect(state.atoms.some((a) => a.element === 'N')).toBe(true);
      await page.keyboard.press('Control+a');
      const beforeMove = await observe(page);
      await dragDocument(page, first, { x: first.x + 45, y: first.y + 20 });
      const moved = await observe(page);
      expect(moved.historyIndex).toBe(beforeMove.historyIndex + 1);
      expect(moved.atoms.map((a) => a.id)).toEqual(beforeMove.atoms.map((a) => a.id));
      await page.keyboard.press('Control+z');
      expect((await observe(page)).document).toEqual(beforeMove.document);
    });
    test('zoomed gestures and partial cleanup rejection leave history consistent', async ({
      page,
    }) => {
      await openEditor(page);
      await tool(page, 'Bond Tool');
      const mouse = await point(page, 550, 450);
      await page.mouse.move(mouse.x, mouse.y);
      await page.mouse.wheel(0, -200);
      await drag(page, { x: 500, y: 400 }, { x: 550, y: 410 });
      await tool(page, 'Select');
      const drawn = await observe(page);
      const a = drawn.atoms[0]!;
      const p = await documentPoint(page, a.x, a.y);
      await page.mouse.click(p.x, p.y);
      const before = await observe(page);
      expect(before.selected).toHaveLength(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await expect(page.getByText(/Cleanup requires every atom/)).toBeVisible();
      const after = await observe(page);
      expect(after.document).toEqual(before.document);
      expect(after.historyIndex).toBe(before.historyIndex);
      expect(after.dirty).toBe(before.dirty);
    });
    test('engine failure explains unavailable cleanup while drawing remains usable', async ({
      page,
    }) => {
      await page.route('**/RDKit_minimal.wasm', (route) => route.abort());
      await openEditor(page);
      await tool(page, 'Bond Tool');
      await drag(page, { x: 500, y: 400 }, { x: 540, y: 420 });
      const before = await observe(page);
      await page.keyboard.press('Control+k');
      await expect(page.getByText('RDKit is unavailable.', { exact: true })).toBeVisible();
      expect((await observe(page)).document).toEqual(before.document);
      expect((await observe(page)).historyIndex).toBe(before.historyIndex);
    });
    test('chain preview commits once and cancellation creates no history', async ({ page }) => {
      await openEditor(page);
      await tool(page, 'Chain');
      const before = await observe(page);
      const a = await point(page, 500, 400),
        b = await point(page, 750, 420);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await expect(page.getByRole('status')).toContainText('added atoms');
      expect((await observe(page)).document).toEqual(before.document);
      await page.mouse.up();
      const after = await observe(page);
      expect(after.atoms.length).toBeGreaterThan(3);
      expect(after.historyIndex).toBe(before.historyIndex + 1);
      await dragDocument(page, after.atoms.at(-1)!, {
        x: after.atoms.at(-1)!.x + 50,
        y: after.atoms.at(-1)!.y + 10,
      });
      const extended = await observe(page);
      expect(extended.atoms.length).toBeGreaterThan(after.atoms.length);
      await page.keyboard.press('Control+z');
      expect((await observe(page)).document).toEqual(after.document);
      await page.mouse.move(a.x + 50, a.y + 150);
      await page.mouse.down();
      await page.mouse.move(b.x + 50, b.y + 150);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect((await observe(page)).document).toEqual(after.document);
      expect((await observe(page)).historyIndex).toBe(after.historyIndex);
    });
    test('diagnostics do not edit and become obsolete after drawing', async ({ page }) => {
      await openEditor(page);
      await tool(page, 'Bond Tool');
      await drag(page, { x: 500, y: 400 }, { x: 540, y: 420 });
      const before = await observe(page);
      await page.getByTitle('Check Structure', { exact: true }).click();
      const panel = page.getByRole('complementary', { name: 'Structure diagnostics' });
      await expect(panel.getByText('No issues found by the available checks.')).toBeVisible();
      await expect(panel.getByText(/Stereo completeness/)).toBeVisible();
      expect((await observe(page)).document).toEqual(before.document);
      expect((await observe(page)).historyIndex).toBe(before.historyIndex);
      await drag(page, { x: 500, y: 600 }, { x: 540, y: 620 });
      await expect(panel.getByText(/Document changed/)).toBeVisible();
    });
    test('save selection, search and insert native templates with cancel and undo', async ({
      page,
    }) => {
      await openEditor(page);
      await tool(page, 'Bond Tool');
      await drag(page, { x: 500, y: 400 }, { x: 540, y: 420 });
      await page.keyboard.press('Control+a');
      const before = await observe(page);
      await page.getByTitle('Templates', { exact: true }).click();
      await page.getByLabel('Template name', { exact: true }).fill('Ethyl');
      await page.getByLabel('Template tags', { exact: true }).fill('alkyl');
      await page.getByRole('button', { name: 'Save selection', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Ethyl', exact: true })).toBeVisible();
      expect((await observe(page)).historyIndex).toBe(before.historyIndex);
      await page.getByLabel('Template search').fill('alkyl');
      await page.getByRole('button', { name: 'Insert', exact: true }).click();
      const p = await point(page, 700, 600);
      await page.mouse.move(p.x, p.y);
      expect((await observe(page)).document).toEqual(before.document);
      await page.mouse.click(p.x, p.y);
      const inserted = await observe(page);
      expect(inserted.atoms).toHaveLength(4);
      expect(new Set(inserted.atoms.map((a) => a.id)).size).toBe(4);
      expect(inserted.historyIndex).toBe(before.historyIndex + 1);
      await page.keyboard.press('Control+z');
      expect((await observe(page)).document).toEqual(before.document);
      await page.getByTitle('Templates', { exact: true }).click();
      await page.getByRole('button', { name: 'Insert', exact: true }).click();
      await page.mouse.move(p.x, p.y);
      await page.keyboard.press('Escape');
      // Escape returns to the selected tool; test cancellation before a new drawing click.
      expect((await observe(page)).historyIndex).toBe(before.historyIndex);
    });
    test('cleanup preserves identities and is one undoable gesture', async ({ page }) => {
      await openEditor(page);
      await tool(page, 'Bond Tool');
      await drag(page, { x: 500, y: 400 }, { x: 540, y: 420 });
      const before = await observe(page);
      await page.keyboard.press('Control+k');
      await expect
        .poll(async () => (await observe(page)).historyIndex)
        .toBe(before.historyIndex + 1);
      const after = await observe(page);
      expect(after.atoms.map((a) => a.id)).toEqual(before.atoms.map((a) => a.id));
      expect(after.bonds).toEqual(before.bonds);
      await page.keyboard.press('Control+z');
      expect((await observe(page)).document).toEqual(before.document);
    });
  });
}
