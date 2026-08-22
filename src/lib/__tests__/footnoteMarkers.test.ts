// Dwa warianty markera przypisu i granica między nimi.
//
// Treść dokumentu ma sekcję końcową, więc jej marker jest KOTWICZONY
// (href/id/data-fn wiążą go z listą i tooltipem). Globalny widget sekcji końcowej
// NIE ma - jest reużywalny między stronami, więc numeruje się per-widget. Gdyby
// jego marker też kotwiczył, na stronie z własnym przypisem nr 1 powstałby
// zduplikowany `id="fnref-1"` (niepoprawny HTML), `href="#fn-1"` skakałby do
// CUDZEGO przypisu, a `data-fn="1"` kazałby `<FootnoteTooltips>` pokazać treść
// cudzej noty.
import { describe, it, expect } from "vitest";
import {
  expandFootnotes,
  processWidgetFootnotes,
  createCounter,
  processDocFootnotes,
} from "@/lib/footnotes";
import type { BuilderDocument, WidgetNode } from "@/lib/builder/types";

const textWidget = (html: string): WidgetNode =>
  ({ id: "w1", kind: "widget", type: "text", content: { html_pl: html } }) as unknown as WidgetNode;

const html_pl = (w: WidgetNode): string =>
  String((w.content as unknown as { html_pl: string }).html_pl);

describe("marker kotwiczony (treść dokumentu)", () => {
  it("niesie href/id/data-fn oraz role=doc-noteref", () => {
    const out = expandFootnotes("A[fn] nota [/fn]", createCounter(1));
    expect(out).toContain('href="#fn-1"');
    expect(out).toContain('id="fnref-1"');
    expect(out).toContain('data-fn="1"');
    expect(out).toContain('role="doc-noteref"');
    // Treść pokazuje wyłącznie wspólny tooltip aplikacji - bez drugiego,
    // natywnego dymka generowanego przez atrybut `title`.
    expect(out).not.toContain("title=");
  });

  it("widgety w dokumencie buildera są kotwiczone (domyślnie)", () => {
    const doc = {
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [{ id: "c1", kind: "column", children: [textWidget("A[fn] nota [/fn]")] }],
        },
      ],
    } as unknown as BuilderDocument;

    const { doc: prepared, notes } = processDocFootnotes(doc, "pl");
    const w = (prepared.sections[0] as unknown as { children: [{ children: WidgetNode[] }] })
      .children[0].children[0];

    expect(html_pl(w)).toContain('data-fn="1"');
    expect(notes).toEqual([{ id: 1, html: "nota" }]);
  });
});

describe("marker samodzielny (globalny widget)", () => {
  it("NIE niesie href/id/data-fn, ale zachowuje treść w title", () => {
    const { widget, notes } = processWidgetFootnotes(textWidget("G[fn] nota globalna [/fn]"), "pl");
    const out = html_pl(widget);

    // Sedno poprawki: żadnego kotwiczenia, więc żadnej kolizji z dokumentem.
    expect(out).not.toContain("href=");
    expect(out).not.toContain("id=");
    expect(out).not.toContain("data-fn=");
    // Treść nadal dostępna dla czytelnika (natywny tooltip przeglądarki).
    expect(out).toContain('title="nota globalna"');
    expect(out).toContain('role="note"');
    expect(out).toContain("[1]");
    expect(notes).toEqual([{ id: 1, html: "nota globalna" }]);
  });

  it("nie tworzy id, które mogłoby zderzyć się z markerem dokumentu", () => {
    // Ta sama numeracja (oba startują od 1), więc gdyby marker globalny kotwiczył,
    // oba wyprodukowałyby `id="fnref-1"` w jednym drzewie DOM.
    const docMarker = expandFootnotes("A[fn] nota dokumentu [/fn]", createCounter(1));
    const globalMarker = html_pl(
      processWidgetFootnotes(textWidget("G[fn] nota globalna [/fn]"), "pl").widget,
    );

    const ids = (s: string) => [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(docMarker)).toEqual(["fnref-1"]);
    expect(ids(globalMarker)).toEqual([]);
  });

  it("można wymusić kotwiczenie jawnie, gdy wywołujący ma sekcję końcową", () => {
    const { widget } = processWidgetFootnotes(
      textWidget("A[fn] nota [/fn]"),
      "pl",
      createCounter(1),
      {
        anchored: true,
      },
    );
    expect(html_pl(widget)).toContain('data-fn="1"');
  });
});

describe("wspólne reguły obu wariantów", () => {
  it("puste [fn][/fn] jest pomijane bez zużycia numeru", () => {
    const col = createCounter(1);
    const out = expandFootnotes("A[fn][/fn]B[fn]  [/fn]C[fn] realny [/fn]", col);
    expect(out).toContain("[1]");
    expect(out).not.toContain("[2]");
    expect(col.notes).toEqual([{ id: 1, html: "realny" }]);

    const standalone = html_pl(
      processWidgetFootnotes(textWidget("A[fn][/fn]B[fn] realny [/fn]"), "pl").widget,
    );
    expect(standalone).toContain("[1]");
    expect(standalone).not.toContain("[2]");
  });

  it("title jest dostępny tylko w wariancie samodzielnym i jest bezpieczny", () => {
    const anchored = expandFootnotes('A[fn]<b>x</b> & "y"[/fn]', createCounter(1));
    const standalone = html_pl(
      processWidgetFootnotes(textWidget('A[fn]<b>x</b> & "y"[/fn]'), "pl").widget,
    );
    expect(anchored).not.toContain("title=");
    expect(standalone).toContain('title="x &amp; &quot;y&quot;"');
  });
});
