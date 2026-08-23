// Organizm logu audytu gifting - CZY AUDYT DA SIĘ PRZESZUKAĆ I CZY MÓWI,
// ŻE JEST URWANY.
//
// CO TEN PLIK DOWODZI.
//   1. FILTR TYPU ZDARZENIA JEDZIE DO ZAPYTANIA I DO KLUCZA CACHE - liczenie w
//      bazie, a nie przesiewanie pierwszej strony wyników.
//   2. PANEL PROSI O 200 ZDARZEŃ OD ZERA i tyle pokazuje.
//   3. AUDYT NIE MA FILTRA „WYGASŁE", choć server fn go przyjmuje, `GiftEventType`
//      go zna, a plakietka ma dla niego tonację (defekt, `it.fails` niżej).
//      Zdarzenia wygaśnięcia widać więc TYLKO w widoku „Wszystkie" - czyli w tym,
//      który jest urwany na 200 pozycjach.
//   4. `total` Z ODPOWIEDZI JEST IGNOROWANE, a urwanie historii nie jest
//      zakomunikowane (defekt). Audyt urwany bez ostrzeżenia jest gorszy niż brak
//      audytu, bo wygląda na kompletny.
//   5. CZAS FORMATUJE SIĘ PRZEKAZANYM LOCALE (z `uiLocale` trasy), z dokładnością
//      do sekundy - w audycie kolejność zdarzeń w tej samej minucie jest istotna.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Markupu wiersza, „anonimowego odbiorcy" i skrótu
// kodu - to `GiftEventRow.test.tsx`. Fallbacku dla nieznanego typu na prawdziwym
// słowniku - `GiftEventRowRealDictionary.test.tsx`. Enumu walidatora server fn -
// `src/lib/__tests__/giftingAdminFunctions.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({ listEvents: vi.fn() }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => undefined }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/gifting-admin.functions", () => ({ listGiftEventsAdmin: h.listEvents }));

import { GiftAuditPanel } from "@/components/admin/gifting/organisms/GiftAuditPanel";
import type { GiftEventAdminRow } from "@/lib/gifting-admin.functions";

function zdarzenie(patch: Partial<GiftEventAdminRow> = {}, i = 0): GiftEventAdminRow {
  return {
    id: `event-${i}`,
    event_type: "created",
    post_id: `post-${i}`,
    post_title: `Wpis ${i}`,
    actor_id: `aktor-${i}`,
    actor_name: "Redakcja Testowa",
    actor_email: "redakcja@example.com",
    code: `KOD${String(i).padStart(4, "0")}XXXXXX`,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    total_count: 1,
    ...patch,
  };
}

async function panel(
  rows: GiftEventAdminRow[] = [zdarzenie()],
  opcje: { total?: number; dateLocale?: string } = {},
) {
  h.listEvents.mockResolvedValue({ rows, total: opcje.total ?? rows.length });
  const widok = renderWithQueryClient(<GiftAuditPanel dateLocale={opcje.dateLocale ?? "pl-PL"} />);
  await waitFor(() => expect(h.listEvents).toHaveBeenCalled());
  return widok;
}

beforeEach(() => {
  h.listEvents.mockReset();
});

describe("audyt gifting: co panel wysyła", () => {
  it("pierwszy odczyt prosi o 200 zdarzeń od zera, bez filtra typu", async () => {
    await panel();

    expect(h.listEvents).toHaveBeenCalledTimes(1);
    expect(h.listEvents.mock.calls[0][0]).toEqual({
      data: { limit: 200, offset: 0, event_type: "all" },
    });
  });

  it("każdy filtr wysyła nowe zapytanie z własnym typem i zakłada własny klucz cache", async () => {
    const { queryClient } = await panel();

    for (const typ of ["created", "redeemed", "revoked", "exhausted"] as const) {
      const nazwa = `giftingAdmin.audit.filter${typ[0].toUpperCase()}${typ.slice(1)}`;
      fireEvent.click(screen.getByRole("button", { name: nazwa }));
      await waitFor(() =>
        expect(h.listEvents.mock.calls.at(-1)?.[0]).toEqual({
          data: { limit: 200, offset: 0, event_type: typ },
        }),
      );
      expect(queryClient.getQueryData(["gift-admin", "audit", typ])).toBeTruthy();
    }
  });

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("audyt pozwala odfiltrować zdarzenia WYGAŚNIĘCIA", async () => {
    // Oczekiwane: skoro walidator server fn przyjmuje `expired`, a plakietka ma
    // dla niego tonację, panel ma dać ten filtr. Słownik ma `audit.type.expired`,
    // ale nie ma `audit.filterExpired`.
    await panel();

    expect(screen.getByRole("button", { name: "giftingAdmin.audit.filterExpired" })).toBeTruthy();
  });

  it("STAN FAKTYCZNY: filtrów jest PIĘĆ i nie ma wśród nich „wygasłe”", async () => {
    // Konsekwencja: zdarzenia wygaśnięcia widać wyłącznie w widoku „Wszystkie",
    // czyli w tym urwanym na 200 pozycjach.
    await panel();

    const filtry = screen.getAllByRole("button");
    expect(filtry.map((f) => f.textContent)).toEqual([
      "giftingAdmin.audit.filterAll",
      "giftingAdmin.audit.filterCreated",
      "giftingAdmin.audit.filterRedeemed",
      "giftingAdmin.audit.filterRevoked",
      "giftingAdmin.audit.filterExhausted",
    ]);
  });
});

describe("audyt gifting: urwana historia", () => {
  const DWIEŚCIE = Array.from({ length: 200 }, (_, i) => zdarzenie({}, i));

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("audyt urwany na 200 z 9000 MÓWI o tym adminowi", async () => {
    // Oczekiwane: licznik albo `giftingAdmin.common.loadMore`. Server fn liczy
    // `total` z `total_count` i panel go nie czyta.
    await panel(DWIEŚCIE, { total: 9000 });

    await screen.findByText("Wpis 0");
    expect(screen.getByText(/9000/)).toBeTruthy();
  });

  it("STAN FAKTYCZNY: 200 wierszy, zero informacji o 8800 pozostałych", async () => {
    await panel(DWIEŚCIE, { total: 9000 });

    await screen.findByText("Wpis 0");
    expect(screen.queryByText(/9000/)).toBeNull();
    expect(screen.queryByText("giftingAdmin.common.loadMore")).toBeNull();
    expect(h.listEvents).toHaveBeenCalledTimes(1);
  });
});

describe("audyt gifting: stany tabeli i czas", () => {
  it("odczyt w locie mówi „wczytuję”, a NIE „brak zdarzeń”", () => {
    h.listEvents.mockReturnValue(new Promise(() => undefined));
    renderWithQueryClient(<GiftAuditPanel dateLocale="pl-PL" />);

    expect(screen.getByText("giftingAdmin.common.loading")).toBeTruthy();
    expect(screen.queryByText("giftingAdmin.audit.empty")).toBeNull();
  });

  it("pusty log po zakończonym odczycie mówi o pustce", async () => {
    await panel([]);

    expect(await screen.findByText("giftingAdmin.audit.empty")).toBeTruthy();
  });

  it("czas zdarzenia formatuje się PRZEKAZANYM locale, z sekundami", async () => {
    const kiedy = new Date(Date.now() - 60_000).toISOString();
    await panel([zdarzenie({ created_at: kiedy })], { dateLocale: "en-GB" });

    const oczekiwany = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(kiedy));
    expect(await screen.findByText(oczekiwany)).toBeTruthy();
  });

  it("nieznany typ zdarzenia nie usuwa wiersza z tabeli", async () => {
    await panel([zdarzenie({ event_type: "quota_topped_up", post_title: "Wpis z przyszłości" })]);

    expect(await screen.findByText("Wpis z przyszłości")).toBeTruthy();
  });
});
