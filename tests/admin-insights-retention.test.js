jest.mock('../models/UserActivityDay', () => ({}));
const { computeRetention, weekStart } = require('../utils/admin/insightsService');

const day = (s) => new Date(`${s}T00:00:00.000Z`);

test('weekStart returns Monday 00:00 UTC', () => {
  expect(weekStart(day('2026-10-01')).toISOString()).toBe('2026-09-28T00:00:00.000Z'); // Thursday -> Monday
  expect(weekStart(day('2026-09-28')).toISOString()).toBe('2026-09-28T00:00:00.000Z');
  expect(weekStart(day('2026-10-04')).toISOString()).toBe('2026-09-28T00:00:00.000Z'); // Sunday
});

test('computes weekly retention per cohort and leaves future weeks empty', () => {
  const start = day('2026-09-28');
  const cohorts = [{ start, userIds: ['a', 'b', 'c', 'd'] }];
  const activity = new Map([
    ['a', new Set(['2026-10-06', '2026-10-13'])], // wk1 + wk2
    ['b', new Set(['2026-10-11'])], // wk1 (Sunday, last day of the window)
    ['c', new Set(['2026-10-01'])], // signup week only -> not retained
    ['d', new Set(['2026-10-19'])], // wk3
  ]);
  const [row] = computeRetention(cohorts, activity, day('2026-10-20'), 5);
  expect(row.users).toBe(4);
  expect(row.weekStart).toBe('2026-09-28');
  expect(row.retention).toEqual([50, 25, 25, null, null]);
});

test('empty cohorts report 0 for elapsed weeks', () => {
  const [row] = computeRetention([{ start: day('2026-09-28'), userIds: [] }], new Map(), day('2026-10-08'), 3);
  expect(row.retention).toEqual([0, null, null]);
});

describe('overview date range', () => {
  const { resolveRange } = require('../utils/admin/overviewService');
  const now = new Date('2026-10-27T15:00:00Z');
  test('defaults to month to date', () => {
    const r = resolveRange({}, now);
    expect(r.start.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(r.end.toISOString().slice(0, 10)).toBe('2026-10-27');
    expect(r.days).toBe(27);
  });
  test('clamps the end to today and validates input', () => {
    expect(resolveRange({ from: '2026-10-20', to: '2026-12-01' }, now).days).toBe(8);
    expect(() => resolveRange({ from: 'yesterday' }, now)).toThrow(/YYYY-MM-DD/);
    expect(() => resolveRange({ from: '2026-10-28', to: '2026-10-27' }, now)).toThrow(/between/);
    expect(() => resolveRange({ from: '2020-01-01' }, now)).toThrow(/between/);
  });
});
