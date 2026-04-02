import { formatLocalDate, parseInputDate } from '../src/utils/date';

describe('date utilities', () => {
  it('parses date-only input in the configured local timezone', () => {
    const parsed = parseInputDate('2026-04-01');

    expect(parsed).not.toBeNull();
    expect(formatLocalDate(parsed!)).toBe('Apr 1, 2026');
  });

  it('returns null for invalid date input', () => {
    expect(parseInputDate('not-a-date')).toBeNull();
  });
});
