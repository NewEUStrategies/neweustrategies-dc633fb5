import { describe, expect, it } from "vitest";
import { auditBuilderDoc, collectTextHtml } from "@/lib/builder/migrate/verifyMigration";
import type { BuilderDocument } from "@/lib/builder/types";

// `auditBuilderDoc` jest wyjściem skryptu `scripts/verify-migration.ts`, który
// czyta produkcyjne tabele i drukuje recenzentowi OSTRZEŻENIA. Recenzent nie
// czyta struktur audytu - czyta zdania. Sąsiedni `verifyMigration.test.ts`
// dowodzi wykrycia problemów w `auditHtml`; tu dowodzimy, że KAŻDA klasa
// problemu staje się zdaniem z językiem i identyfikatorami, że widgety
// w sekcjach wewnętrznych też są audytowane, a widgety inne niż `text`
// (i puste treści) nie generują szumu. Moduł czysty, bez atrap.

const text = (id: string, content: Record<string, unknown>) => ({
  id,
  kind: "widget",
  type: "text",
  content,
});

function doc(): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            span: { desktop: 12 },
            children: [
              text("w1", { html_pl: '<p style="color:red">Wstęp</p>', html_en: "" }),
              { id: "w2", kind: "widget", type: "image", content: { html_pl: "[fn]x[/fn]" } },
            ],
          },
          {
            id: "in1",
            kind: "inner-section",
            columns: [
              {
                id: "c2",
                kind: "column",
                span: { desktop: 6 },
                children: [
                  text("w3", {
                    html_en:
                      '<a data-fn="2">2</a><ol><li id="fn-1">a</li><li id="fn-3">b</li></ol>',
                  }),
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as BuilderDocument;
}

describe("auditBuilderDoc - ostrzeżenia dla recenzenta", () => {
  it("audytuje treści z kolumn i sekcji wewnętrznych, pomijając puste i inne widgety", () => {
    expect(collectTextHtml(doc())).toEqual([
      { lang: "pl", html: '<p style="color:red">Wstęp</p>' },
      {
        lang: "en",
        html: '<a data-fn="2">2</a><ol><li id="fn-1">a</li><li id="fn-3">b</li></ol>',
      },
    ]);
  });

  it("każda klasa problemu staje się zdaniem z językiem i identyfikatorami", () => {
    const audit = auditBuilderDoc(doc());
    expect(audit.htmlBodies).toBe(2);
    expect(audit.warnings).toEqual([
      '[pl] 1 inline style="" attribute(s) will be stripped at render (review formatting)',
      "[en] footnote ref(s) with no list entry: 2",
      "[en] orphan footnote note(s) nothing references: 1, 3",
    ]);
  });

  it("dokument bez sekcji nie ma czego audytować", () => {
    const audit = auditBuilderDoc({ version: 1 } as unknown as BuilderDocument);
    expect(audit).toEqual({ htmlBodies: 0, audits: [], warnings: [] });
  });
});
