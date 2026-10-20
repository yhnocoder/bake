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
  return report.measurements.flatMap((measurement) =>
    Object.entries(budgets.limits).flatMap(([metric, { limit }]) => {
      const value = measurement[metric];
      const where = `${measurement.page} at ${measurement.width} pixels`;
      if (value === undefined) return [`${where}: ${metric} is missing from the report`];
      if (value === null || value <= limit) return [];
      return [`${where}: ${metric} is ${value}, over the limit of ${limit}`];
    }),
  );
}

export function budgetSummary(report, problems) {
  const measurements = `${report.measurements.length} ${report.measurements.length === 1 ? 'measurement' : 'measurements'}`;
  if (problems.length === 0) return `${measurements} within the budgets`;
  return `${problems.length} ${problems.length === 1 ? 'budget' : 'budgets'} exceeded in ${measurements}`;
}
