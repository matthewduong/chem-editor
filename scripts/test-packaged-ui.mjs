/* global window */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { remote } from 'webdriverio';

const application = path.resolve(process.argv[2]);
const work = mkdtempSync(path.join(tmpdir(), 'chem-native-ui-'));
const fixture = path.join(work, 'acceptance.cdxml');
const original =
  '<CDXML><page id="1"><fragment id="2"><n id="3" p="30 30"/><n id="4" p="50 30" Element="8"/><b id="5" B="3" E="4"/></fragment></page></CDXML>';
writeFileSync(fixture, original);
const driver = spawn('tauri-driver', [], { cwd: work, stdio: 'inherit', env: process.env });
let browser;
const until = async (predicate, message) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(message);
};
try {
  await until(async () => {
    try {
      return (await fetch('http://127.0.0.1:4444/status')).ok;
    } catch {
      return false;
    }
  }, 'tauri-driver did not start');
  browser = await remote({
    hostname: '127.0.0.1',
    port: 4444,
    logLevel: 'warn',
    capabilities: { 'tauri:options': { application } },
  });
  await browser.setTimeout({ script: 120_000 });
  await browser.$('canvas').waitForExist({ timeout: 30_000 });
  // Seed a recent-file entry through the real settings IPC, then exercise the normal Open path.
  await browser.executeAsync((file, done) => {
    window.__TAURI_INTERNALS__
      .invoke('save_app_settings', {
        content: JSON.stringify({
          recentFiles: [{ path: file, name: 'Acceptance fixture', openedAt: Date.now() }],
        }),
      })
      .then(
        () => done(true),
        (error) => done({ error: String(error) }),
      );
  }, fixture);
  await browser.refresh();
  await browser.$('button=File').click();
  await browser.$('button*=Acceptance fixture').waitForExist({ timeout: 30_000 });
  await browser.$('button*=Acceptance fixture').click();
  await until(
    async () =>
      (await browser.getTitle()).includes('acceptance') ||
      (await browser.$('body').getText()).includes('acceptance'),
    'Document did not open',
  );
  const invoke = (command, args) =>
    browser.executeAsync(
      (name, params, done) => {
        window.__TAURI_INTERNALS__
          .invoke(name, params)
          .then(done, (error) => done({ error: String(error) }));
      },
      command,
      args,
    );
  const properties = await invoke('compute_properties', { smiles: 'CCO' });
  assert(!properties.error, JSON.stringify(properties));
  const conformer = await invoke('generate_conformers', {
    smiles: 'CCO',
    forceField: 'MMFF94s',
    maxConformers: 1,
  });
  assert.equal(conformer.conformers?.length, 1, JSON.stringify(conformer));
  await invoke('plugin:clipboard-manager|write_text', { text: 'ChemEditor acceptance' });
  assert.equal(await invoke('plugin:clipboard-manager|read_text', {}), 'ChemEditor acceptance');
  // Save uses the normal native writer and inspects the actual file, without a store bridge.
  const saveDocument = async () => {
    const modified = statSync(fixture).mtimeMs;
    await browser.keys(['Control', 's']);
    await until(
      () => statSync(fixture).mtimeMs !== modified,
      'Native save did not write the document',
    );
    return readFileSync(fixture, 'utf8');
  };
  const before = await saveDocument();
  assert.match(before, /<CDXML/);
  await browser.keys('Escape');
  await browser.keys('x');
  const canvas = await browser.$('.konvajs-content');
  await canvas.click({ x: 100, y: 80 });
  const edited = await saveDocument();
  assert.notEqual(edited, before, 'Canvas edit did not change the document');
  await browser.keys(['Control', 'z']);
  assert.equal(await saveDocument(), before, 'Undo did not restore the imported document');
  await browser.keys(['Control', 'Shift', 'z']);
  assert.equal(await saveDocument(), edited, 'Redo did not restore the edit');
  await browser.keys(['Control', 'k']);
  const cleaned = await saveDocument();
  for (const id of ['3', '4', '5'])
    assert.match(cleaned, new RegExp(`id="${id}"`), 'Cleanup changed imported identities');
  await browser.keys(['Control', 'z']);
  assert.equal(await saveDocument(), edited, 'Cleanup undo did not restore the document');
  await browser.keys(['Control', 'a']);
  const priorLibrary = await invoke('load_template_library', {});
  assert(!priorLibrary?.error, JSON.stringify(priorLibrary));
  const templateName = `Packaged acceptance ${Date.now()}`;
  await browser.$('[title="Templates"]').click();
  await browser.$('[aria-label="Template name"]').setValue(templateName);
  await browser.$('[aria-label="Template tags"]').setValue('packaged-acceptance');
  await browser.$('button=Save selection').click();
  await browser.$(`button=${templateName}`).waitForExist();
  const savedLibrary = await invoke('load_template_library', {});
  assert(JSON.parse(savedLibrary).templates.some((t) => t.name === templateName));
  await browser.$('[aria-label="Close templates"]').click();
  await browser.saveScreenshot(path.join(work, 'edited.png'));
  // These exports use the real native dialog and atomic filesystem writer.
  for (const [label, extension] of [
    ['PNG Image', 'png'],
    ['SVG Vector', 'svg'],
  ]) {
    const output = path.join(work, `export.${extension}`);
    await browser.$('button=File').click();
    await browser.$('button*=Export As').moveTo();
    await browser.$(`button=${label}`).click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result =
      process.platform === 'win32'
        ? spawnSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              '$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys("%n"); $ws.SendKeys($env:CHEM_EXPORT_PATH); $ws.SendKeys("{ENTER}")',
            ],
            { env: { ...process.env, CHEM_EXPORT_PATH: output }, encoding: 'utf8' },
          )
        : spawnSync('xdotool', ['key', '--clearmodifiers', 'ctrl+l'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    if (process.platform !== 'win32') {
      assert.equal(spawnSync('xdotool', ['type', '--clearmodifiers', '--', output]).status, 0);
      assert.equal(spawnSync('xdotool', ['key', 'Return']).status, 0);
    }
    await until(() => existsSync(output), `${label} did not save`);
    const bytes = readFileSync(output);
    if (extension === 'png') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    else assert.match(bytes.toString(), /<svg/);
  }
  await browser.keys('x');
  await browser.$('.konvajs-content').click({ x: 140, y: 100 });
  await until(
    async () => Boolean(await invoke('load_document_recovery', {})),
    'Native autosave did not create recovery data',
  );
  await invoke('plugin:window|close', { label: 'main' });
  await browser.$('[role="dialog"]').waitForExist();
  assert.match(await browser.$('[role="dialog"]').getText(), /Save your changes/);
  await browser.$('[role="dialog"] button=Cancel').click();
  await browser.$('canvas').waitForExist();
  await browser.$('button=File').click();
  await browser.$('button=New').click();
  await browser.$('[role="dialog"]').waitForExist();
  await browser.$('[role="dialog"] button=Cancel').click();
  // End the process without resolving the dirty document, then launch the same installed app.
  await browser.deleteSession();
  browser = await remote({
    hostname: '127.0.0.1',
    port: 4444,
    logLevel: 'warn',
    capabilities: { 'tauri:options': { application } },
  });
  await browser.$('[role="dialog"]').waitForExist({ timeout: 30_000 });
  assert.match(await browser.$('[role="dialog"]').getText(), /Recover unsaved drawing/);
  await browser.$('[role="dialog"] button=Recover').click();
  const restartedLibrary = await invoke('load_template_library', {});
  assert(
    JSON.parse(restartedLibrary).templates.some((t) => t.name === templateName),
    'Template did not survive native restart',
  );
  await invoke('save_template_library', {
    contents: priorLibrary ?? JSON.stringify({ version: 1, templates: [] }),
    expected: restartedLibrary,
  });
  await browser.$('button=File').click();
  await browser.$('button=New').click();
  await browser.$('[role="dialog"]').waitForExist();
  await browser.$('[role="dialog"] button=Discard').click();
  await until(
    async () => (await browser.getTitle()).includes('Untitled'),
    'New did not clear the recovered document',
  );
  writeFileSync(
    process.env.UI_CHECK_REPORT ?? path.join(work, 'ui-check.json'),
    JSON.stringify(
      {
        application,
        work,
        checks: [
          'native properties',
          'native conformer',
          'native clipboard',
          'open',
          'edit',
          'undo',
          'redo',
          'native save',
          'coordinate-only cleanup and undo',
          'template save and native restart persistence',
          'PNG export',
          'SVG export',
          'close cancel',
          'new cancel/discard',
          'native recovery after process restart',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (process.env.UI_CHECK_REPORT) {
    const { cpSync } = await import('node:fs');
    cpSync(work, path.join(path.dirname(process.env.UI_CHECK_REPORT), 'native-ui-evidence'), {
      recursive: true,
    });
  }
  await browser?.deleteSession();
  driver.kill();
}
