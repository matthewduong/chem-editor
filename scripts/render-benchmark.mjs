import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';

if (process.env.CHEM_RENDER_BENCH !== '1') {
  console.log(
    'Benchmark is opt-in. Run CHEM_RENDER_BENCH=1 pnpm benchmark:render [output.json] [baseline.json].',
  );
  process.exit(0);
}
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
  for (const size of [100, 1000, 5000]) {
    for (const cached of [false, true]) {
      results.push(
        await page.evaluate(
          async ({ size, cached }) =>
            (await import('/tests/browser/renderBenchmark.ts')).benchmark(size, cached),
          { size, cached },
        ),
      );
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Runtime.getHeapUsage');
    const history = await page.evaluate(
      async (size) => (await import('/tests/browser/renderBenchmark.ts')).retainHistory(size),
      size,
    );
    await cdp.send('HeapProfiler.collectGarbage');
    const after = await cdp.send('Runtime.getHeapUsage');
    results.push({
      size,
      history: { ...history, retainedHeapBytes: after.usedSize - before.usedSize },
    });
    await page.evaluate(async () =>
      (await import('/tests/browser/renderBenchmark.ts')).clearHistory(),
    );
  }
  const report = {
    date: new Date().toISOString(),
    machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    browser: browser.version(),
    results,
  };
  if (process.argv[3]) {
    const baseline = JSON.parse(await readFile(process.argv[3], 'utf8'));
    report.comparisons = [];
    for (const row of results.filter((r) => 'useCache' in r)) {
      const old = baseline.results.find((r) => r.size === row.size && r.useCache === row.useCache);
      if (!old) continue;
      for (const metric of ['indexMs', 'sceneMs', 'paintMs', 'pointerPreviewMs'])
        for (const statistic of ['median', 'p95']) {
          const ratio = row[metric][statistic] / old[metric][statistic];
          report.comparisons.push({
            size: row.size,
            useCache: row.useCache,
            metric,
            statistic,
            ratio,
            investigate: ratio > 1.1,
          });
        }
    }
  }
  await writeFile(
    process.argv[2] ?? '/tmp/chem-render-benchmark.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    'Benchmark report written. Investigate reproducible regressions over 10%; no CI timing gate is applied.',
  );
} finally {
  await browser?.close();
  server.kill();
}
