// Historia faktur i płatności - 0 z 10 funkcji pokrytych do 18.08.2026.
//
// Jedna karta obsługuje DWIE powierzchnie: skrót na stronie planu (`limit`)
// i pełne zestawienie na /profile/payments (z eksportem CSV i PDF). Reguła
// scalania trzech źródeł (zamówienia + dokumenty + nadania) ma własny test
// (`paymentHistory.test.ts`) i tego nie duplikujemy - tu sprawdzamy, co karta
// z tym scaleniem ROBI.
//
// Trzy rzeczy warte pilnowania:
//
//   1. EKSPORT IDZIE NA CAŁOŚĆ, NIE NA WIDOCZNY WYCINEK. Skrót pokazuje np. trzy
//      wiersze, ale plik ma zawierać całą historię - inaczej klient „eksportuje
//      historię" i dostaje jej urwany kawałek do księgowości.
//   2. WALUTA JEST WYPISANA OBOK KWOTY. Zestawienie potrafi mieszać waluty
//      (PLN i EUR w jednej tabeli), więc sama kwota bez kodu waluty jest
//      dwuznaczna.
//   3. ZABLOKOWANE OKNO WYDRUKU MUSI SIĘ ODEZWAĆ. Bez komunikatu klient klika
//      „PDF" i nie dzieje się nic - wygląda jak zepsuty przycisk.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  billingDocument,
  isoPast,
  membershipGrant,
  moneyPattern,
  paymentOrder,
} from "@/test/billing/fixtures";
import type { MembershipGrantRow } from "@/lib/billing/membership";
import type { BillingDocument, PaymentOrder } from "@/lib/billing/types";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  orders: { current: [] as PaymentOrder[] },
  docs: { current: [] as BillingDocument[] },
  grants: { current: [] as MembershipGrantRow[] },
  downloaded: [] as Array<{ content: string; fileName: string; mime: string }>,
  printed: [] as string[],
  printOk: { current: true },
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-me" } } }),
}));

vi.mock("@/lib/billing/queries", () => ({
  fetchMyOrders: () => Promise.resolve(h.orders.current),
  fetchMyBillingDocuments: () => Promise.resolve(h.docs.current),
}));

// Reguła „które nadanie daje dostęp" (`activeGrants`/`primaryGrant`) NIE jest
// atrapą - jest przedmiotem użycia. Atrapą jest tylko odczyt z bazy.
vi.mock("@/lib/billing/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/membership")>()),
  useMyGrants: () => ({ data: h.grants.current }),
}));

// Eksport jest przechwytywany, a nie wykonywany: `downloadTextFile` tworzy
// obiekt Blob i klika w ukryty link, a `printHistoryPdf` otwiera okno - obie
// rzeczy w happy-dom są bez sensu, a treść pliku jest tym, co chcemy sprawdzić.
vi.mock("@/lib/billing/exportHistory", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/billing/exportHistory")>();
  return {
    ...original,
    downloadTextFile: (content: string, fileName: string, mime: string) => {
      h.downloaded.push({ content, fileName, mime });
    },
    printHistoryPdf: (html: string) => {
      h.printed.push(html);
      return h.printOk.current;
    },
  };
});

vi.mock("sonner", () => ({
  toast: { success: () => {}, error: (m: string) => h.toastError(m) },
}));

import { PaymentHistoryCard } from "@/components/billing/organisms/PaymentHistoryCard";

const renderCard = (props: Parameters<typeof PaymentHistoryCard>[0] = {}) =>
  renderWithQueryClient(<PaymentHistoryCard {...props} />);

const awaitRows = () => waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));

beforeEach(() => {
  h.lang.current = "pl";
  h.orders.current = [];
  h.docs.current = [];
  h.grants.current = [];
  h.downloaded.length = 0;
  h.printed.length = 0;
  h.printOk.current = true;
  h.toastError.mockReset();
});

describe("PaymentHistoryCard - pusta i niepusta historia", () => {
  it("pusta historia mówi to wprost, zamiast pokazywać nagłówki tabeli", async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText("profile.planPage.history.empty")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("pusta historia NIE pokazuje przycisków eksportu (nie ma czego eksportować)", async () => {
    renderCard({ showExport: true });

    await waitFor(() => expect(screen.getByText("profile.planPage.history.empty")).toBeTruthy());
    expect(screen.queryByText("profile.planPage.history.exportCsv")).toBeNull();
  });

  it("dokument rozliczeniowy pojawia się z numerem i kwotą", async () => {
    h.docs.current = [billingDocument({ number: "FV/2026/08/0001", amount_cents: 4900 })];
    renderCard();

    await awaitRows();
    expect(screen.getByText("FV/2026/08/0001")).toBeTruthy();
    expect(screen.getByText(moneyPattern(4900))).toBeTruthy();
  });

  it("WALUTA jest wypisana obok kwoty - zestawienie miesza waluty", async () => {
    h.docs.current = [billingDocument({ amount_cents: 2500, currency: "EUR" })];
    renderCard();

    await awaitRows();
    expect(screen.getByText("EUR")).toBeTruthy();
    expect(screen.getByText(moneyPattern(2500))).toBeTruthy();
  });

  it("waluta inna niż domyślna nie jest przeliczana na złote", async () => {
    h.docs.current = [billingDocument({ amount_cents: 9900, currency: "EUR" })];
    renderCard();

    await awaitRows();
    // Kwota zostaje w EUR; nigdzie nie ma podmiany na PLN.
    expect(screen.getByText("EUR")).toBeTruthy();
    expect(screen.queryByText("PLN")).toBeNull();
  });

  // DATY MUSZĄ BYĆ JAWNE I RÓŻNE. `mergePaymentHistory` sortuje MALEJĄCO po
  // `issued_at`, a `limit` bierze wycinek Z GÓRY - więc o tym, który dokument
  // wypada z widoku, decyduje data. Domyślne `isoPast(1)` z fixture'a liczy
  // `Date.now()` przy KAŻDYM wywołaniu: gdy trzy wywołania zmieszczą się w tej
  // samej milisekundzie, sort jest stabilny i wypada FV/3, ale gdy przekroczą
  // granicę milisekundy (wolniejszy host, instrumentacja coverage, runner CI),
  // najnowszy staje się FV/3 i to ON zostaje w wycinku. Test padał wtedy na
  // asercji niżej - nie z powodu błędu w `limit`, tylko z powodu zegara.
  it("`limit` skraca WIDOK do zadanej liczby wierszy", async () => {
    h.docs.current = [
      billingDocument({
        id: "d1",
        provider_document_id: "in_1",
        number: "FV/1",
        issued_at: isoPast(1),
      }),
      billingDocument({
        id: "d2",
        provider_document_id: "in_2",
        number: "FV/2",
        issued_at: isoPast(2),
      }),
      billingDocument({
        id: "d3",
        provider_document_id: "in_3",
        number: "FV/3",
        issued_at: isoPast(3),
      }),
    ];
    renderCard({ limit: 2 });

    await awaitRows();
    // Wiersz nagłówka + dwa wiersze danych.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    // FV/3 jest NAJSTARSZY, więc przy sortowaniu malejącym wypada jako pierwszy.
    expect(screen.queryByText("FV/3")).toBeNull();
  });

  it("bez `limit` pokazuje wszystko", async () => {
    h.docs.current = [
      billingDocument({ id: "d1", provider_document_id: "in_1", number: "FV/1" }),
      billingDocument({ id: "d2", provider_document_id: "in_2", number: "FV/2" }),
      billingDocument({ id: "d3", provider_document_id: "in_3", number: "FV/3" }),
    ];
    renderCard();

    await awaitRows();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("FV/3")).toBeTruthy();
  });

  it("link do pełnej listy pojawia się tylko na żądanie", async () => {
    h.docs.current = [billingDocument()];
    renderCard({ showAllLink: true });

    await awaitRows();
    expect(
      screen.getByText("profile.planPage.history.all").closest("a")?.getAttribute("href"),
    ).toBe("/profile/payments");
  });
});

describe("PaymentHistoryCard - status, rabat i dostęp bez płatności", () => {
  it("dokument nieopłacony ma inny wariant odznaki niż opłacony", async () => {
    h.docs.current = [
      billingDocument({ id: "d1", provider_document_id: "in_1", status: "paid" }),
      billingDocument({ id: "d2", provider_document_id: "in_2", status: "void" }),
    ];
    renderCard();

    await awaitRows();
    expect(screen.getByText("profile.planPage.history.status.paid")).toBeTruthy();
    expect(screen.getByText("profile.planPage.history.status.void")).toBeTruthy();
  });

  it("RABAT pokazuje kwotę zniżki i kod kuponu", async () => {
    h.orders.current = [
      paymentOrder({
        amount_cents: 3900,
        metadata: { discount_cents: 1000, coupon_code: "NES10", original_amount_cents: 4900 },
      }),
    ];
    renderCard();

    await awaitRows();
    const discount = screen.getByText(/profile\.planPage\.history\.discount/);
    expect(discount.textContent).toMatch(moneyPattern(1000));
    expect(discount.textContent).toContain("NES10");
  });

  it("NADANIE jest częścią historii - klient widzi, skąd ma dostęp bez płatności", async () => {
    h.grants.current = [membershipGrant({ source: "expert", tier_key: "member" })];
    renderCard();

    await awaitRows();
    expect(screen.getByText("profile.planPage.grantSource.expert")).toBeTruthy();
    expect(screen.getByText("profile.planPage.history.kind.grant")).toBeTruthy();
  });

  it("wiersz bez dokumentu pokazuje kreskę, nie martwy link", async () => {
    h.orders.current = [paymentOrder({ invoice_url: null })];
    renderCard();

    await awaitRows();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText("profile.planPage.history.details")).toBeNull();
  });

  it("wiersz z dokumentem linkuje do strony operatora w nowej karcie", async () => {
    h.docs.current = [billingDocument({ hosted_url: "https://invoice.example.test/hosted" })];
    renderCard();

    await awaitRows();
    const link = screen.getByText("profile.planPage.history.details").closest("a");
    expect(link?.getAttribute("href")).toBe("https://invoice.example.test/hosted");
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});

describe("PaymentHistoryCard - eksport", () => {
  beforeEach(() => {
    h.docs.current = [
      billingDocument({ id: "d1", provider_document_id: "in_1", number: "FV/1" }),
      billingDocument({ id: "d2", provider_document_id: "in_2", number: "FV/2" }),
      billingDocument({ id: "d3", provider_document_id: "in_3", number: "FV/3" }),
    ];
  });

  it("EKSPORT CSV BIERZE CAŁOŚĆ, nie widoczny wycinek", async () => {
    renderCard({ limit: 1, showExport: true });
    await awaitRows();
    // Widok skrócony do jednego wiersza...
    expect(screen.getAllByRole("row")).toHaveLength(2);

    fireEvent.click(screen.getByText("profile.planPage.history.exportCsv"));

    // ...ale plik zawiera wszystkie trzy dokumenty.
    expect(h.downloaded).toHaveLength(1);
    const csv = h.downloaded[0].content;
    expect(csv).toContain("FV/1");
    expect(csv).toContain("FV/3");
  });

  it("plik CSV ma rozszerzenie i typ MIME zgodne z treścią", async () => {
    renderCard({ showExport: true });
    await awaitRows();

    fireEvent.click(screen.getByText("profile.planPage.history.exportCsv"));

    expect(h.downloaded[0].fileName).toMatch(/^payments-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(h.downloaded[0].mime).toBe("text/csv");
  });

  it("EKSPORT PDF też bierze całość i przechodzi przez okno wydruku", async () => {
    renderCard({ limit: 1, showExport: true });
    await awaitRows();

    fireEvent.click(screen.getByText("profile.planPage.history.exportPdf"));

    expect(h.printed).toHaveLength(1);
    expect(h.printed[0]).toContain("FV/3");
  });

  it("ZABLOKOWANE OKNO WYDRUKU daje komunikat, nie ciszę", async () => {
    h.printOk.current = false;
    renderCard({ showExport: true });
    await awaitRows();

    fireEvent.click(screen.getByText("profile.planPage.history.exportPdf"));

    expect(h.toastError).toHaveBeenCalledWith("profile.planPage.history.popupBlocked");
    expect(h.printed).toHaveLength(1);
  });

  it("bez `showExport` przyciski eksportu nie istnieją", async () => {
    renderCard();
    await awaitRows();

    expect(screen.queryByText("profile.planPage.history.exportCsv")).toBeNull();
    expect(screen.queryByText("profile.planPage.history.exportPdf")).toBeNull();
  });
});
