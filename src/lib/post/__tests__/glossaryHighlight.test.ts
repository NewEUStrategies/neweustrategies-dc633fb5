// Reguła auto-podlinkowania słowniczka: najwyższe ryzyko w module 1, do teraz
// ZERO testów. Ta reguła chodzi po węzłach tekstowych OPUBLIKOWANEGO artykułu
// i je podmienia - jej błąd nie psuje panelu, psuje treść czytaną przez
// użytkownika. Dlatego każdy przypadek asertuje dwie rzeczy: co reguła
// OZNACZYŁA (deskryptor slugów) oraz że TEKST artykułu jest nietknięty.
import { describe, it, expect } from "vitest";
import {
  GLOSSARY_MIN_LABEL_LENGTH,
  GLOSSARY_SKIP_CLOSEST,
  glossaryLabels,
  markFirstOccurrences,
  unmarkAll,
  type GlossaryLabel,
  type GlossaryTermLike,
} from "../glossaryHighlight";
import { sanitizeHtml } from "@/lib/sanitize";

/** Kontener z treścią artykułu, podłączony do dokumentu (jak realny render). */
function article(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function labels(...pairs: [slug: string, label: string][]): GlossaryLabel[] {
  return pairs.map(([slug, label]) => ({ slug, label }));
}

function marks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("span[data-glossary-term]")];
}

describe("glossaryLabels - deskryptory terminów", () => {
  const terms: GlossaryTermLike[] = [
    { slug: "rada-europejska", term_pl: "Rada Europejska", term_en: "European Council" },
    { slug: "akt-delegowany", term_pl: "akt delegowany", term_en: null },
    { slug: "ue", term_pl: "UE", term_en: "EU" },
  ];

  it("bierze termin PL i NIE degraduje go do angielskiego", () => {
    const out = glossaryLabels(terms, "pl");
    expect(out).toHaveLength(3);
    expect(out.map((l) => l.label)).toEqual(["Rada Europejska", "akt delegowany", "UE"]);
  });

  it("wariant EN degraduje do terminu PL, gdy brak angielskiego", () => {
    const out = glossaryLabels(terms, "en");
    expect(out.find((l) => l.slug === "akt-delegowany")?.label).toBe("akt delegowany");
    expect(out.find((l) => l.slug === "rada-europejska")?.label).toBe("European Council");
  });

  it("odrzuca etykiety krótsze niż próg i przycina białe znaki", () => {
    const out = glossaryLabels(
      [
        { slug: "a", term_pl: "A", term_en: "A" },
        { slug: "eu", term_pl: "  UE  ", term_en: null },
      ],
      "pl",
    );
    expect(GLOSSARY_MIN_LABEL_LENGTH).toBe(2);
    expect(out).toEqual([{ slug: "eu", label: "UE" }]);
  });

  it("zachowuje slug jako tożsamość terminu, niezależnie od języka etykiety", () => {
    const pl = glossaryLabels(terms, "pl").map((l) => l.slug);
    const en = glossaryLabels(terms, "en").map((l) => l.slug);
    expect(pl).toEqual(en);
    expect(pl).toContain("rada-europejska");
  });
});

describe("markFirstOccurrences - granice słów", () => {
  it("NIE oznacza terminu wewnątrz innego słowa", () => {
    const root = article("<p>Norma eTSI oraz TSInny wariant.</p>");
    const before = root.textContent;
    const marked = markFirstOccurrences(root, labels(["tsi", "TSI"]));
    expect(marked).toEqual([]);
    expect(root.textContent).toBe(before);
  });

  it("oznacza termin stojący samodzielnie, z interpunkcją po obu stronach", () => {
    const root = article("<p>Norma (TSI) obowiązuje.</p>");
    const marked = markFirstOccurrences(root, labels(["tsi", "TSI"]));
    expect(marked).toEqual(["tsi"]);
    expect(marks(root)[0].textContent).toBe("TSI");
  });

  it("dopasowuje bez rozróżniania wielkości liter, ale ZACHOWUJE pisownię z treści", () => {
    const root = article("<p>Dziś obradowała RADA EUROPEJSKA w Brukseli.</p>");
    const marked = markFirstOccurrences(root, labels(["rada", "Rada Europejska"]));
    expect(marked).toEqual(["rada"]);
    expect(marks(root)[0].textContent).toBe("RADA EUROPEJSKA");
  });

  it("dopasowuje termin z polskimi diakrytykami", () => {
    const root = article("<p>Kluczowy jest Sąd Najwyższy i jego wykładnia.</p>");
    const marked = markFirstOccurrences(root, labels(["sn", "sąd najwyższy"]));
    expect(marked).toEqual(["sn"]);
    expect(marks(root)[0].textContent).toBe("Sąd Najwyższy");
  });

  it("granica na początku i na końcu węzła tekstowego liczy się jako granica słowa", () => {
    const root = article("<p>UE</p>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(marked).toEqual(["ue"]);
    expect(root.querySelector("p")?.textContent).toBe("UE");
  });
});

describe("markFirstOccurrences - konteksty pomijane", () => {
  it("NIE zagnieżdża oznaczenia w linku (żadnego <a> w <a>)", () => {
    const root = article('<p>Zobacz <a href="/x">UE</a> i szczegóły.</p>');
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(marked).toEqual([]);
    expect(root.querySelectorAll("a a")).toHaveLength(0);
  });

  it("pomija nagłówek H2, oznacza ten sam termin w akapicie", () => {
    const root = article("<h2>UE dziś</h2><p>Rola UE rośnie.</p>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(marked).toEqual(["ue"]);
    expect(marks(root)[0].closest("p")).not.toBeNull();
  });

  it("pomija <code> i <pre>", () => {
    const root = article("<p><code>UE</code></p><pre>UE</pre>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(marked).toEqual([]);
    expect(marks(root)).toHaveLength(0);
  });

  it("pomija istniejące oznaczenie i przypis (nie oznacza dwa razy tego samego miejsca)", () => {
    const root = article(
      '<p><span data-glossary-term="ue">UE</span> oraz <sup data-fn="1">UE</sup></p>',
    );
    const marked = markFirstOccurrences(root, labels(["ue2", "UE"]));
    expect(marked).toEqual([]);
    expect(marks(root)).toHaveLength(1);
  });

  it("REGRESJA/PIN: selektor pomijania wymienia H1-H4, więc termin w <h5> JEST oznaczany", () => {
    const root = article("<h5>UE w regionie</h5>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    // Zachowanie odziedziczone - przypięte świadomie, żeby zmiana selektora
    // była decyzją. `h5`/`h6` nie ma w GLOSSARY_SKIP_CLOSEST.
    expect(GLOSSARY_SKIP_CLOSEST).not.toContain("h5");
    expect(marked).toEqual(["ue"]);
  });
});

describe("markFirstOccurrences - tylko pierwsze wystąpienie", () => {
  it("oznacza pierwsze z dwóch wystąpień w tym samym akapicie", () => {
    const root = article("<p>UE działa, a UE decyduje.</p>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(marked).toEqual(["ue"]);
    expect(marks(root)).toHaveLength(1);
  });

  it("oznacza wystąpienie w PIERWSZYM akapicie, pomija dalsze", () => {
    const root = article("<p>Pierwsze: UE.</p><p>Drugie: UE.</p>");
    markFirstOccurrences(root, labels(["ue", "UE"]));
    const all = marks(root);
    expect(all).toHaveLength(1);
    expect(all[0].closest("p")).toBe(root.querySelectorAll("p")[0]);
  });

  it("po oznaczeniu kontynuuje w ogonie węzła i łapie DRUGI, inny termin", () => {
    const root = article("<p>Najpierw UE, potem NATO w tym samym akapicie.</p>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"], ["nato", "NATO"]));
    expect(marked).toEqual(["ue", "nato"]);
    expect(marks(root).map((m) => m.textContent)).toEqual(["UE", "NATO"]);
  });
});

describe("markFirstOccurrences - terminy nakładające się", () => {
  it("dłuższy termin ma pierwszeństwo: 'UE-27' wygrywa z 'UE' na tej samej pozycji", () => {
    const root = article("<p>Skrót UE-27 oznacza całą Unię.</p>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"], ["ue27", "UE-27"]));
    expect(marked[0]).toBe("ue27");
    expect(marks(root)[0].textContent).toBe("UE-27");
  });

  it("dłuższy termin wygrywa niezależnie od kolejności w słowniku", () => {
    const root = article("<p>Skrót UE-27 oznacza całą Unię.</p>");
    const marked = markFirstOccurrences(root, labels(["ue27", "UE-27"], ["ue", "UE"]));
    expect(marked[0]).toBe("ue27");
    expect(marks(root)[0].textContent).toBe("UE-27");
  });

  it("PIN: bez 'UE-27' w słowniku samo 'UE' JEST oznaczane wewnątrz 'UE-27' (łącznik nie jest znakiem słowa)", () => {
    const root = article("<p>Skrót UE-27 oznacza całą Unię.</p>");
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(marked).toEqual(["ue"]);
    expect(marks(root)[0].textContent).toBe("UE");
  });

  it("termin zawierający inny: 'akt delegowany' przed 'akt'", () => {
    const root = article("<p>To akt delegowany Komisji.</p>");
    const marked = markFirstOccurrences(
      root,
      labels(["akt", "akt"], ["akt-del", "akt delegowany"]),
    );
    expect(marked[0]).toBe("akt-del");
    expect(marks(root)[0].textContent).toBe("akt delegowany");
  });

  it("wybiera trafienie o NAJMNIEJSZYM indeksie, nie najdłuższy termin z dalszej pozycji", () => {
    const root = article("<p>NATO oraz Rada Europejska.</p>");
    const marked = markFirstOccurrences(
      root,
      labels(["nato", "NATO"], ["rada", "Rada Europejska"]),
    );
    expect(marked).toEqual(["nato", "rada"]);
    expect(marks(root).map((m) => m.textContent)).toEqual(["NATO", "Rada Europejska"]);
  });
});

describe("markFirstOccurrences - integralność treści", () => {
  it("nie gubi ani nie duplikuje żadnego znaku tekstu", () => {
    const html = "<p>Rola UE w regionie rośnie, a NATO to potwierdza.</p>";
    const root = article(html);
    const before = root.textContent;
    markFirstOccurrences(root, labels(["ue", "UE"], ["nato", "NATO"]));
    expect(root.textContent).toBe(before);
    expect(marks(root)).toHaveLength(2);
  });

  it("zachowuje spacje wokół oznaczenia", () => {
    const root = article("<p>a UE b</p>");
    markFirstOccurrences(root, labels(["ue", "UE"]));
    const p = root.querySelector("p")!;
    expect(p.textContent).toBe("a UE b");
    expect(p.innerHTML).toContain(">UE</span>");
  });

  it("PIN: termin przecinający granicę węzłów tekstowych NIE jest oznaczany i nic nie ginie", () => {
    // Reguła skanuje węzeł po węźle, więc "Unia Europejska" rozdzielone
    // znacznikiem <em> nie jest dopasowywane. Limit udokumentowany - test
    // pilnuje, że brak dopasowania nie oznacza uszkodzonej treści.
    const root = article("<p>Unia <em>Europejska</em> obraduje.</p>");
    const before = root.textContent;
    const marked = markFirstOccurrences(root, labels(["ue", "Unia Europejska"]));
    expect(marked).toEqual([]);
    expect(root.textContent).toBe(before);
  });

  it("oznaczenie niesie slug, klasę i jest osiągalne z klawiatury", () => {
    const root = article("<p>Rola UE rośnie.</p>");
    markFirstOccurrences(root, labels(["unia-europejska", "UE"]));
    const span = marks(root)[0];
    expect(span.dataset.glossaryTerm).toBe("unia-europejska");
    expect(span.className).toBe("glossary-term");
    expect(span.tabIndex).toBe(0);
  });

  it("pusty słownik nie dotyka DOM-u", () => {
    const root = article("<p>Rola UE rośnie.</p>");
    const before = root.innerHTML;
    expect(markFirstOccurrences(root, [])).toEqual([]);
    expect(root.innerHTML).toBe(before);
  });

  it("etykiety poniżej progu długości nie dotykają DOM-u", () => {
    const root = article("<p>A i B.</p>");
    const before = root.innerHTML;
    expect(markFirstOccurrences(root, labels(["a", "A"]))).toEqual([]);
    expect(root.innerHTML).toBe(before);
  });

  it("ta sama etykieta dla dwóch slugów: rozstrzyga OSTATNI wpis", () => {
    const root = article("<p>Rola UE rośnie.</p>");
    const marked = markFirstOccurrences(root, labels(["stary", "UE"], ["nowy", "UE"]));
    expect(marked).toEqual(["nowy"]);
    expect(marks(root)[0].dataset.glossaryTerm).toBe("nowy");
  });
});

describe("unmarkAll - runda mark -> unmark -> oryginał", () => {
  it("przywraca HTML I tekst BAJT W BAJT", () => {
    const html =
      "<p>Rola UE w regionie rośnie.</p><p>NATO potwierdza to stanowisko, a UE je rozwija.</p>";
    const root = article(html);
    const htmlBefore = root.innerHTML;
    const textBefore = root.textContent;

    const marked = markFirstOccurrences(root, labels(["ue", "UE"], ["nato", "NATO"]));
    expect(marked).toEqual(["ue", "nato"]);
    expect(root.innerHTML).not.toBe(htmlBefore);

    const removed = unmarkAll(root);
    expect(removed).toBe(2);
    expect(root.innerHTML).toBe(htmlBefore);
    expect(root.textContent).toBe(textBefore);
  });

  it("scala rozdzielone węzły tekstowe (bez normalize zostałyby trzy zamiast jednego)", () => {
    const root = article("<p>Rola UE rośnie.</p>");
    const p = root.querySelector("p")!;
    expect(p.childNodes).toHaveLength(1);

    markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(p.childNodes.length).toBeGreaterThan(1);

    unmarkAll(root);
    expect(p.childNodes).toHaveLength(1);
    expect(p.textContent).toBe("Rola UE rośnie.");
  });

  it("jest idempotentny: drugie wywołanie nie zmienia już nic", () => {
    const root = article("<p>Rola UE rośnie.</p>");
    markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(unmarkAll(root)).toBe(1);
    const after = root.innerHTML;
    expect(unmarkAll(root)).toBe(0);
    expect(root.innerHTML).toBe(after);
  });

  it("na korzeniu bez oznaczeń nie rzuca i zwraca zero", () => {
    const root = article("<p>Bez oznaczeń.</p>");
    const before = root.innerHTML;
    expect(unmarkAll(root)).toBe(0);
    expect(root.innerHTML).toBe(before);
  });

  it("runda przetrwa DWA cykle skanowania (zmiana języka artykułu)", () => {
    const root = article("<p>Rola UE rośnie, NATO potwierdza.</p>");
    const htmlBefore = root.innerHTML;

    markFirstOccurrences(root, labels(["ue", "UE"]));
    unmarkAll(root);
    expect(root.innerHTML).toBe(htmlBefore);

    markFirstOccurrences(root, labels(["nato", "NATO"]));
    unmarkAll(root);
    expect(root.innerHTML).toBe(htmlBefore);
  });
});

describe("markFirstOccurrences - na PRAWDZIWYM wyjściu sanitizera", () => {
  // Bez mocka `dompurify`: podświetlanie musi działać na tym, co sanitizer
  // faktycznie wypuszcza do DOM-u. Mock na tej granicy sprawiłby, że test
  // niczego nie dowodzi o bezpieczeństwie.
  it("oznacza termin w treści przepuszczonej przez sanitizeHtml", () => {
    const dirty = '<p onclick="steal()">Rola UE rośnie.<script>evil()</script></p>';
    const clean = sanitizeHtml(dirty);
    const root = article(clean);

    expect(root.querySelector("script")).toBeNull();
    const marked = markFirstOccurrences(root, labels(["ue", "UE"]));
    expect(marked).toEqual(["ue"]);
    expect(marks(root)[0].textContent).toBe("UE");
  });

  it("nie oznacza terminu w linku, który przeżył sanityzację", () => {
    const clean = sanitizeHtml('<p>Zobacz <a href="/glossary">UE</a>.</p>');
    const root = article(clean);

    expect(root.querySelector("a")).not.toBeNull();
    expect(markFirstOccurrences(root, labels(["ue", "UE"]))).toEqual([]);
    expect(root.querySelectorAll("a a")).toHaveLength(0);
  });

  it("runda mark -> unmark na wyjściu sanitizera wraca do oryginału", () => {
    const clean = sanitizeHtml("<p>Rola <strong>UE</strong> i NATO w regionie.</p>");
    const root = article(clean);
    const before = root.innerHTML;

    markFirstOccurrences(root, labels(["nato", "NATO"]));
    expect(marks(root)).toHaveLength(1);
    unmarkAll(root);
    expect(root.innerHTML).toBe(before);
  });
});
