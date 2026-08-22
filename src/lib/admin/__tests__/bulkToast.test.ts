// SEMANTYKA TOASTÓW DLA MUTACJI MASOWYCH (`src/lib/admin/bulkToast.ts`).
// 33 linie, jedna funkcja, trzy gałęzie - i jedno zdanie, które ma dowieść:
// PANEL NIE WOLNO MU SKŁAMAĆ, ŻE ZROBIŁ WIĘCEJ, NIŻ ZROBIŁ.
//
// CO TEN PLIK DOWODZI. PostgREST oddaje 0 wierszy z `error: null`, gdy RLS
// odfiltruje cel (cudzy wpis, inny najemca, wiersz już skasowany). Sama
// nieobecność błędu NIE znaczy więc sukcesu. Serwer liczy uczciwie
// (`{ count, requested }`), a ten helper zamienia tę parę na jeden z trzech
// komunikatów. Pomyłka w progach nie wygląda jak awaria: redaktor widzi
// „Przeniesiono do kosza: 12”, idzie dalej i dopiero po czasie odkrywa, że
// dziewięć z dwunastu stron nigdy nie zostało zmienione. Dowodzimy:
//
//   1. TRZECH PROGÓW: `count === 0` to BŁĄD (nie „zrobiono zero”),
//      `count < requested` to OSTRZEŻENIE z DWIEMA liczbami, a równość to
//      sukces z kluczem podanym przez wywołującego.
//   2. WARTOŚCI ZWRACANEJ. `false` przy zerze, `true` w pozostałych - trasy
//      biorą z tego decyzję, czy unieważnić cache listy. Odwrotność zostawia
//      redaktorowi listę pokazującą stan sprzed operacji.
//   3. DOKŁADNIE JEDNEGO TOASTU na wywołanie - dwa naraz (ostrzeżenie plus
//      sukces) czyta się jako „udało się”.
//   4. WARSTWY JĘZYKOWEJ NA PRAWDZIWYM SŁOWNIKU: komunikat jest brany
//      z `admin.bulkResult.*`, liczby są WSTAWIONE (żadnego `{{count}}`
//      w treści), a wersja polska i angielska naprawdę się różnią.
//
// DLACZEGO PRAWDZIWY `t`, A NIE ATRAPA ZWRACAJĄCA KLUCZ. Helper przyjmuje
// `TFunction` z i18next, a atrapa typu „echo klucza” nie pasuje do tego typu
// (brakuje `$TFunctionBrand`) i wymagałaby `as unknown as TFunction`, czyli
// rzutowania, które jest w tym repo pod ratchetem - patrz nagłówek
// `src/test/i18nReal.ts`, gdzie ten dokładny dług jest opisany. Dlatego
// asercje idą przez `realT()`: porównujemy treść toastu z tłumaczeniem
// OCZEKIWANEGO KLUCZA, więc użycie innego klucza oblewa test tak samo jak
// przy atrapie, a dodatkowo test upada, gdy klucz zniknie ze słownika.
// Osobna asercja pilnuje, że każdy z tych kluczy MA tłumaczenie (czyli że
// porównanie nie jest tautologią „klucz równa się klucz”).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - LICZENIA WYNIKU PO STRONIE SERWERA (`bulkResult()` w `content.functions.ts`:
//   ile wierszy naprawdę dotknięto po RLS) - to osobna warstwa i osobna praca.
// - PARZYSTOŚCI SŁOWNIKÓW PL/EN: `src/lib/__tests__/i18n-key-parity.test.ts`.
// - PODŁĄCZENIA HELPERA DO TRAS: `src/routes/__tests__/adminPostsListRoute.test.tsx`
//   przechodzi przez ten helper NAPRAWDĘ (nie podmienia go atrapą) i sprawdza
//   go w trzech przypadkach od strony ekranu listy postów. Ten plik NIE powtarza
//   tamtych scenariuszy - bierze granice i języki, których test trasy nie rusza
//   (`count > requested`, brakujący klucz sukcesu, różnica PL/EN, liczba
//   toastów). Uwaga na wynikające z tego zastrzeżenie w raporcie pokrycia:
//   ten moduł NIE startował z zera.
// - RLS I NAJEMCY: `rls_tenant_isolation_test.sql`,
//   `tenant_isolation_three_tenants_test.sql` - to tam jest dowód, dlaczego
//   `count` potrafi być mniejszy od `requested`.
//
// RODO: moduł nie dotyka danych osobowych; w tym pliku nie ma żadnych danych
// osobowych ani adresów.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkResult } from "@/lib/content.functions";

const h = vi.hoisted(() => ({
  /** Pokazane toasty w kolejności: rodzaj + gotowa treść. */
  toasts: [] as { kind: "success" | "error" | "warning"; message: string }[],
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => {
      h.toasts.push({ kind: "success", message });
    },
    error: (message: string) => {
      h.toasts.push({ kind: "error", message });
    },
    warning: (message: string) => {
      h.toasts.push({ kind: "warning", message });
    },
  },
}));

import { realT } from "@/test/i18nReal";
import { toastBulkResult } from "@/lib/admin/bulkToast";

/** Prawdziwe `t` z tej samej instancji i18next, której używa aplikacja. */
const pl = realT("pl");
const en = realT("en");

const NONE_KEY = "admin.bulkResult.none";
const PARTIAL_KEY = "admin.bulkResult.partial";
const SUCCESS_KEY = "admin.bulkResult.trashed";

/** Uczciwy wynik z serwera. */
function result(count: number, requested: number): BulkResult {
  return { ok: true, count, requested };
}

/** Jedyny pokazany toast - z asercją, że był DOKŁADNIE jeden. */
function onlyToast(): { kind: string; message: string } {
  expect(h.toasts).toHaveLength(1);
  const first = h.toasts[0];
  if (!first) throw new Error("test: nie pokazano żadnego toastu");
  return first;
}

beforeEach(() => {
  h.toasts = [];
});

// ---------------------------------------------------------------------------
// 1. SŁOWNIK - warunek sensu wszystkich asercji niżej.
// ---------------------------------------------------------------------------

describe("toasty masowe - klucze w słowniku", () => {
  it.each([NONE_KEY, PARTIAL_KEY, SUCCESS_KEY])(
    "klucz %s ma tłumaczenie w PL i EN, i te tłumaczenia się RÓŻNIĄ",
    (key) => {
      // Bez tego testu porównania niżej mogłyby być tautologią: przy braku
      // klucza i18next zwraca sam klucz, więc „treść toastu == t(klucz)”
      // przechodziłoby także wtedy, gdy słownik jest pusty.
      expect(pl(key)).not.toBe(key);
      expect(en(key)).not.toBe(key);
      expect(pl(key)).not.toBe(en(key));
    },
  );
});

// ---------------------------------------------------------------------------
// 2. PRÓG ZERA - najgroźniejszy przypadek.
// ---------------------------------------------------------------------------

describe("toasty masowe - zero zmienionych wierszy", () => {
  const ZEROS: readonly { label: string; requested: number }[] = [
    { label: "zażądano dwóch, zmieniono zero (RLS odrzuciło oba)", requested: 2 },
    { label: "zażądano jednego, zmieniono zero", requested: 1 },
    { label: "zażądano zera - pusty zaznaczony zbiór", requested: 0 },
  ];

  it.each(ZEROS)("$label: BŁĄD, nie sukces", ({ requested }) => {
    // `count === 0` idzie pierwsze, więc łapie także `0 z 0`. Komunikat
    // „zrobiono 0” w kolorze sukcesu jest w tym miejscu najgorszą możliwą
    // odpowiedzią - redaktor uznaje operację za wykonaną.
    const changed = toastBulkResult(pl, result(0, requested), SUCCESS_KEY);
    expect(changed).toBe(false);
    expect(onlyToast()).toEqual({ kind: "error", message: pl(NONE_KEY) });
  });

  it("komunikat zera NIE jest kluczem sukcesu podanym przez wywołującego", () => {
    // Gałąź zera IGNORUJE `successKey` - i to jest zamierzone. Test pilnuje,
    // żeby nikt nie „ujednolicił” tego, wstawiając tam klucz operacji.
    toastBulkResult(pl, result(0, 3), SUCCESS_KEY);
    expect(onlyToast().message).not.toBe(pl(SUCCESS_KEY, { count: 0 }));
  });
});

// ---------------------------------------------------------------------------
// 3. WYNIK CZĘŚCIOWY.
// ---------------------------------------------------------------------------

describe("toasty masowe - wynik częściowy", () => {
  const PARTIALS: readonly { count: number; requested: number }[] = [
    { count: 1, requested: 2 },
    { count: 9, requested: 12 },
    { count: 49, requested: 50 },
  ];

  it.each(PARTIALS)(
    "$count z $requested: OSTRZEŻENIE z dwiema liczbami",
    ({ count, requested }) => {
      const changed = toastBulkResult(pl, result(count, requested), SUCCESS_KEY);
      expect(changed).toBe(true);
      const toast = onlyToast();
      expect(toast.kind).toBe("warning");
      expect(toast.message).toBe(pl(PARTIAL_KEY, { count, requested }));
      // Obie liczby MUSZĄ być w treści: bez „z ilu” redaktor nie wie, ile
      // zostało do naprawienia.
      expect(toast.message).toContain(String(count));
      expect(toast.message).toContain(String(requested));
    },
  );

  it("liczby są WSTAWIONE, a nie zostawione jako `{{count}}`", () => {
    // Brak parametru w wywołaniu `t` daje w toaście surowy szablon - to
    // wygląda jak awaria panelu i nie da się z tego odczytać wyniku.
    toastBulkResult(pl, result(1, 4), SUCCESS_KEY);
    expect(onlyToast().message).not.toContain("{{");
  });

  it("ostrzeżenie brzmi INACZEJ po polsku i po angielsku", () => {
    // Komunikat składa i18next, więc dowodem dwujęzyczności jest RÓŻNICA
    // treści przy tym samym wyniku.
    toastBulkResult(pl, result(1, 2), SUCCESS_KEY);
    const polish = onlyToast().message;
    h.toasts = [];
    toastBulkResult(en, result(1, 2), SUCCESS_KEY);
    const english = onlyToast().message;
    expect(polish).not.toBe(english);
    expect(polish).toContain("1");
    expect(english).toContain("1");
  });
});

// ---------------------------------------------------------------------------
// 4. PEŁNY SUKCES.
// ---------------------------------------------------------------------------

describe("toasty masowe - pełny sukces", () => {
  const SUCCESS_KEYS: readonly string[] = [
    "admin.bulkResult.trashed",
    "admin.bulkResult.restored",
    "admin.bulkResult.purged",
    "admin.bulkResult.updated",
  ];

  it.each(SUCCESS_KEYS)("klucz %s jedzie do toastu razem z licznikiem", (key) => {
    // Klucz operacji podaje WYWOŁUJĄCY - „przeniesiono do kosza” i „usunięto
    // trwale” to dla redaktora dwie zupełnie różne wiadomości.
    const changed = toastBulkResult(pl, result(3, 3), key);
    expect(changed).toBe(true);
    expect(onlyToast()).toEqual({ kind: "success", message: pl(key, { count: 3 }) });
    expect(onlyToast().message).toContain("3");
  });

  it("cztery klucze operacji dają cztery RÓŻNE komunikaty", () => {
    // Gdyby dwa klucze zbiegły się do jednego napisu, redaktor nie
    // odróżniłby kosza od trwałego usunięcia - a jedno jest odwracalne,
    // drugie nie.
    const messages = SUCCESS_KEYS.map((key) => pl(key, { count: 3 }));
    expect(new Set(messages).size).toBe(SUCCESS_KEYS.length);
  });

  it("sukces po angielsku brzmi inaczej niż po polsku", () => {
    toastBulkResult(pl, result(2, 2), SUCCESS_KEY);
    const polish = onlyToast().message;
    h.toasts = [];
    toastBulkResult(en, result(2, 2), SUCCESS_KEY);
    expect(onlyToast().message).not.toBe(polish);
  });

  it("stan faktyczny: `count` WIĘKSZY niż `requested` też jest sukcesem", () => {
    // Kształt niemożliwy przy poprawnym serwerze (nie da się zmienić więcej
    // wierszy, niż zażądano), ale kod go nie odrzuca - wpada w gałąź sukcesu.
    // Przypięte świadomie: gdyby serwer zaczął kiedyś liczyć `count` inaczej
    // (np. razem z kaskadą), panel pokaże sukces z liczbą większą od
    // zaznaczenia, a nie ostrzeżenie.
    const changed = toastBulkResult(pl, result(5, 2), SUCCESS_KEY);
    expect(changed).toBe(true);
    expect(onlyToast().kind).toBe("success");
  });

  it("stan faktyczny: BRAKUJĄCY klucz sukcesu pokaże się jako surowy napis", () => {
    // Helper nie waliduje klucza - i nie ma go czym walidować w runtime.
    // Zaporą jest bramka parzystości słowników
    // (`src/lib/__tests__/i18n-key-parity.test.ts`), nie ten kod. Test
    // przypina skutek, żeby nikt nie liczył na cichy fallback.
    toastBulkResult(pl, result(1, 1), "admin.bulkResult.klucza-nie-ma");
    expect(onlyToast()).toEqual({
      kind: "success",
      message: "admin.bulkResult.klucza-nie-ma",
    });
  });
});

// ---------------------------------------------------------------------------
// 5. DOKŁADNIE JEDEN TOAST.
// ---------------------------------------------------------------------------

describe("toasty masowe - jeden komunikat na wywołanie", () => {
  const CASES: readonly { label: string; bulk: BulkResult; kind: string }[] = [
    { label: "zero zmienionych", bulk: { ok: true, count: 0, requested: 2 }, kind: "error" },
    { label: "wynik częściowy", bulk: { ok: true, count: 1, requested: 2 }, kind: "warning" },
    { label: "pełny sukces", bulk: { ok: true, count: 2, requested: 2 }, kind: "success" },
  ];

  it.each(CASES)("$label pokazuje wyłącznie toast typu $kind", ({ bulk, kind }) => {
    // Dwa toasty naraz (ostrzeżenie + sukces) czyta się jako „udało się”,
    // bo sukces jest zwykle drugi i przykrywa poprzedni.
    toastBulkResult(pl, bulk, SUCCESS_KEY);
    expect(h.toasts.map((entry) => entry.kind)).toEqual([kind]);
  });
});
