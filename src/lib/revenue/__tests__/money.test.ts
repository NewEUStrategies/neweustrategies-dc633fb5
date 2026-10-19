// Kwoty per waluta (SPEC I5): nigdy suma między walutami, `null` ≠ 0.
import { describe, expect, it } from "vitest";

import { addMoneyByCurrency, parseMoneyByCurrency } from "../money";

describe("parseMoneyByCurrency", () => {
  it("czyta pozycje z jsonb RPC (nazwy kolumn i camelCase)", () => {
    expect(
      parseMoneyByCurrency([
        { currency: "PLN", amount_minor: 1250 },
        { currency: "EUR", amountMinor: 300 },
      ]),
    ).toEqual([
      { currency: "PLN", amountMinor: 1250 },
      { currency: "EUR", amountMinor: 300 },
    ]);
  });

  it("`null` (brak danych) to `null`, a zmierzone „nic” to pusta lista", () => {
    expect(parseMoneyByCurrency(null)).toBeNull();
    expect(parseMoneyByCurrency(undefined)).toBeNull();
    expect(parseMoneyByCurrency([])).toEqual([]);
  });

  it("zdeformowana pozycja unieważnia CAŁOŚĆ - nie gubi kwoty po cichu", () => {
    const dobra = { currency: "EUR", amount_minor: 5 };
    const zle: unknown[] = [
      { currency: "pln", amount_minor: 1 },
      { currency: "PLN", amount_minor: 1.5 },
      { currency: "PLN", amount_minor: "100" },
      { currency: "PLN" },
      { currency: "PLN", amount_minor: 1, amountMinor: 2 },
      { amount_minor: 1 },
      null,
      [dobra],
    ];
    for (const pozycja of zle) {
      expect(parseMoneyByCurrency([dobra, pozycja]), JSON.stringify(pozycja)).toBeNull();
    }
    // Pojedynczy obiekt zamiast listy to też kształt zdeformowany.
    expect(parseMoneyByCurrency(dobra)).toBeNull();
  });

  it("powtórzona waluta jest łączona, kolejność z serwera zostaje", () => {
    expect(
      parseMoneyByCurrency([
        { currency: "USD", amount_minor: 100 },
        { currency: "PLN", amount_minor: 10 },
        { currency: "USD", amount_minor: 1 },
      ]),
    ).toEqual([
      { currency: "USD", amountMinor: 101 },
      { currency: "PLN", amountMinor: 10 },
    ]);
  });
});

describe("addMoneyByCurrency", () => {
  it("sumuje wyłącznie w obrębie tej samej waluty", () => {
    expect(
      addMoneyByCurrency(
        [{ currency: "PLN", amountMinor: 10_000 }],
        [
          { currency: "EUR", amountMinor: 2_400 },
          { currency: "PLN", amountMinor: 500 },
        ],
      ),
    ).toEqual([
      { currency: "PLN", amountMinor: 10_500 },
      { currency: "EUR", amountMinor: 2_400 },
    ]);
  });

  it("nieznane plus znane to nieznane", () => {
    expect(addMoneyByCurrency(null, [{ currency: "PLN", amountMinor: 1 }])).toBeNull();
    expect(addMoneyByCurrency([{ currency: "PLN", amountMinor: 1 }], null)).toBeNull();
    expect(addMoneyByCurrency([], [])).toEqual([]);
  });

  it("suma poza zakresem bezpiecznych liczb całkowitych to brak danych, nie zaokrąglenie", () => {
    const duzo = [{ currency: "PLN", amountMinor: Number.MAX_SAFE_INTEGER }];
    expect(addMoneyByCurrency(duzo, [{ currency: "PLN", amountMinor: 1 }])).toBeNull();
  });

  it("nie modyfikuje argumentów", () => {
    const a = [{ currency: "PLN", amountMinor: 1 }];
    const b = [{ currency: "PLN", amountMinor: 2 }];
    addMoneyByCurrency(a, b);
    expect(a).toEqual([{ currency: "PLN", amountMinor: 1 }]);
    expect(b).toEqual([{ currency: "PLN", amountMinor: 2 }]);
  });
});
