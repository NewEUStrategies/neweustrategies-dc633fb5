// Kotwice deep-linków z powiadomień sieciowych - format i rozstrzyganie.
//
// PO CO OSOBNY PLIK. Ten moduł jest JEDYNYM miejscem, w którym format kotwicy
// jest zapisany po stronie klienta, a jego drugi koniec żyje w SQL-u
// (`tg_introduction_notify` i producent rekomendacji w 20260812101000). Baza
// nie ma jak sprawdzić klienta, więc test musi trzymać wartość DOSŁOWNIE -
// asercja przez ten sam helper, którego używa produkcja, przeszłaby także po
// zmianie formatu, czyli po rozjeździe z producentem.
//
// Drugi temat: `resolveAnchorId` i jego zejście. Powiadomienie stempluje status
// Z CHWILI WYSYŁKI, a wiersz oglądany później stoi już na innym - bez zejścia
// deep-link ze skrzynki sprzed godziny nie trafiałby w nic.
import { describe, expect, it } from "vitest";
import {
  introductionAnchorId,
  recommendationAnchorId,
  resolveAnchorId,
} from "@/lib/network/anchors";

/** Buduje DOM z podanych identyfikatorów - `resolveAnchorId` czyta dokument. */
function docWith(ids: readonly string[]): Document {
  const doc = document.implementation.createHTMLDocument("t");
  for (const id of ids) {
    const el = doc.createElement("div");
    el.id = id;
    doc.body.appendChild(el);
  }
  return doc;
}

describe("format kotwicy - kontrakt z wyzwalaczami bazy", () => {
  it("wprowadzenie: `i-<id>-<status>` (20260812101000:92)", () => {
    expect(introductionAnchorId("11110000-0000-0000-0000-000000000001", "pending")).toBe(
      "i-11110000-0000-0000-0000-000000000001-pending",
    );
    expect(introductionAnchorId("abc", "forwarded")).toBe("i-abc-forwarded");
    expect(introductionAnchorId("abc", "withdrawn")).toBe("i-abc-withdrawn");
  });

  it("rekomendacja: `r-<id>-<status>` (20260812101000:201, :216)", () => {
    expect(recommendationAnchorId("rec-1", "pending")).toBe("r-rec-1-pending");
    expect(recommendationAnchorId("rec-1", "published")).toBe("r-rec-1-published");
  });

  it("obie rodziny mają ROZŁĄCZNE prefiksy - inaczej zejście trafiałoby w cudzy wiersz", () => {
    expect(introductionAnchorId("x", "pending").startsWith("i-")).toBe(true);
    expect(recommendationAnchorId("x", "pending").startsWith("r-")).toBe(true);
  });
});

describe("resolveAnchorId - trafienie dokładne", () => {
  it("znajduje element o dokładnie tym identyfikatorze", () => {
    const doc = docWith(["i-abc-pending"]);
    expect(resolveAnchorId("#i-abc-pending", doc)).toBe("i-abc-pending");
  });

  it("działa tak samo bez wiodącego `#` (fragment bywa już obcięty)", () => {
    const doc = docWith(["r-rec-9-published"]);
    expect(resolveAnchorId("r-rec-9-published", doc)).toBe("r-rec-9-published");
  });
});

describe("resolveAnchorId - zejście na ten sam wiersz w innym stanie", () => {
  it("kotwica ze starym statusem trafia w wiersz, który zdążył się zmienić", () => {
    // Most dostał powiadomienie przy `pending`, przekazał prośbę, a potem
    // kliknął stary link: w DOM stoi już `-forwarded`.
    const doc = docWith(["i-abc-forwarded"]);
    expect(resolveAnchorId("#i-abc-pending", doc)).toBe("i-abc-forwarded");
  });

  it("to samo dla rekomendacji (`pending` -> `published`)", () => {
    const doc = docWith(["r-rec-1-published"]);
    expect(resolveAnchorId("#r-rec-1-pending", doc)).toBe("r-rec-1-published");
  });

  it("zejście NIE przeskakuje na inny wiersz tej samej rodziny", () => {
    const doc = docWith(["i-zzz-pending"]);
    expect(resolveAnchorId("#i-abc-pending", doc)).toBeNull();
  });
});

describe("resolveAnchorId - wejścia, które nie mogą wywrócić trasy", () => {
  it("pusty fragment nie jest pytaniem", () => {
    expect(resolveAnchorId("", docWith(["i-abc-pending"]))).toBeNull();
    expect(resolveAnchorId("#", docWith(["i-abc-pending"]))).toBeNull();
  });

  it("fragment bez myślnika nie ma z czego zbudować prefiksu", () => {
    expect(resolveAnchorId("#main-content", docWith(["main-content"]))).toBe("main-content");
    expect(resolveAnchorId("#sekcja", docWith(["i-abc-pending"]))).toBeNull();
  });

  it("fragment zaczynający się od myślnika nie daje prefiksu pustego", () => {
    // `lastIndexOf("-") <= 0` odcina ten przypadek: prefiks "" pasowałby do
    // KAŻDEGO elementu z `id` i deep-link przewijałby w losowe miejsce.
    expect(resolveAnchorId("#-abc", docWith(["i-abc-pending"]))).toBeNull();
  });

  it("dokument bez żadnych identyfikatorów oddaje `null`, a nie wyjątek", () => {
    expect(resolveAnchorId("#i-abc-pending", docWith([]))).toBeNull();
  });
});
