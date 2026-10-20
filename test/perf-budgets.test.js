import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { budgetProblems, budgetSummary, defaultBudgets } from '../scripts/check-budgets.js';
import { metrics } from '../scripts/measure-pages.js';

const budgets = {
  limits: {
    fontBytes: { limit: 1000, basis: 'test' },
    componentsReadyMs: { limit: 500, basis: 'test' },
    componentsBlankOnScroll: { limit: 0, basis: 'test' },
  },
};

function measurement(page, width, values) {
  return { page, width, fontBytes: 800, componentsReadyMs: 400, componentsBlankOnScroll: 0, ...values };
}

describe('performance budgets', () => {
  test('a report within every limit has no problems', () => {
    const report = { measurements: [measurement('/', 1440, { fontBytes: 1000 }), measurement('/', 375, {})] };
    assert.deepEqual(budgetProblems(report, budgets), []);
    assert.equal(budgetSummary(report, []), '2 measurements within the budgets');
  });

  test('each exceeded limit gives one line with the page, the width, the metric, the value and the limit', () => {
    const report = {
      measurements: [
        measurement('/', 1440, {}),
        measurement('/2026-10/syntax/', 375, { fontBytes: 1001, componentsBlankOnScroll: 2 }),
        measurement('/2026-10/rope/', 1440, { componentsReadyMs: 812 }),
      ],
    };
    const problems = budgetProblems(report, budgets);
    assert.deepEqual(problems, [
      '/2026-10/syntax/ at 375 pixels: fontBytes is 1001, over the limit of 1000',
      '/2026-10/syntax/ at 375 pixels: componentsBlankOnScroll is 2, over the limit of 0',
      '/2026-10/rope/ at 1440 pixels: componentsReadyMs is 812, over the limit of 500',
    ]);
    assert.equal(budgetSummary(report, problems), '3 budgets exceeded in 3 measurements');
  });

  test('a page without components in the first screen has no component time to check', () => {
    const report = { measurements: [measurement('/', 1440, { componentsReadyMs: null })] };
    assert.deepEqual(budgetProblems(report, budgets), []);
  });

  test('a metric that the report lacks is reported', () => {
    const report = { measurements: [{ page: '/', width: 375, fontBytes: 10, componentsReadyMs: null }] };
    assert.deepEqual(budgetProblems(report, budgets), ['/ at 375 pixels: componentsBlankOnScroll is missing from the report']);
    assert.equal(budgetSummary(report, ['x']), '1 budget exceeded in 1 measurement');
  });

  test('the budget file names only measured metrics and states the basis of every limit', () => {
    const file = JSON.parse(readFileSync(defaultBudgets, 'utf8'));
    const measured = new Set(metrics.map((metric) => metric.key));
    for (const [metric, { limit, basis }] of Object.entries(file.limits)) {
      assert.ok(measured.has(metric), metric);
      assert.equal(typeof limit, 'number', metric);
      assert.ok(basis.length > 0, metric);
    }
  });

  test('the command prints the problems and exits with status 1 when a limit is exceeded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bake-budgets-'));
    try {
      const report = join(dir, 'report.json');
      const limits = join(dir, 'budgets.json');
      writeFileSync(limits, JSON.stringify(budgets));
      writeFileSync(report, JSON.stringify({ measurements: [measurement('/', 1440, {})] }));
      const script = new URL('../scripts/check-budgets.js', import.meta.url).pathname;
      assert.equal(execFileSync(process.execPath, [script, report, limits], { encoding: 'utf8' }), '1 measurement within the budgets\n');
      writeFileSync(report, JSON.stringify({ measurements: [measurement('/', 1440, { fontBytes: 2000 })] }));
      const failed = spawnSync(process.execPath, [script, report, limits], { encoding: 'utf8' });
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, '/ at 1440 pixels: fontBytes is 2000, over the limit of 1000\n1 budget exceeded in 1 measurement\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
