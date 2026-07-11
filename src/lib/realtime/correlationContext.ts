// Kontekst korelacji BEZ zależności od klienta Supabase - importowany przez
// fetch wrapper klienta (integrations/supabase/correlation-fetch.ts), więc
// musi być wolny od cyklu importów. Logika czekania na zdarzenia żyje w
// correlation.ts.
export const CORRELATION_HEADER = "x-correlation-id";

export function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback dla bardzo starych przeglądarek - wystarczający na id śledzenia.
  const rnd = () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, "0");
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-a${rnd().slice(1)}-${rnd()}${rnd()}${rnd()}`;
}

// Stos (nie pojedyncza zmienna), żeby zagnieżdżone runWithCorrelation nie
// gubiły zewnętrznego id. Świadome uproszczenie single-threaded JS: id jest
// wiarygodny, gdy żądanie startuje synchronicznie wewnątrz fn() - tak działają
// buildery supabase-js await-owane bezpośrednio w runWithCorrelation.
const correlationStack: string[] = [];

export function currentCorrelationId(): string | null {
  return correlationStack.length > 0 ? correlationStack[correlationStack.length - 1] : null;
}

export async function runWithCorrelation<T>(
  correlationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  correlationStack.push(correlationId);
  try {
    return await fn();
  } finally {
    const index = correlationStack.lastIndexOf(correlationId);
    if (index >= 0) correlationStack.splice(index, 1);
  }
}
