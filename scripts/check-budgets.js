import { readFileSync } from 'node:fs';

export const defaultBudgets = new URL('../test/perf/budgets.json', import.meta.url);

if (import.meta.main) main(process.argv.slice(2));

function main(args) {
  if (args.length < 1 || args.length > 2) {
    console.error('Usage: node scripts/check-budgets.js <report.json> [budgets.json]');
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(args[0], 'utf8'));
  const budgets = JSON.parse(readFileSync(args[1] ?? defaultBudgets, 'utf8'));
  const problems = budgetProblems(report, budgets);
  for (const problem of problems) console.log(problem);
  console.log(budgetSummary(report, problems));
  if (problems.length > 0) process.exit(1);
}

export function budgetProblems(report, budgets) {
  const limits = Object.entries(budgets.limits).filter(([metric]) => report.metrics.includes(metric));
  const missing = limits.filter(([metric]) => report.measurements.every((measurement) => measurement[metric] === undefined));
  return [
    ...missing.map(([metric]) => `${metric} is missing from the report`),
    ...report.measurements.flatMap((measurement) =>
      limits.flatMap(([metric, { limit }]) => {
        const value = measurement[metric];
        if (value === undefined || value === null || value <= limit) return [];
        const where = measurement.page === undefined ? '' : `${measurement.page} at ${measurement.width} pixels: `;
        return [`${where}${metric} is ${value}, over the limit of ${limit}`];
      }),
    ),
  ];
}

export function budgetSummary(report, problems) {
  const measurements = `${report.measurements.length} ${report.measurements.length === 1 ? 'measurement' : 'measurements'}`;
  if (problems.length === 0) return `${measurements} within the budgets`;
  return `${problems.length} ${problems.length === 1 ? 'budget' : 'budgets'} exceeded in ${measurements}`;
}
