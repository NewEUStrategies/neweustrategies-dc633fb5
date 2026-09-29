import { performance } from "node:perf_hooks";
import {
  dueItems,
  enqueueScanWithOverflow,
  OUTBOX_CAPACITY,
  type OutboxItem,
} from "../../src/lib/events/scannerOutbox";

const now = "2026-09-29T12:00:00Z";
let queue: OutboxItem[] = [];
let overflow = 0;
const durations: number[] = [];
for (let i = 0; i < 10_000; i += 1) {
  const item: OutboxItem = {
    id: `scan-${i}`,
    kind: "checkin",
    code: `test-${i}`,
    checkpointId: null,
    direction: "in",
    note: null,
    interestRating: null,
    deviceScannedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
  };
  const start = performance.now();
  const result = enqueueScanWithOverflow(queue, item);
  queue = result.queue;
  overflow += result.overflow.length;
  dueItems(queue, now);
  durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
if (queue.length !== OUTBOX_CAPACITY || overflow + queue.length !== 10_000)
  throw new Error("Lost scanner queue entries");
console.log(
  JSON.stringify(
    {
      scans: 10_000,
      retained: queue.length,
      overflowReturned: overflow,
      p50Ms: durations[5000],
      p95Ms: durations[9500],
      maxMs: durations.at(-1),
      scope: "CPU queue operations; excludes camera, IndexedDB and network",
    },
    null,
    2,
  ),
);
