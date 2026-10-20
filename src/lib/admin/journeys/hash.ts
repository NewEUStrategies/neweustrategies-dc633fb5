// SKRÓTY KLUCZY CACHE ŚCIEŻEK - stabilny JSON i szybki skrót (S8).
//
// PO CO. Dwa klucze React Query niosą „treść" zamiast identyfikatora:
// szacunek zasięgu wyzwalacza (`journeyKeys.triggerEstimate(…, conditionHash)`)
// i symulacja szkicu (`journeyKeys.simulate(…, draftChecksum)`). Gdyby klucz
// niósł sam obiekt, każda kosmetyczna różnica (kolejność pól po zapisie przez
// jsonb, nowy obiekt z tymi samymi danymi po renderze edytora) dawałaby nowy
// wpis w cache i nowe zapytanie do bazy. Skrót z POSORTOWANYCH kluczy zmienia
// się wyłącznie przy realnej zmianie treści.
//
// TO NIE JEST SUMA KONTROLNA BEZPIECZEŃSTWA. `graph_checksum` publikacji liczy
// baza (`md5(graph::text)`); tu potrzebujemy tylko taniego, deterministycznego
// rozróżnienia dwóch stanów edytora. Kolizja kosztowałaby co najwyżej jeden
// nieodświeżony szacunek - dlatego wystarcza 53-bitowy skrót bez kryptografii.
//
// Moduł bez zależności (liść) - czyta go kanwa w przeglądarce.

/**
 * JSON z posortowanymi kluczami obiektów (tablice zachowują kolejność - ona
 * coś znaczy: kolejność warunków, krawędzi, bloków maila). Zasady zgodne
 * z `JSON.stringify`: `undefined` i funkcje w obiekcie znikają, w tablicy
 * stają się `null`; liczby nieskończone i `NaN` to `null`; `toJSON` (daty)
 * jest wołane. Cykl w danych to błąd programisty - rzucamy, zamiast wisieć.
 */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();

  const walk = (input: unknown, inArray: boolean): string | undefined => {
    let current = input;
    if (
      current !== null &&
      typeof current === "object" &&
      typeof (current as { toJSON?: unknown }).toJSON === "function"
    ) {
      current = (current as { toJSON: () => unknown }).toJSON();
    }
    if (current === undefined || typeof current === "function" || typeof current === "symbol") {
      return inArray ? "null" : undefined;
    }
    if (current === null) return "null";
    if (typeof current === "number") return Number.isFinite(current) ? String(current) : "null";
    if (typeof current === "bigint") return JSON.stringify(current.toString());
    if (typeof current !== "object") return JSON.stringify(current);
    if (seen.has(current)) throw new TypeError("stableStringify: cykl w danych");
    seen.add(current);
    let out: string;
    if (Array.isArray(current)) {
      out = `[${current.map((item) => walk(item, true) ?? "null").join(",")}]`;
    } else {
      const record = current as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const encoded = walk(record[key], false);
        if (encoded !== undefined) parts.push(`${JSON.stringify(key)}:${encoded}`);
      }
      out = `{${parts.join(",")}}`;
    }
    seen.delete(current);
    return out;
  };

  return walk(value, false) ?? "null";
}

/**
 * cyrb53 - szybki 53-bitowy skrót napisu (dwa przebiegi mnożenia 32-bitowego).
 * Wynik: 14 znaków szesnastkowych, stała długość niezależna od wejścia.
 */
export function fastHash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0");
}

/**
 * Skrót warunku wyzwalacza do klucza szacunku. Brak warunku i pusty warunek
 * to TEN SAM szacunek (`payload @> {}` łapie każde zdarzenie typu), więc dają
 * ten sam skrót.
 */
export function conditionHash(condition: Readonly<Record<string, unknown>> | null | undefined) {
  return fastHash(stableStringify(condition ?? {}));
}

/** Skrót szkicu (graf + ustawienia) do klucza symulacji. */
export function draftChecksum(draft: unknown): string {
  return fastHash(stableStringify(draft ?? null));
}
