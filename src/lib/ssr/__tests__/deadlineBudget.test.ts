import { afterEach, expect, it, vi } from "vitest";
import { withBudget } from "@/lib/asyncBudget";

afterEach(() => vi.useRealTimers());

it("an absolute deadline can shorten, but never extend, a phase budget", async () => {
  vi.useFakeTimers();
  const finish = vi.fn();
  const work = new Promise<void>(() => {});
  const promise = withBudget(work, 500, Date.now() + 200).then(finish);
  await vi.advanceTimersByTimeAsync(199);
  expect(finish).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await promise;
  expect(finish).toHaveBeenCalledOnce();
  const second = withBudget(work, 100, Date.now() + 600).then(finish);
  await vi.advanceTimersByTimeAsync(100);
  await second;
  expect(finish).toHaveBeenCalledTimes(2);
});

it("expired deadlines settle immediately and still handle a late rejection", async () => {
  let reject: (reason: Error) => void = () => {};
  const work = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  await withBudget(work, 500, Date.now() - 1);
  reject(new Error("late backend rejection"));
  await Promise.resolve();
});
