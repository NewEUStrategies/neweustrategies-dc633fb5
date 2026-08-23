// Dwa cienkie server fns panelu poczty systemowej: raport wysyłek
// (`system-emails.functions.ts`) i podgląd maili autoryzacyjnych
// (`auth-email-preview.functions.ts`). Oba stały na 0%.
//
// CO TU JEST DO ZEPSUCIA, skoro cała logika mieszka piętro niżej. Dokładnie
// dwie rzeczy, i obie są kosztowne:
//
//   1. WALIDATOR. To on decyduje, jaką stronę i jaki zakres dni panel może
//      zamówić. Brak górnego ograniczenia na `pageSize` albo `days` zamienia
//      panel operatora w narzędzie do zdjęcia bazy jednym kliknięciem, a brak
//      wartości domyślnych wymusiłby na każdym wywołującym powtarzanie tych
//      samych liczb - i pierwsza literówka dałaby raport z innego okna czasu
//      niż etykieta nad nim.
//   2. MIDDLEWARE. `requireAdmin`, nie `requireStaff`: raport wysyłek pokazuje
//      ADRESY ODBIORCÓW, a podgląd - pełną treść maili autoryzacyjnych razem
//      z kształtem linków logowania. Redaktor nie ma prawa ani do jednego,
//      ani do drugiego.
//
// Test handlera mówi o LOGICE, nie o tym, kto ma prawo go wywołać (atrapa
// `createServerFn` nie uruchamia middleware - patrz `src/test/serverFn.ts`),
// więc autorytet jest dowiedziony STRUKTURALNIE: przez listę middleware.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchReport: vi.fn(),
  renderPreviews: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
  requireStaff: { name: "requireStaff" },
}));
vi.mock("@/lib/email/system-log.server", () => ({
  fetchSystemEmailReport: h.fetchReport,
}));
vi.mock("@/lib/email/auth-preview.server", () => ({
  renderAllAuthEmailPreviews: h.renderPreviews,
}));

import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";
import { getSystemEmailReport } from "@/lib/system-emails.functions";
import { getAuthEmailPreviews } from "@/lib/auth-email-preview.functions";

/** Nazwy middleware zadeklarowanych przez server fn (dowód strukturalny). */
function middlewareNames(fn: unknown): string[] {
  return (serverFnMeta(fn)?.middleware ?? []).map((m) => (m as { name?: string }).name ?? "");
}

beforeEach(() => {
  h.fetchReport.mockReset();
  h.renderPreviews.mockReset();
  h.fetchReport.mockResolvedValue({ rows: [], total: 0, byDay: [] });
  h.renderPreviews.mockResolvedValue([]);
  setServerFnContext({ supabase: null });
});

describe("getSystemEmailReport - raport wysyłek maili systemowych", () => {
  it("wywołanie BEZ argumentów dostaje komplet wartości domyślnych", async () => {
    // Panel woła to przy pierwszym wejściu na zakładkę. Brak domyślnych oznacza
    // pusty raport na starcie - operator widzi zero wysyłek i myśli, że poczta
    // nie działa.
    await getSystemEmailReport();

    expect(h.fetchReport).toHaveBeenCalledTimes(1);
    expect(h.fetchReport).toHaveBeenCalledWith({
      days: 7,
      template: null,
      status: null,
      search: null,
      page: 1,
      pageSize: 50,
    });
  });

  it("przekazuje filtry operatora bez zmiany", async () => {
    await getSystemEmailReport({
      data: {
        days: 30,
        template: "payment_failed",
        status: "dlq",
        search: "anna@",
        page: 3,
        pageSize: 100,
      },
    });

    expect(h.fetchReport).toHaveBeenCalledWith({
      days: 30,
      template: "payment_failed",
      status: "dlq",
      search: "anna@",
      page: 3,
      pageSize: 100,
    });
    expect(h.fetchReport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["okno dłuższe niż 90 dni", { days: 91 }],
    ["okno zerowe", { days: 0 }],
    ["strona spoza zakresu", { page: 501 }],
    ["strona zerowa", { page: 0 }],
    ["porcja większa niż 100", { pageSize: 101 }],
    ["porcja mniejsza niż 10", { pageSize: 9 }],
    ["status spoza słownika", { status: "wyslane" }],
    ["fraza dłuższa niż 160 znaków", { search: "x".repeat(161) }],
    ["nazwa szablonu dłuższa niż 120 znaków", { template: "y".repeat(121) }],
    ["okno ułamkowe", { days: 7.5 }],
  ])("odrzuca %s PRZED zapytaniem", async (_n, data) => {
    // Górne ograniczenia to nie kosmetyka: bez nich jedno kliknięcie w panelu
    // zamawia z bazy cały log wysyłek.
    await expect(getSystemEmailReport({ data })).rejects.toBeTruthy();

    expect(h.fetchReport).not.toHaveBeenCalled();
  });

  it("pusty szablon jako `null` przechodzi - to znaczy „bez filtra”, nie „szablon o pustej nazwie”", async () => {
    await getSystemEmailReport({ data: { template: null, status: null } });

    expect(h.fetchReport).toHaveBeenCalledWith(
      expect.objectContaining({ template: null, status: null }),
    );
    expect(h.fetchReport).toHaveBeenCalledTimes(1);
  });

  it("oddaje raport z warstwy niżej BEZ przetwarzania", async () => {
    // Ten plik ma być cienki. Gdyby zaczął mapować wiersze, raport i panel
    // rozjechałyby się przy pierwszej zmianie kształtu w `system-log.server`.
    const raport = { rows: [{ id: "1" }], total: 1, byDay: [{ day: "2026-08-22", sent: 1 }] };
    h.fetchReport.mockResolvedValue(raport);

    await expect(getSystemEmailReport()).resolves.toBe(raport);
    expect(h.fetchReport).toHaveBeenCalledTimes(1);
  });

  it("wymaga ADMINA, nie samego zalogowania - raport pokazuje adresy odbiorców", () => {
    expect(middlewareNames(getSystemEmailReport)).toContain("requireAdmin");
    expect(middlewareNames(getSystemEmailReport)).not.toContain("requireStaff");
  });
});

describe("getAuthEmailPreviews - podgląd maili autoryzacyjnych", () => {
  it("bez argumentów renderuje podgląd po polsku z domyślnym imieniem", async () => {
    await getAuthEmailPreviews();

    expect(h.renderPreviews).toHaveBeenCalledTimes(1);
    expect(h.renderPreviews).toHaveBeenCalledWith("pl", "Marek", "unknown");
  });

  it("przekazuje wybrany język, imię i rodzaj gramatyczny", async () => {
    await getAuthEmailPreviews({ data: { lang: "en", firstName: "Anna", gender: "female" } });

    expect(h.renderPreviews).toHaveBeenCalledWith("en", "Anna", "female");
    expect(h.renderPreviews).toHaveBeenCalledTimes(1);
  });

  it("imię jako `null` przechodzi - podgląd bez personalizacji jest osobnym przypadkiem", async () => {
    // Mail wychodzi też do adresów, których imienia nie znamy; redakcja musi
    // móc zobaczyć DOKŁADNIE tę wersję, a nie tylko wariant z imieniem.
    await getAuthEmailPreviews({ data: { firstName: null } });

    expect(h.renderPreviews).toHaveBeenCalledWith("pl", null, "unknown");
    expect(h.renderPreviews).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["język spoza słownika", { lang: "de" }],
    ["rodzaj spoza słownika", { gender: "other" }],
    ["imię dłuższe niż 60 znaków", { firstName: "z".repeat(61) }],
  ])("odrzuca %s PRZED renderem", async (_n, data) => {
    await expect(getAuthEmailPreviews({ data })).rejects.toBeTruthy();

    expect(h.renderPreviews).not.toHaveBeenCalled();
  });

  it("oddaje listę podglądów BEZ przetwarzania", async () => {
    const podglady = [{ type: "recovery", subject: "Reset hasła", html: "<html/>" }];
    h.renderPreviews.mockResolvedValue(podglady);

    await expect(getAuthEmailPreviews()).resolves.toBe(podglady);
    expect(h.renderPreviews).toHaveBeenCalledTimes(1);
  });

  it("wymaga ADMINA - podgląd pokazuje pełną treść maili logowania", () => {
    // Treść maila autoryzacyjnego niesie kształt linku logowania. Redaktor nie
    // ma powodu go widzieć, a ma powód, żeby go nie widzieć.
    expect(middlewareNames(getAuthEmailPreviews)).toContain("requireAdmin");
    expect(middlewareNames(getAuthEmailPreviews)).not.toContain("requireStaff");
  });
});

describe("sprzątanie kontekstu", () => {
  it("bez kontekstu server fn woła się BŁĘDEM testu, nie cichym undefined", async () => {
    // Strażnik harnessu: handler czytający `context.supabase` z `undefined`
    // wywaliłby się komunikatem o niczym.
    resetServerFnContext();

    await expect(getSystemEmailReport()).rejects.toThrow(/brak kontekstu server fn/);
    expect(h.fetchReport).not.toHaveBeenCalled();
  });
});
