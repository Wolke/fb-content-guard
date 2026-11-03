import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisBudget } from '../extension/analysis-budget.js';

function fixture() {
  let time = 100000, stored;
  const options = { now: () => time, read: async () => structuredClone(stored),
    write: async value => { stored = structuredClone(value); } };
  return { budget: createAnalysisBudget(options), restart: () => createAnalysisBudget(options),
    advance: ms => { time += ms; }, stored: () => stored };
}
test('concurrent tabs reserve by image count and cannot exceed 15 per window', async () => {
  const { budget } = fixture();
  const results = await Promise.allSettled([budget.reserve(8), budget.reserve(8)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  const error = results.find(x => x.status === 'rejected').reason;
  assert.equal(error.message, 'WAITING_CAPACITY');
  assert.equal(error.retryAfterMs, 65000);
  await budget.reserve(7);
  await assert.rejects(budget.reserve(1), /WAITING_CAPACITY/);
});
test('worker restart preserves budget and a later window admits waiting work', async () => {
  const f = fixture();
  await f.budget.reserve(12); await f.budget.reserve(3);
  const restarted = f.restart();
  await assert.rejects(restarted.check(1), /WAITING_CAPACITY/);
  f.advance(65000);
  await restarted.reserve(12);
  assert.equal(f.stored().events.length, 1);
});
test('repeated upstream quota failures back off globally; late successes cannot cancel cooldown', async () => {
  const f = fixture();
  assert.equal(await f.budget.pause(), 65000);
  await f.budget.success();
  await assert.rejects(f.restart().check(1), /WAITING_CAPACITY/);
  f.advance(65000);
  assert.equal(await f.budget.pause(), 130000);
  f.advance(130000);
  await f.budget.success();
  assert.equal(await f.budget.pause(), 65000);
  for (let n = 0; n < 10; n++) assert.ok(await f.budget.pause() <= 1800000);
  assert.deepEqual(Object.keys(f.stored()).sort(), ['events', 'failures', 'until']);
});
