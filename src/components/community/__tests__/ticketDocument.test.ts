// Potwierdzenie rezerwacji jako samodzielny plik HTML.
//
// TO NIE BILET WSTĘPU (REG-12): plik nie niesie kodu QR - numer potwierdzenia
// nie otwiera bramki, a notka odsyła do maila „Twój bilet".
//
// DLACZEGO TO NIE JEST „TYLKO SZABLON". Dokument skleja HTML z danych, których
// źródłem jest baza i formularz: tytuł wydarzenia, miejsce, imię uczestnika,
// numer transakcji. Plik ląduje potem na dysku człowieka i jest otwierany
// w przeglądarce BEZ naszego CSP - czyli w kontekście `file://`, gdzie nic go
// już nie chroni. Ucieczka znaków jest tu jedyną barierą i dlatego ma
// dedykowane asercje, a nie jedną „czy się renderuje".
import { describe, expect, it, vi } from "vitest";
import type { MyEventTicket } from "@/lib/events/ticketTypes";
import { buildTicketDocument, downloadTicketDocument } from "@/components/community/ticketDocument";

function ticket(overrides: Partial<MyEventTicket> = {}): MyEventTicket {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    slug: "szczyt-energetyczny",
    titlePl: "Szczyt energetyczny",
    titleEn: "Energy summit",
    startsAt: "2026-09-01T08:00:00.000Z",
    endsAt: null,
    timezone: "Europe/Warsaw",
    location: "Bruksela",
    code: "NES-1A2B-3C4D",
    transactionId: "pi_test_123",
    amountCents: 12000,
    currency: "PLN",
    paidAt: "2026-08-01T10:00:00.000Z",
    holderName: "Anna Kowalska",
    holderEmail: "anna@example.org",
    entry: "emailed_qr",
    ...overrides,
  };
}

const BASE = {
  lang: "pl" as const,
  title: "Szczyt energetyczny",
  dateLabel: "1 września 2026, 10:00",
};

describe("buildTicketDocument - treść", () => {
  it("jest kompletnym dokumentem HTML z językiem strony", () => {
    // Plik otwiera się poza aplikacją, więc musi być samodzielny - fragment
    // bez `<!doctype>` przeglądarka renderuje w trybie zgodności.
    const html = buildTicketDocument({ ...BASE, ticket: ticket() });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="pl">');
    expect(html).toContain('<meta charset="utf-8" />');
  });

  it("niesie numer potwierdzenia, termin, miejsce, uczestnika i numer transakcji", () => {
    const html = buildTicketDocument({ ...BASE, ticket: ticket() });
    for (const value of [
      "NES-1A2B-3C4D",
      "1 września 2026, 10:00",
      "Bruksela",
      "Anna Kowalska",
      "pi_test_123",
    ]) {
      expect(html).toContain(value);
    }
  });

  it("POMIJA wiersze bez wartości, zamiast zostawiać puste rubryki", () => {
    // Bilet bezpłatny nie ma numeru transakcji, wydarzenie online nie ma
    // miejsca - pusty wiersz na wydruku wygląda jak brakujące dane.
    const html = buildTicketDocument({
      ...BASE,
      dateLabel: null,
      ticket: ticket({ location: null, transactionId: null }),
    });
    expect(html).not.toContain("Numer transakcji");
    expect(html).not.toContain("Miejsce");
    expect(html).not.toContain("Termin");
    expect(html).toContain("Numer potwierdzenia");
  });

  it("bez imienia podpisuje biletem adresem e-mail", () => {
    const html = buildTicketDocument({
      ...BASE,
      ticket: ticket({ holderName: null }),
    });
    expect(html).toContain("anna@example.org");
  });

  it("bez imienia i adresu nie renderuje wiersza uczestnika", () => {
    const html = buildTicketDocument({
      ...BASE,
      ticket: ticket({ holderName: null, holderEmail: null }),
    });
    expect(html).not.toContain("Uczestnik");
  });

  it("REG-12: dokument NIE niesie kodu QR ani żadnego obrazka", () => {
    const html = buildTicketDocument({ ...BASE, ticket: ticket() });
    expect(html).not.toContain("<img");
    expect(html).not.toContain('class="qr"');
    expect(html).not.toContain("?ticket=");
    expect(html).toContain("NES-1A2B-3C4D");
  });

  it("REG-12: tytuł i notka mówią, że to potwierdzenie rezerwacji, nie bilet wstępu", () => {
    const pl = buildTicketDocument({ ...BASE, ticket: ticket() });
    const en = buildTicketDocument({ ...BASE, lang: "en", ticket: ticket() });
    expect(pl).toContain("<title>Potwierdzenie rezerwacji - Szczyt energetyczny</title>");
    expect(pl).toContain("nie bilet wstępu");
    expect(pl).toContain("„Twój bilet”");
    expect(en).toContain("Booking confirmation");
    expect(en).toContain("not an entry ticket");
  });

  it("obie wersje językowe mają własne etykiety i pouczenie", () => {
    const pl = buildTicketDocument({ ...BASE, ticket: ticket() });
    const en = buildTicketDocument({ ...BASE, lang: "en", ticket: ticket() });
    expect(pl).toContain("Numer potwierdzenia");
    expect(pl).toContain("nieprzenoszalne");
    expect(en).toContain("Booking reference");
    expect(en).toContain("non-transferable");
    expect(en).toContain('<html lang="en">');
  });
});

describe("buildTicketDocument - ucieczka znaków", () => {
  it("TYTUŁ wydarzenia nie może wstrzyknąć znacznika", () => {
    const html = buildTicketDocument({
      ...BASE,
      title: "<script>alert(1)</script>",
      ticket: ticket(),
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("MIEJSCE i UCZESTNIK też przechodzą przez ucieczkę", () => {
    const html = buildTicketDocument({
      ...BASE,
      ticket: ticket({
        location: '<img src=x onerror="alert(1)">',
        holderName: 'Anna "AK" <b>Kowalska</b>',
      }),
    });
    // Napis „onerror=" PRZETRWA jako zwykły tekst i tak ma być - liczy się to,
    // że nie powstaje z niego ZNACZNIK. Asercja mierzy więc brak surowego
    // `<img`, a nie brak słowa, bo słowo w treści biletu jest nieszkodliwe.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&quot;AK&quot;");
    expect(html).not.toContain("<b>Kowalska</b>");
  });

  it("ampersand jest uciekany PIERWSZY, więc encje nie są podwójnie kodowane", () => {
    // Kolejność w `escapeHtml` ma znaczenie: gdyby `&` szło po `<`, wynik
    // dla „<" byłby „&amp;lt;" i użytkownik zobaczyłby surową encję.
    const html = buildTicketDocument({ ...BASE, title: "Energia & Klimat <UE>", ticket: ticket() });
    expect(html).toContain("Energia &amp; Klimat &lt;UE&gt;");
    expect(html).not.toContain("&amp;lt;");
  });

  it("tytuł dokumentu w nagłówku strony też jest uciekany", () => {
    const html = buildTicketDocument({
      ...BASE,
      title: "</title><script>x</script>",
      ticket: ticket(),
    });
    expect(html).not.toContain("</title><script>");
  });
});

describe("downloadTicketDocument", () => {
  it("zapisuje plik BEZ żądania sieciowego i sprząta po sobie", () => {
    // Bilet ma się pobrać także wtedy, gdy sieć padła w drodze na wydarzenie.
    const createUrl = vi.fn(() => "blob:mock/bilet");
    const revokeUrl = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    vi.stubGlobal("fetch", fetchSpy);
    const clicked: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };

    try {
      downloadTicketDocument("<html></html>", "bilet-szczyt.html");
      expect(clicked).toEqual(["bilet-szczyt.html"]);
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(revokeUrl).toHaveBeenCalledWith("blob:mock/bilet");
      expect(fetchSpy).not.toHaveBeenCalled();
      // Kotwica nie może zostać w dokumencie - lista plików rosłaby przy
      // każdym pobraniu.
      expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      vi.unstubAllGlobals();
    }
  });
});
