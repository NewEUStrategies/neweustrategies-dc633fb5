// Eksport historii płatności po stronie przeglądarki - 0 z 7 funkcji pokrytych
// do 18.08.2026.
//
// PDF powstaje przez okno wydruku, a nie przez bibliotekę, i to nie kaprys:
// standardowe fonty generatorów PDF nie mają polskich znaków (ł, ą, ę wychodzą
// jako puste kwadraty), a wydruk przeglądarki zachowuje pełny Unicode. Skutek
// uboczny tej decyzji jest jednak taki, że SAMI SKLEJAMY HTML - a wartości
// w nim (numer dokumentu, kod kuponu, etykiety) przychodzą od operatora
// płatności i z bazy. Dlatego pierwszym przedmiotem testu jest UCIECZKA ZNAKÓW:
// numer dokumentu z `<script>` nie może trafić do dokumentu wydruku jako
// znacznik.
//
// Drugi przedmiot: `printHistoryPdf` musi ODRÓŻNIĆ zablokowane okno od
// udanego wydruku, bo tylko wtedy karta historii potrafi powiedzieć klientowi,
// że przeglądarka zablokowała wyskakujące okno.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  downloadTextFile,
  historyFileName,
  historyPrintHtml,
  printHistoryPdf,
  type HistoryPrintLabels,
} from "@/lib/billing/exportHistory";
import type { PaymentHistoryRow } from "@/lib/billing/paymentHistory";

function row(overrides: Partial<PaymentHistoryRow> = {}): PaymentHistoryRow {
  return {
    id: "row-1",
    number: "FV/2026/08/0001",
    kind: "subscription",
    status: "paid",
    amountCents: 4900,
    currency: "PLN",
    date: "2026-08-10T10:00:00.000Z",
    detailsUrl: null,
    pdfUrl: null,
    source: "document",
    discountCents: null,
    couponCode: null,
    originalAmountCents: null,
    gift: false,
    giftSource: null,
    ...overrides,
  };
}

const labels: HistoryPrintLabels = {
  title: "Historia płatności",
  number: "Numer",
  date: "Data",
  kind: "Rodzaj",
  amount: "Kwota",
  status: "Status",
  generatedAt: "Wygenerowano 18.08.2026",
  kindLabel: (kind) => `rodzaj:${kind}`,
  statusLabel: (status) => `status:${status}`,
};

describe("historyFileName", () => {
  it("skleja prefiks, datę i rozszerzenie", () => {
    const name = historyFileName("payments", "csv", new Date("2026-08-18T22:00:00.000Z"));

    expect(name).toBe("payments-2026-08-18.csv");
    expect(name.endsWith(".csv")).toBe(true);
  });

  it("dla PDF-a zmienia tylko rozszerzenie", () => {
    const name = historyFileName("payments", "pdf", new Date("2026-01-02T00:00:00.000Z"));

    expect(name).toBe("payments-2026-01-02.pdf");
    expect(name).not.toContain(".csv");
  });
});

describe("historyPrintHtml - UCIECZKA ZNAKÓW", () => {
  it("numer dokumentu ze znacznikiem NIE trafia do wydruku jako znacznik", () => {
    const html = historyPrintHtml([row({ number: '<script>alert("x")</script>' })], labels, "pl");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("cudzysłów w etykiecie jest zamieniany na encję", () => {
    const html = historyPrintHtml([row()], { ...labels, title: 'Raport "roczny"' }, "pl");

    expect(html).toContain("&quot;roczny&quot;");
    expect(html).not.toContain('Raport "roczny"');
  });

  it("ampersand jest zamieniany PIERWSZY, więc encje nie są podwójnie kodowane", () => {
    const html = historyPrintHtml([row({ number: "A&B" })], labels, "pl");

    expect(html).toContain("A&amp;B");
    expect(html).not.toContain("A&amp;amp;B");
  });

  it("etykiety liczone funkcją też przechodzą przez ucieczkę", () => {
    const html = historyPrintHtml(
      [row()],
      { ...labels, statusLabel: () => "<b>zapłacone</b>" },
      "pl",
    );

    expect(html).toContain("&lt;b&gt;zapłacone&lt;/b&gt;");
    expect(html).not.toContain("<b>zapłacone</b>");
  });
});

describe("historyPrintHtml - treść dokumentu", () => {
  it("wstawia język dokumentu do atrybutu `lang`", () => {
    expect(historyPrintHtml([row()], labels, "pl")).toContain('<html lang="pl"');
    expect(historyPrintHtml([row()], labels, "en")).toContain('<html lang="en"');
  });

  it("nagłówki kolumn pochodzą z etykiet, nie z kodu", () => {
    const html = historyPrintHtml([row()], labels, "pl");

    expect(html).toContain("<th>Numer</th>");
    expect(html).toContain("<th>Data</th>");
  });

  it("wiersz zawiera rodzaj i status z funkcji etykietujących", () => {
    const html = historyPrintHtml([row({ kind: "credit_note", status: "refunded" })], labels, "pl");

    expect(html).toContain("rodzaj:credit_note");
    expect(html).toContain("status:refunded");
  });

  it("kwota jest formatowana, a nie wypisywana w groszach", () => {
    const html = historyPrintHtml([row({ amountCents: 4900, currency: "PLN" })], labels, "pl");

    expect(html).toMatch(/49[.,]00/);
    expect(html).not.toContain(">4900<");
  });

  it("waluta inna niż domyślna nie jest podmieniana", () => {
    const html = historyPrintHtml([row({ amountCents: 2500, currency: "EUR" })], labels, "en");

    expect(html).toMatch(/25[.,]00/);
    expect(html).not.toContain("zł");
  });

  it("PUSTA HISTORIA daje poprawny dokument z pustą tabelą, nie wyjątek", () => {
    const html = historyPrintHtml([], labels, "pl");

    expect(html).toContain("<tbody></tbody>");
    expect(html).toContain("Historia płatności");
  });

  it("wiele wierszy daje wiele rzędów tabeli", () => {
    const html = historyPrintHtml(
      [row({ id: "a", number: "FV/1" }), row({ id: "b", number: "FV/2" })],
      labels,
      "pl",
    );

    expect(html.match(/<tr>/g)?.length).toBe(3); // nagłówek + dwa wiersze
    expect(html).toContain("FV/2");
  });
});

describe("downloadTextFile", () => {
  const created: string[] = [];
  const revoked: string[] = [];
  let clicked = 0;

  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    clicked = 0;
    vi.useFakeTimers();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => {
        const url = `blob:test-${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    // Klik na realnym anchorze próbowałby nawigować w happy-dom.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      clicked += 1;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("tworzy adres obiektu i klika w link pobrania", () => {
    downloadTextFile("a;b", "plik.csv", "text/csv");

    expect(created).toHaveLength(1);
    expect(clicked).toBe(1);
  });

  it("po kliknięciu USUWA link z dokumentu", () => {
    downloadTextFile("a;b", "plik.csv", "text/csv");

    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    expect(clicked).toBe(1);
  });

  it("ZWALNIA adres obiektu, ale dopiero w następnej klatce", () => {
    downloadTextFile("a;b", "plik.csv", "text/csv");

    // Synchronicznie NIE - Safari przerywa wtedy pobieranie.
    expect(revoked).toHaveLength(0);

    vi.runAllTimers();
    expect(revoked).toEqual(created);
  });
});

describe("printHistoryPdf", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ZABLOKOWANE OKNO zwraca false, żeby karta mogła się odezwać", () => {
    vi.stubGlobal("open", () => null);

    expect(printHistoryPdf("<html></html>")).toBe(false);
  });

  it("otwarte okno dostaje dokument i zwraca true", () => {
    const written: string[] = [];
    vi.stubGlobal("open", () => ({
      document: { open: () => {}, write: (html: string) => written.push(html), close: () => {} },
      focus: () => {},
      print: () => {},
    }));

    expect(printHistoryPdf("<html>tresc</html>")).toBe(true);
    expect(written).toEqual(["<html>tresc</html>"]);
  });

  it("wydruk odpala się z OPÓŹNIENIEM (bez niego Chrome drukuje pustą stronę)", () => {
    vi.useFakeTimers();
    let printed = 0;
    vi.stubGlobal("open", () => ({
      document: { open: () => {}, write: () => {}, close: () => {} },
      focus: () => {},
      print: () => {
        printed += 1;
      },
    }));

    printHistoryPdf("<html></html>");
    expect(printed).toBe(0);

    vi.runAllTimers();
    expect(printed).toBe(1);
  });

  it("okno jest otwierane jako osobna karta bez dostępu do źródła", () => {
    const args: unknown[][] = [];
    vi.stubGlobal("open", (...called: unknown[]) => {
      args.push(called);
      return null;
    });

    printHistoryPdf("<html></html>");

    expect(String(args[0]?.[2])).toContain("noopener");
    expect(String(args[0]?.[2])).toContain("noreferrer");
  });
});
