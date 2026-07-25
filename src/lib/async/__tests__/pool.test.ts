// Kontrakt puli: kolejność wyników, twardy limit równoległości, BRAK bariery
// między elementami (to jest cała różnica wobec `slice` + `Promise.all`) oraz
// przerwanie po pierwszym błędzie. Sterowanie ręcznymi obietnicami, nie
// timerami - test jest deterministyczny.
import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/async/pool";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Domyka kolejkę mikrozadań (obietnice już rozwiązane zdążą się wykonać). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mapWithConcurrency", () => {
  it("zachowuje kolejność wyników niezależnie od kolejności zakończeń", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const run = mapWithConcurrency(gates, 3, async (gate, index) => {
      await gate.promise;
      return index * 10;
    });

    gates[2].resolve();
    gates[0].resolve();
    gates[1].resolve();

    expect(await run).toEqual([0, 10, 20]);
  });

  it("trzyma w locie najwyżej `limit` zadań", async () => {
    const gates = Array.from({ length: 6 }, () => deferred<void>());
    let inFlight = 0;
    let peak = 0;
    const run = mapWithConcurrency(gates, 2, async (gate, index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate.promise;
      inFlight -= 1;
      return index;
    });

    await flush();
    expect(inFlight).toBe(2);

    for (const gate of gates) gate.resolve();
    expect(await run).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("nie stawia bariery - szybkie elementy nie czekają na wolny", async () => {
    const slow = deferred<void>();
    const finished: number[] = [];
    const run = mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      if (item === 0) await slow.promise;
      finished.push(item);
      return item;
    });

    await flush();
    // Tor z elementem 0 stoi; drugi tor przemielił w tym czasie resztę.
    expect(finished).toEqual([1, 2, 3]);

    slow.resolve();
    expect(await run).toEqual([0, 1, 2, 3]);
    expect(finished).toEqual([1, 2, 3, 0]);
  });

  it("pierwszy błąd przerywa pobieranie kolejnych elementów", async () => {
    const seen: number[] = [];

    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4], 1, async (item) => {
        seen.push(item);
        if (item === 1) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");

    expect(seen).toEqual([0, 1]);
  });

  it("normalizuje limit i radzi sobie z pustym wejściem", async () => {
    const double = async (n: number): Promise<number> => n * 2;

    expect(await mapWithConcurrency([1, 2, 3], 0, double)).toEqual([2, 4, 6]);
    expect(await mapWithConcurrency([1, 2, 3], -5, double)).toEqual([2, 4, 6]);
    expect(await mapWithConcurrency([1, 2, 3], 99, double)).toEqual([2, 4, 6]);
    expect(await mapWithConcurrency([], 4, double)).toEqual([]);
  });
});
