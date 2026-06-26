import { describe, it, expect } from "vitest";
import { auditHtml, collectTextHtml, auditBuilderDoc } from "./verifyMigration";
import { htmlToBuilderDoc } from "./htmlToBuilder";
import type { BuilderDocument } from "../types";

describe("auditHtml", () => {
  it("reports clean footnote parity with no warnings-worthy issues", () => {
    const html =
      'Body <sup class="fn-ref"><a data-fn="1" href="#fn-1">[1]</a></sup>' +
      '<ol data-footnotes-list><li id="fn-1"><span data-fn-marker>[1]</span> <span>note</span></li></ol>';
    const a = auditHtml(html, "pl");
    expect(a.refIds).toEqual([1]);
    expect(a.listIds).toEqual([1]);
    expect(a.refsWithoutList).toEqual([]);
    expect(a.listWithoutRefs).toEqual([]);
    expect(a.leftoverFnMarkers).toBe(0);
    expect(a.inlineStyleAttrs).toBe(0);
    expect(a.empty).toBe(false);
  });

  it("flags dangling refs, orphan notes, leftover [fn] and inline styles", () => {
    const html =
      '<p style="color:red">x</p>' +
      '<a data-fn="1">[1]</a><a data-fn="2">[2]</a>' +
      '<ol data-footnotes-list><li id="fn-2"><span>two</span></li><li id="fn-9"><span>nine</span></li></ol>' +
      "leftover [fn]still here[/fn]";
    const a = auditHtml(html, "en");
    expect(a.refsWithoutList).toEqual([1]); // ref 1 has no list entry
    expect(a.listWithoutRefs).toEqual([9]); // note 9 referenced by nothing
    expect(a.leftoverFnMarkers).toBe(1);
    expect(a.inlineStyleAttrs).toBe(1);
  });

  it("marks blank html as empty", () => {
    expect(auditHtml("   \n ", "pl").empty).toBe(true);
  });
});

describe("collectTextHtml", () => {
  it("collects per-language bodies from every text widget", () => {
    const doc = htmlToBuilderDoc("<p>PL</p>", "<p>EN</p>");
    const bodies = collectTextHtml(doc);
    expect(bodies.map((b) => b.lang).sort()).toEqual(["en", "pl"]);
  });
});

describe("auditBuilderDoc", () => {
  it("passes a doc produced by the real migration helper (footnotes baked in parity)", () => {
    const doc = htmlToBuilderDoc("Intro [fn]a source[/fn] and more.", null);
    const audit = auditBuilderDoc(doc);
    expect(audit.htmlBodies).toBe(1);
    expect(audit.warnings).toEqual([]);
  });

  it("surfaces warnings for a hand-broken builder doc", () => {
    const doc: BuilderDocument = {
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
                {
                  id: "w1",
                  kind: "widget",
                  type: "text",
                  content: { html_pl: '<a data-fn="1">[1]</a> tail [fn]oops[/fn]' },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as BuilderDocument;
    const audit = auditBuilderDoc(doc);
    expect(audit.warnings.some((w) => w.includes("[fn]"))).toBe(true);
    expect(audit.warnings.some((w) => w.includes("no list entry"))).toBe(true);
  });
});
