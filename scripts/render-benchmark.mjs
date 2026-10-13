import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';

if (process.env.CHEM_RENDER_BENCH !== '1') {
  console.log(
    'Benchmark is opt-in. Run CHEM_RENDER_BENCH=1 pnpm benchmark:render [output.json] [baseline.json].\n' +
      'Optional: CHEM_RENDER_BENCH_SIZES=100,1000 (default 100,1000,5000), CHEM_RENDER_BENCH_SAMPLES=1..5\n' +
      '(default and maximum 5), CHEM_RENDER_BENCH_TIMEOUT_MS per case (default 180000).',
  );
  process.exit(0);
}
const MAX_SAMPLES = 5;
const sizes = (process.env.CHEM_RENDER_BENCH_SIZES ?? '100,1000,5000')
  .split(',')
  .map((v) => Number(v.trim()));
if (sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 20000)) {
  console.error('CHEM_RENDER_BENCH_SIZES must be a comma list of integers from 1 to 20000.');
  process.exit(2);
}
const samples = Math.min(
  MAX_SAMPLES,
  Math.max(1, Number(process.env.CHEM_RENDER_BENCH_SAMPLES ?? MAX_SAMPLES) || MAX_SAMPLES),
);
const caseTimeout = Number(process.env.CHEM_RENDER_BENCH_TIMEOUT_MS ?? 180000);
const outPath = process.argv[2] ?? '/tmp/chem-render-benchmark.json';
const server = spawn(
  'node_modules/.bin/vite',
  ['--host', '127.0.0.1', '--port', '1430', '--strictPort'],
  { stdio: 'ignore' },
);
let browser;
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      if ((await fetch('http://127.0.0.1:1430')).ok) break;
    } catch {
      /* Wait until the local test server is listening. */
    }
    if (Date.now() > deadline) throw new Error('Benchmark server did not start.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--enable-precise-memory-info'],
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:1430');
  // Warm Vite's test-only module before the measurements; it never ships in the app.
  await page.evaluate(async () => {
    await import('/tests/browser/renderBenchmark.ts');
  });
  const cdp = await page.context().newCDPSession(page);
  const results = [];
  const meta = () => ({
    date: new Date().toISOString(),
    machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    browser: browser.version(),
    samples,
  });
  const save = (complete) =>
    writeFile(outPath, JSON.stringify({ ...meta(), complete, results }, null, 2) + '\n');
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} exceeded ${caseTimeout} ms`)), caseTimeout),
      ),
    ]);
  const fmt = (v) => v.toFixed(1).padStart(8);
  for (const size of sizes) {
    for (const mode of ['hover', 'edit']) {
      for (const cached of [false, true]) {
        const label = `${size} atoms, ${mode}, ${cached ? 'cached  ' : 'uncached'}`;
        const started = Date.now();
        let row;
        try {
          row = await withTimeout(
            page.evaluate(
              async ({ size, cached, samples, mode }) =>
                (await import('/tests/browser/renderBenchmark.ts')).benchmark(
                  size,
                  cached,
                  samples,
                  mode,
                ),
              { size, cached, samples, mode },
            ),
            label,
          );
        } catch (error) {
          console.error(`${label}: FAILED after ${Date.now() - started} ms: ${error.message}`);
          await save(false);
          throw error;
        }
        results.push(row);
        await save(false);
        console.log(
          `${label}  median ms  index ${fmt(row.indexMs.median)}  scene ${fmt(row.sceneMs.median)}` +
            `  paint ${fmt(row.paintMs.median)}  preview ${fmt(row.pointerPreviewMs.median)}` +
            `  | setup ${fmt(row.setupMs)}  first scene ${fmt(row.warmupMs)}` +
            `   (${((Date.now() - started) / 1000).toFixed(1)} s)`,
        );
      }
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Runtime.getHeapUsage');
    const history = await page.evaluate(
      async (size) => (await import('/tests/browser/renderBenchmark.ts')).retainHistory(size),
      size,
    );
    await cdp.send('HeapProfiler.collectGarbage');
    const after = await cdp.send('Runtime.getHeapUsage');
    const retained = after.usedSize - before.usedSize;
    results.push({ size, history: { ...history, retainedHeapBytes: retained } });
    console.log(
      `${size} atoms, history ${(retained / 1048576).toFixed(1)} MB retained for ${history.snapshots} snapshots`,
    );
    await page.evaluate(async () =>
      (await import('/tests/browser/renderBenchmark.ts')).clearHistory(),
    );
  }
  const report = { ...meta(), complete: true, results };
  if (process.argv[3]) {
    const baseline = JSON.parse(await readFile(process.argv[3], 'utf8'));
    report.comparisons = [];
    for (const row of results.filter((r) => 'useCache' in r)) {
      const old = baseline.results.find(
        (r) =>
          r.size === row.size &&
          r.useCache === row.useCache &&
          (r.mode ?? 'hover') === (row.mode ?? 'hover'),
      );
      if (!old) continue;
      for (const metric of ['indexMs', 'sceneMs', 'paintMs', 'pointerPreviewMs'])
        for (const statistic of ['median', 'p95']) {
          const ratio = row[metric][statistic] / old[metric][statistic];
          report.comparisons.push({
            size: row.size,
            useCache: row.useCache,
            mode: row.mode,
            metric,
            statistic,
            ratio,
            investigate: ratio > 1.1,
          });
        }
    }
  }
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    'Benchmark report written. Investigate reproducible regressions over 10%; no CI timing gate is applied.',
  );
} finally {
  await browser?.close();
  server.kill();
}
