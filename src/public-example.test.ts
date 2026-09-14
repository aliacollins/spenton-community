import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sharedDinnerExample } from './public-example';

describe('public dinner examples', () => {
  it('matches the landing illustration after one friend repays', () => {
    const actual = sharedDinnerExample(4000);
    const html = readFileSync('landing/index.html', 'utf8');
    expect(actual.spent).toBe(4000);
    expect(actual.shared.receivable).toBe(4000);
    expect(actual.cash).toBe(42000);
    expect(html).toMatch(/id="demo-spending">\$40</);
    expect(html).toMatch(/id="demo-owed">\$40</);
    expect(html).toMatch(/id="preview-shared-cash" class="num">\$420\.00</);
  });

  it('keeps spending unchanged and releases only received money in the public walkthrough', () => {
    const before = sharedDinnerExample();
    const partial = sharedDinnerExample(4000);
    const complete = sharedDinnerExample(8000);
    expect([before.spent, partial.spent, complete.spent]).toEqual([4000, 4000, 4000]);
    expect([before.cash, partial.cash, complete.cash]).toEqual([38000, 42000, 46000]);
    expect([before.ready, partial.ready, complete.ready]).toEqual([0, 4000, 8000]);
    expect([before.shared.receivable, partial.shared.receivable, complete.shared.receivable]).toEqual([8000, 4000, 0]);
  });
});
