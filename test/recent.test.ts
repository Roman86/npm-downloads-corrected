// Recent / starred list logic.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as R from '../src/lib/recent.ts';
import type { RecentState } from '../src/types.ts';

const names = (s: RecentState) => R.list(s).map((x) => x.name);

test('recent: max 10, most recent first, stars on top', () => {
  assert.equal(R.MAX_TOTAL, 10);
  let s: RecentState = { recent: [], starred: [] };
  for (const n of 'abcdefghijkl') s = R.visit(s, n);
  assert.deepEqual(names(s), [...'lkjihgfedc'], 'max 10, most recent first');

  s = R.visit(s, 'd'); // revisit moves to top
  assert.deepEqual(names(s), [...'dlkjihgfec']);

  // star 3: they go first, list stays at 10
  for (const n of ['e', 'c', 'g']) {
    const r = R.toggleStar(s, n);
    assert.equal(r.starred, true);
    s = r.state;
  }
  assert.deepEqual(names(s), ['e', 'c', 'g', 'd', 'l', 'k', 'j', 'i', 'h', 'f']);
  assert.equal(R.list(s).filter((x) => x.starred).length, 3);

  // visiting a starred package keeps the star order; new visits fill the recent part
  s = R.visit(s, 'c');
  s = R.visit(s, 'x');
  assert.deepEqual(names(s).slice(0, 5), ['e', 'c', 'g', 'x', 'd']);
  assert.equal(R.list(s).length, 10);

  // unstar: back into recent, at the top of it
  const r = R.toggleStar(s, 'c');
  assert.equal(r.starred, false);
  assert.deepEqual(names(r.state).slice(0, 5), ['e', 'g', 'c', 'x', 'd']);
});

test('recent: no limit on starred, at least 3 recent shown', () => {
  let m: RecentState = { recent: [], starred: [] };
  for (let k = 0; k < 15; k++) m = R.visit(m, 'p' + k);
  for (let k = 0; k < 12; k++) m = R.toggleStar(m, 'p' + k).state;
  const shown = R.list(m);
  assert.equal(shown.filter((x) => x.starred).length, 12);
  assert.equal(shown.filter((x) => !x.starred).length, 3);
});

test('recent: garbage in storage does not crash', () => {
  assert.deepEqual(R.list({ recent: 'oops', starred: [1, 'z'] }).map((x) => x.name), ['z']);
  assert.deepEqual(R.list(null), []);
  assert.deepEqual(R.clean(undefined), { recent: [], starred: [] });
});
