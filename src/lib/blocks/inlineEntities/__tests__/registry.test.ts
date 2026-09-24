import { toJsonArray } from "@/lib/content-model/json";
import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/blocks/types";
import { INLINE_ENTITY_LIMITS } from "../model";
import {
  canAddInlineEntity,
  collectInlineEntityIds,
  collectInlineEntityIdsFromHtml,
  containsInlineEntityMarkup,
  countInlineEntityUsage,
  importInlineEntities,
  INLINE_ENTITY_META_KEY,
  inlineEntityTokenHtml,
  mirrorInlineEntities,
  readInlineEntities,
  referencedInlineEntities,
  removeInlineEntity,
  syncInlineEntityLabels,
  syncInlineEntityLabelsInHtml,
  upsertInlineEntity,
  withInlineEntities,
} from "../registry";
import { company, docWith, paragraph, person, token } from "./fixtures";

describe("token markup", () => {
  it("renders an escaped reference with id and kind", () => {
    expect(inlineEntityTokenHtml(company({ name: "A&B <Co>" }))).toBe(
      '<span data-nes-entity="ie_acme0001" data-nes-entity-kind="company">A&amp;B &lt;Co&gt;</span>',
    );
    expect(containsInlineEntityMarkup(token(person()))).toBe(true);
    expect(containsInlineEntityMarkup(42)).toBe(false);
  });
});

describe("registry read/write", () => {
  it("round-trips through doc.meta and preserves other meta keys", () => {
    const doc = withInlineEntities(
      { version: 1, blocks: [], meta: { migratedFrom: "wp" } },
      { [company().id]: company() },
    );
    expect(doc.meta?.migratedFrom).toBe("wp");
    expect(readInlineEntities(doc)).toEqual({ [company().id]: company() });
  });

  it("drops the key (and empty meta) when the registry is empty", () => {
    const doc = withInlineEntities(docWith([], [company()]), {});
    expect(doc.meta).toBeUndefined();
    const kept = withInlineEntities({ version: 1, blocks: [], meta: { a: 1 } }, {});
    expect(kept.meta).toEqual({ a: 1 });
    expect(readInlineEntities(null)).toEqual({});
  });
});

describe("usage scanning", () => {
  const nested: Block = {
    id: "cols",
    type: "columns",
    data: {
      left: toJsonArray([paragraph("p2", `x ${token(company())} y ${token(company())}`)]),
      right: toJsonArray([{ id: "l1", type: "list", data: { items: [`• ${token(person())}`] } }]),
    },
  };
  const blocks = [paragraph("p1", `Hello ${token(person())}`), nested];

  it("counts references in nested blocks and list items", () => {
    const counts = countInlineEntityUsage(blocks);
    expect(counts.get("ie_acme0001")).toBe(2);
    expect(counts.get("ie_maya0001")).toBe(2);
    expect([...collectInlineEntityIds(blocks)].sort()).toEqual(["ie_acme0001", "ie_maya0001"]);
  });

  it("reads ids from raw clipboard html", () => {
    expect(collectInlineEntityIdsFromHtml(`${token(company())}${token(company())}`)).toEqual([
      "ie_acme0001",
    ]);
    expect(collectInlineEntityIdsFromHtml("<p>plain</p>")).toEqual([]);
  });

  it("returns only referenced registry records", () => {
    const orphan = company({ id: "ie_orphan01", name: "Orphan" });
    const doc = docWith([paragraph("p1", token(company()))], [company(), orphan]);
    expect(referencedInlineEntities(doc.blocks, readInlineEntities(doc)).map((e) => e.id)).toEqual([
      "ie_acme0001",
    ]);
    expect(referencedInlineEntities([], {})).toEqual([]);
  });
});

describe("label sync", () => {
  it("rewrites stale fallback text and escapes it", () => {
    const html = `A <span data-nes-entity="ie_acme0001" data-nes-entity-kind="company">Old</span> B`;
    const next = syncInlineEntityLabelsInHtml(html, { ie_acme0001: company({ name: "New & Co" }) });
    expect(next).toBe(
      `A <span data-nes-entity="ie_acme0001" data-nes-entity-kind="company">New &amp; Co</span> B`,
    );
  });

  it("leaves unknown references and unchanged docs as the same objects", () => {
    const doc = docWith([paragraph("p1", token(company()))], [company()]);
    expect(syncInlineEntityLabels(doc, readInlineEntities(doc))).toBe(doc);
    expect(syncInlineEntityLabelsInHtml("<p>x</p>", {})).toBe("<p>x</p>");
    const unknown = `<span data-nes-entity="ie_nope0001">Kept</span>`;
    expect(syncInlineEntityLabelsInHtml(unknown, { ie_acme0001: company() })).toBe(unknown);
  });

  it("upsert updates every occurrence at once", () => {
    const doc = docWith(
      [paragraph("p1", token(company())), paragraph("p2", `see ${token(company())}`)],
      [company()],
    );
    const next = upsertInlineEntity(doc, company({ name: "Acme Storage" }));
    expect(readInlineEntities(next).ie_acme0001).toMatchObject({ name: "Acme Storage" });
    expect(String(next.blocks[0].data.html)).toContain(">Acme Storage</span>");
    expect(String(next.blocks[1].data.html)).toContain(">Acme Storage</span>");
  });
});

describe("label sync in nested content", () => {
  it("reaches list items and blocks nested in columns, leaving other values intact", () => {
    const doc = docWith(
      [
        {
          id: "l1",
          type: "list",
          data: { items: [`a ${token(company())}`, "plain"], ordered: false },
        },
        {
          id: "c1",
          type: "columns",
          data: {
            ratio: 50,
            left: toJsonArray([paragraph("p2", token(company()))]),
            right: toJsonArray([paragraph("p3", "no entity")]),
          },
        },
      ],
      [company()],
    );
    const next = upsertInlineEntity(doc, company({ name: "Nowa nazwa" }));
    expect(next.blocks[0].data.items).toEqual([
      `a ${token(company({ name: "Nowa nazwa" }))}`,
      "plain",
    ]);
    const left = next.blocks[1].data.left as Array<{ data: { html: string } }>;
    expect(left[0].data.html).toContain(">Nowa nazwa</span>");
    expect(next.blocks[1].data.right).toBe(doc.blocks[1].data.right);
    expect(next.blocks[1].data.ratio).toBe(50);
  });
});

describe("import / remove", () => {
  it("imports only unknown records", () => {
    const doc = docWith([], [company()]);
    const next = importInlineEntities(doc, [company({ name: "Other" }), person()]);
    expect(readInlineEntities(next).ie_acme0001.kind === "company").toBe(true);
    expect(readInlineEntities(next).ie_acme0001).toMatchObject({ name: "Acme Energy" });
    expect(readInlineEntities(next).ie_maya0001).toBeDefined();
    expect(importInlineEntities(next, [person()])).toBe(next);
  });

  it("removes records and is a no-op for unknown ids", () => {
    const doc = docWith([], [company(), person()]);
    const next = removeInlineEntity(doc, "ie_acme0001");
    expect(Object.keys(readInlineEntities(next))).toEqual(["ie_maya0001"]);
    expect(removeInlineEntity(next, "ie_acme0001")).toBe(next);
  });
});

describe("mirrorInlineEntities", () => {
  it("copies the active registry and label changes into the other language", () => {
    const active = docWith(
      [paragraph("p1", token(company({ name: "Acme PL" })))],
      [company({ name: "Acme PL" })],
    );
    const other = docWith([paragraph("e1", token(company()))], [company()]);
    const mirrored = mirrorInlineEntities(active, other);
    expect(readInlineEntities(mirrored).ie_acme0001).toMatchObject({ name: "Acme PL" });
    expect(String(mirrored.blocks[0].data.html)).toContain(">Acme PL</span>");
  });

  it("keeps records the other language still references", () => {
    const active = docWith([], [company()]);
    const other = docWith([paragraph("e1", token(person()))], [person()]);
    const mirrored = mirrorInlineEntities(active, other);
    expect(Object.keys(readInlineEntities(mirrored)).sort()).toEqual([
      "ie_acme0001",
      "ie_maya0001",
    ]);
  });

  it("drops records deleted in the active language and unused in the other", () => {
    const active = docWith([], []);
    const other = docWith([], [person()]);
    const mirrored = mirrorInlineEntities(active, other);
    expect(mirrored.meta?.[INLINE_ENTITY_META_KEY]).toBeUndefined();
  });

  it("returns the same object when nothing changes", () => {
    const active = docWith([], [company()]);
    const other = docWith([], [company()]);
    expect(mirrorInlineEntities(active, other)).toBe(other);
    const empty = { version: 1 as const, blocks: [] };
    expect(mirrorInlineEntities(empty, empty)).toBe(empty);
  });
});

describe("per-document cap", () => {
  const full = () =>
    docWith(
      [],
      Array.from({ length: INLINE_ENTITY_LIMITS.perDocument }, (_, i) =>
        company({ id: `ie_cap${String(i).padStart(5, "0")}` }),
      ),
    );

  it("refuses a new record over the cap but still updates existing ones", () => {
    const doc = full();
    expect(canAddInlineEntity(readInlineEntities(doc))).toBe(false);
    expect(upsertInlineEntity(doc, person())).toBe(doc);
    const updated = upsertInlineEntity(doc, company({ id: "ie_cap00000", name: "Zmieniona" }));
    expect(readInlineEntities(updated).ie_cap00000).toMatchObject({ name: "Zmieniona" });
    expect(canAddInlineEntity(readInlineEntities(doc), "ie_cap00000")).toBe(true);
  });

  it("imports only up to the cap", () => {
    const almost = removeInlineEntity(full(), "ie_cap00000");
    const next = importInlineEntities(almost, [person(), person({ id: "ie_extra001" })]);
    expect(Object.keys(readInlineEntities(next))).toHaveLength(INLINE_ENTITY_LIMITS.perDocument);
    expect(readInlineEntities(next).ie_maya0001).toBeDefined();
    expect(readInlineEntities(next).ie_extra001).toBeUndefined();
  });
});
