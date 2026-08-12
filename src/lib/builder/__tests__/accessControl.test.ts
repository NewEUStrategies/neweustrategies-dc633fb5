// Kontrakt bramek dostępu buildera (`advanced.access`).
//
// Ten moduł decyduje, KTO widzi węzeł drzewa buildera - i od momentu, w którym
// publiczny loader stripuje drzewo po stronie serwera (lib/queries/public.ts),
// decyduje też, co w ogóle WYCHODZI z serwera. Dwie własności są tu krytyczne
// i nie były dotąd pokryte żadnym testem:
//
//   1. reguła, której ten build nie umie przeczytać (wartość spoza unii -
//      nowszy zapis, migracja, ręcznie edytowany jsonb), rozstrzyga się na
//      UKRYTE. Domyślne "otwarte" publikowałoby dokładnie tę treść, którą ktoś
//      próbował zabramkować;
//   2. usunięcie węzła zabiera całe jego poddrzewo i nie mutuje wejścia
//      (to samo drzewo trafia do cache'u SSR i do CDN-a).
import { describe, expect, it } from "vitest";
import {
  GUEST_ACCESS_CONTEXT,
  evaluateAccess,
  stripInaccessibleNodes,
  type AccessContext,
} from "@/lib/builder/accessControl";
import type { AccessControlSettings } from "@/lib/builder/types";

const guest: AccessContext = GUEST_ACCESS_CONTEXT;
const plainUser: AccessContext = { isAuthenticated: true, roles: [] };
const editor: AccessContext = { isAuthenticated: true, roles: ["editor"] };
const adminEditor: AccessContext = { isAuthenticated: true, roles: ["admin", "editor"] };

/** Reguła spoza unii - jak wartość wczytana z jsonb, nie z panelu. */
const unknownRule = (rule: Record<string, unknown>): AccessControlSettings =>
  rule as AccessControlSettings;

describe("evaluateAccess - brak bramki", () => {
  it("brak reguły i reguła pusta są widoczne dla wszystkich", () => {
    for (const ctx of [guest, plainUser, editor]) {
      expect(evaluateAccess(undefined, ctx)).toBe(true);
      expect(evaluateAccess({}, ctx)).toBe(true);
      expect(evaluateAccess({ auth: "any" }, ctx)).toBe(true);
      expect(evaluateAccess({ roles: [] }, ctx)).toBe(true);
    }
  });
});

describe("evaluateAccess - bramka po zalogowaniu", () => {
  it('auth "guest" przepuszcza wyłącznie niezalogowanych', () => {
    expect(evaluateAccess({ auth: "guest" }, guest)).toBe(true);
    expect(evaluateAccess({ auth: "guest" }, plainUser)).toBe(false);
    expect(evaluateAccess({ auth: "guest" }, adminEditor)).toBe(false);
  });

  it('auth "user" przepuszcza wyłącznie zalogowanych', () => {
    expect(evaluateAccess({ auth: "user" }, guest)).toBe(false);
    expect(evaluateAccess({ auth: "user" }, plainUser)).toBe(true);
  });
});

describe("evaluateAccess - bramka po rolach", () => {
  it("role nie obowiązują gościa - gość nie ma żadnej roli", () => {
    expect(evaluateAccess({ roles: ["editor"] }, guest)).toBe(false);
    expect(evaluateAccess({ roles: ["admin", "editor"] }, guest)).toBe(false);
  });

  it('domyślny tryb "any" wymaga jednej z wymienionych ról', () => {
    expect(evaluateAccess({ roles: ["admin", "editor"] }, editor)).toBe(true);
    expect(evaluateAccess({ roles: ["admin"] }, editor)).toBe(false);
    expect(evaluateAccess({ roles: ["editor"] }, plainUser)).toBe(false);
  });

  it('tryb "all" wymaga wszystkich wymienionych ról', () => {
    const rule: AccessControlSettings = { roles: ["admin", "editor"], rolesMode: "all" };
    expect(evaluateAccess(rule, adminEditor)).toBe(true);
    expect(evaluateAccess(rule, editor)).toBe(false);
  });

  it("bramka po zalogowaniu i bramka po rolach muszą przejść obie", () => {
    const rule: AccessControlSettings = { auth: "user", roles: ["editor"] };
    expect(evaluateAccess(rule, editor)).toBe(true);
    expect(evaluateAccess(rule, plainUser)).toBe(false);
    expect(evaluateAccess(rule, guest)).toBe(false);
  });
});

describe("evaluateAccess - reguła nieczytelna jest ZAMKNIĘTA", () => {
  it("nieznany tryb auth ukrywa węzeł przed każdym, także adminem", () => {
    const rule = unknownRule({ auth: "members" });
    expect(evaluateAccess(rule, guest)).toBe(false);
    expect(evaluateAccess(rule, plainUser)).toBe(false);
    expect(evaluateAccess(rule, adminEditor)).toBe(false);
  });

  it("nieznany tryb rolesMode ukrywa węzeł, choć rola by pasowała", () => {
    expect(evaluateAccess(unknownRule({ roles: ["editor"], rolesMode: "some" }), editor)).toBe(
      false,
    );
  });

  it("uszkodzone roles (nie tablica) ukrywają węzeł zamiast rzucać", () => {
    expect(evaluateAccess(unknownRule({ roles: "editor" }), editor)).toBe(false);
    expect(evaluateAccess(unknownRule({ roles: {} }), adminEditor)).toBe(false);
  });

  it("nieznana rola nie pasuje do niczego", () => {
    expect(evaluateAccess(unknownRule({ roles: ["moderator"] }), adminEditor)).toBe(false);
  });
});

/** Minimalny dokument: sekcja -> kolumna -> dwa widgety, drugi zabramkowany. */
const docWithGatedWidget = (rule: unknown) => ({
  version: 1,
  sections: [
    {
      id: "s1",
      kind: "section",
      children: [
        {
          id: "c1",
          kind: "column",
          children: [
            { id: "w-public", kind: "widget", type: "text", content: { text: "jawne" } },
            {
              id: "w-gated",
              kind: "widget",
              type: "text",
              content: { text: "SEKRET" },
              advanced: { access: rule },
            },
          ],
        },
      ],
    },
  ],
});

describe("stripInaccessibleNodes", () => {
  it("usuwa węzeł niedostępny dla kontekstu i zostawia pozostałe", () => {
    const stripped = stripInaccessibleNodes(docWithGatedWidget({ auth: "user" }), guest);
    expect(JSON.stringify(stripped)).not.toContain("SEKRET");
    expect(JSON.stringify(stripped)).toContain("jawne");
  });

  it("zostawia węzeł, gdy kontekst spełnia regułę", () => {
    const doc = docWithGatedWidget({ roles: ["editor"] });
    expect(JSON.stringify(stripInaccessibleNodes(doc, editor))).toContain("SEKRET");
    expect(JSON.stringify(stripInaccessibleNodes(doc, guest))).not.toContain("SEKRET");
  });

  it("reguła nieczytelna usuwa węzeł także dla admina (fail-closed)", () => {
    const doc = docWithGatedWidget({ auth: "subscribers" });
    expect(JSON.stringify(stripInaccessibleNodes(doc, adminEditor))).not.toContain("SEKRET");
  });

  it("usunięcie sekcji zabiera całe poddrzewo", () => {
    const doc = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          advanced: { access: { auth: "user" } },
          children: [
            { id: "c1", kind: "column", children: [{ id: "w1", content: { text: "SEKRET" } }] },
          ],
        },
        { id: "s2", kind: "section", children: [] },
      ],
    };
    const stripped = stripInaccessibleNodes(doc, guest) as { sections: Array<{ id: string }> };
    expect(stripped.sections.map((s) => s.id)).toEqual(["s2"]);
    expect(JSON.stringify(stripped)).not.toContain("SEKRET");
  });

  it("stripuje też kolumny wewnątrz inner-section (poziom pomijany przez renderer)", () => {
    const doc = {
      version: 1,
      sections: [
        {
          id: "s1",
          kind: "section",
          children: [
            {
              id: "i1",
              kind: "inner-section",
              columns: [
                {
                  id: "ic1",
                  kind: "column",
                  advanced: { access: { roles: ["admin"] } },
                  children: [{ id: "w1", content: { text: "SEKRET" } }],
                },
                { id: "ic2", kind: "column", children: [] },
              ],
            },
          ],
        },
      ],
    };
    expect(JSON.stringify(stripInaccessibleNodes(doc, guest))).not.toContain("SEKRET");
    expect(JSON.stringify(stripInaccessibleNodes(doc, adminEditor))).toContain("SEKRET");
  });

  it("nie mutuje wejścia", () => {
    const doc = docWithGatedWidget({ auth: "user" });
    stripInaccessibleNodes(doc, guest);
    expect(JSON.stringify(doc)).toContain("SEKRET");
  });

  it("dokument bez bramek wraca tą samą referencją (brak klonowania)", () => {
    const doc = docWithGatedWidget(undefined);
    expect(stripInaccessibleNodes(doc, guest)).toBe(doc);
  });

  it("toleruje wartości, które nie są dokumentem", () => {
    expect(stripInaccessibleNodes(null, guest)).toBeNull();
    expect(stripInaccessibleNodes(undefined, guest)).toBeUndefined();
    expect(stripInaccessibleNodes("nonsens", guest)).toBe("nonsens");
    expect(stripInaccessibleNodes({ version: 1 }, guest)).toEqual({ version: 1 });
  });
});
