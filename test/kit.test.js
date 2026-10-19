import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatNumber, linearScale, niceTicks, samplePath, stepDigits } from '../src/kit/numbers.js';

describe('kit helpers', () => {
  test('formatNumber writes the given digits and a minus sign', () => {
    assert.equal(formatNumber(1.23456, 2), '1.23');
    assert.equal(formatNumber(-0.5, 1), '−0.5');
    assert.equal(formatNumber(3, 0), '3');
  });

  test('stepDigits gives the decimals that a step needs', () => {
    assert.deepEqual([1, 0.5, 0.1, 0.25, 0.01, 10].map(stepDigits), [0, 1, 1, 1, 2, 0]);
  });

  test('niceTicks chooses steps of 1, 2 or 5 times a power of ten and labels zero without a sign', () => {
    assert.deepEqual(
      niceTicks(-4, 4, 8).map((tick) => tick.label),
      ['−4', '−3', '−2', '−1', '0', '1', '2', '3', '4'],
    );
    assert.deepEqual(
      niceTicks(0, 1, 4).map((tick) => tick.label),
      ['0.0', '0.2', '0.4', '0.6', '0.8', '1.0'],
    );
    assert.deepEqual(
      niceTicks(-0.13, 1.12, 6).map((tick) => tick.label),
      ['0.0', '0.2', '0.4', '0.6', '0.8', '1.0'],
    );
    assert.deepEqual(
      niceTicks(-6, 6, 3).map((tick) => tick.value),
      [-5, 0, 5],
    );
    assert.deepEqual(
      niceTicks(0, 1000, 2).map((tick) => tick.label),
      ['0', '500', '1000'],
    );
    assert.equal(niceTicks(-0.3, 0.3, 3).find((tick) => Math.abs(tick.value) < 1e-9).label, '0.0');
  });

  test('linearScale maps a domain onto a range and back, also when the range is reversed', () => {
    const x = linearScale([-4, 4], [34, 324]);
    assert.equal(x(-4), 34);
    assert.equal(x(0), 179);
    assert.equal(x.invert(324), 4);
    const y = linearScale([0, 2], [200, 0]);
    assert.equal(y(2), 0);
    assert.equal(y(0.5), 150);
    assert.equal(y.invert(100), 1);
  });

  test('samplePath draws a function, skips values that are not finite and breaks the line at the given positions', () => {
    const identity = (value) => value;
    assert.equal(samplePath(identity, [0, 2], identity, identity, 2), 'M0.0 0.0L1.0 1.0L2.0 2.0');
    const step = (value) => (value > 0 ? 1 : value < 0 ? 0 : NaN);
    assert.equal(samplePath(step, [-2, 2], identity, identity, 4), 'M-2.0 0.0L-1.0 0.0M1.0 1.0L2.0 1.0');
    assert.equal(samplePath(identity, [-1, 1], identity, identity, 4, [0]), 'M-1.0 -1.0L-0.5 -0.5M0.0 0.0L0.5 0.5L1.0 1.0');
    assert.equal(samplePath(() => Infinity, [0, 1], identity, identity, 4), '');
  });
});
