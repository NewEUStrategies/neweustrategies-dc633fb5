// Ograniczona równoległość dla I/O w zadaniach tła (tick crona: wysyłki push,
// dostawy webhooków, sondowanie linków). Czysta funkcja bez zależności - działa
// tak samo na serwerze i w teście.
//
// Wzorzec "fala": `slice` + `Promise.all` w pętli - stawia BARIERĘ na końcu
// każdej fali, więc jedna wolna odpowiedź wstrzymuje cały następny pakiet.
// Pula poniżej trzyma `limit` torów, a każdy pobiera następny element od razu
// po zwolnieniu slotu, więc wolny endpoint blokuje wyłącznie własny tor.

/**
 * Odwzorowuje `items` przez `worker`, trzymając w locie najwyżej `limit` zadań.
 * Kolejność wyników odpowiada kolejności wejścia (niezależnie od kolejności
 * zakończenia).
 *
 * Odrzucenie `worker` przerywa pobieranie kolejnych elementów i jest
 * przepuszczane dalej (pierwszy błąd wygrywa) - zadania już w locie dobiegają
 * końca, żeby nie pozostawić wiszących obietnic. Gdy pojedyncza porażka NIE ma
 * przerywać całości, worker powinien łapać błąd i zwracać wynik-porażkę.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const lanes = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length));
  const failures: unknown[] = [];
  let next = 0;

  const runLane = async (): Promise<void> => {
    while (next < items.length && failures.length === 0) {
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        failures.push(error);
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, () => runLane()));
  if (failures.length > 0) throw failures[0];
  return results;
}
