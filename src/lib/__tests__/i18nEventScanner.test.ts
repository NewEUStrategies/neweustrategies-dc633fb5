// Słownik aplikacji skanera: parytet PL/EN i pokrycie wyników bazy.
//
// DLACZEGO (recenzja R2). Wyniki `denied_already_inside` i `code_superseded`
// doszły w bazie bez etykiet w skanerze, więc bramka pokazywała „Nieznany
// wynik" - operator nie odróżniał odmowy ponownego wejścia ani wymienionego
// kodu od awarii. Ten plik przewraca się, gdy wynik z CHECK-a bazy albo wynik
// RPC nie ma nagłówka w KTÓRYMKOLWIEK języku, i gdy jedna wersja językowa
// zgubi klucz (formy liczby mnogiej porównujemy po rdzeniu - polski ma ich
// więcej niż angielski).
import { describe, expect, it } from "vitest";

import { CHECKIN_RESULTS, OFFLINE_OUTCOMES } from "@/lib/events/onsiteEnums";
import { eventScannerEn, eventScannerPl } from "@/lib/i18n-event-scanner";

/** Dowolny słownik - PL ma więcej form liczby mnogiej niż EN, więc typy się różnią. */
type Bundle = Record<string, unknown>;

const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(input: unknown, prefix = ""): string[] {
  if (typeof input !== "object" || input === null) return [prefix];
  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function stems(bundle: Bundle): string[] {
  return [...new Set(flatten(bundle).map((key) => key.replace(PLURAL, "")))].sort();
}

function valueAt(bundle: Bundle, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], bundle);
}

function camel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

const bundles: readonly [string, Bundle][] = [
  ["pl", eventScannerPl],
  ["en", eventScannerEn],
];

/** Wyniki RPC płaszczyzny urządzenia, które nie są wierszami dziennika. */
const RPC_OUTCOMES = ["repeat", "unknown_code", "wrong_event", "code_superseded"] as const;

describe("słownik skanera", () => {
  it("PL i EN mają te same klucze (formy liczby mnogiej po rdzeniu)", () => {
    const pl = stems(eventScannerPl);
    const en = stems(eventScannerEn);
    expect(en.filter((key) => !pl.includes(key))).toEqual([]);
    expect(pl.filter((key) => !en.includes(key))).toEqual([]);
  });

  it.each(bundles)(
    "(%s) każdy wynik bazy, wynik RPC i decyzja offline ma nagłówek",
    (_l, bundle) => {
      const outcomes = [...CHECKIN_RESULTS, ...RPC_OUTCOMES, ...OFFLINE_OUTCOMES];
      const missing = outcomes.filter((outcome) => {
        const value = valueAt(bundle, `eventScanner.outcomes.${camel(outcome)}`);
        return typeof value !== "string" || value.trim() === "";
      });
      expect(missing).toEqual([]);
    },
  );

  it.each(bundles)(
    "(%s) ponowne wejście i odmowa „już w środku” mają podpowiedź z chwilą",
    (_l, bundle) => {
      for (const key of ["deniedAlreadyInsideAt", "grantedReentryAt"]) {
        expect(valueAt(bundle, `eventScanner.outcomeHints.${key}`)).toContain("{{when}}");
      }
      expect(valueAt(bundle, "eventScanner.outcomes.grantedReentry")).not.toBe(
        valueAt(bundle, "eventScanner.outcomes.granted"),
      );
    },
  );

  it.each(bundles)(
    "(%s) kod zastąpiony: zdanie dla każdego poświadczenia i powodu",
    (_l, bundle) => {
      for (const credential of ["ticket", "badge"]) {
        for (const reason of ["reissued", "revoked", "invalidated"]) {
          expect(valueAt(bundle, `eventScanner.superseded.${credential}.${reason}`)).toContain(
            "{{when}}",
          );
        }
      }
    },
  );
});
