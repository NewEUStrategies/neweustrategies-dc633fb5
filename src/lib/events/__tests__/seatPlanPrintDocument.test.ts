// Dokument druku listy przy drzwiach.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. Firma „<script>” wykonuje się w oknie druku z uprawnieniami panelu.
//   2. Pusta lista drukuje pustą tabelę bez słowa wyjaśnienia.
//   3. Dokument angielskiego panelu ma `lang="pl"` i czytnik czyta go po polsku.
import { describe, expect, it } from "vitest";

import { escapeHtml, seatPlanPrintHtml } from "@/lib/events/seatPlanPrintDocument";

const OPTIONS = {
  lang: "pl" as const,
  documentTitle: "Lista <gala>",
  eventTitle: "Gala & Kongres",
  mapName: "Sala \"A\"",
  columns: { seat: "Miejsce", name: "Uczestnik", company: "Firma", ticket: "Bilet", note: "Uwagi" },
  emptyLabel: "Nikt nie siedzi",
};

describe("dokument druku listy przy drzwiach", () => {
  it("escapuje każdy tekst wpisany ręcznie", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const html = seatPlanPrintHtml(
      [{ seat: "A/1", name: "Anna", company: "<script>alert(1)</script>", ticket: "VIP", note: "" }],
      OPTIONS,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<title>Lista &lt;gala&gt;</title>");
    expect(html).toContain("Gala &amp; Kongres");
    expect(html).toContain('<html lang="pl">');
    expect(html).toContain("<th scope=\"col\">Uczestnik</th>");
  });

  it("pusta lista mówi, że nikt nie siedzi; angielski dokument ma lang=en", () => {
    const html = seatPlanPrintHtml([], { ...OPTIONS, lang: "en" });
    expect(html).toContain('<td colspan="5" class="empty">Nikt nie siedzi</td>');
    expect(html).toContain('<html lang="en">');
  });
});
