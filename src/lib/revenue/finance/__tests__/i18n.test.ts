// Etykiety finansów huba (S2): parytet PL/EN nakładki i pokrycie KAŻDEJ
// wartości słownikowej DTO etykietą - surowy klucz `churn.reason.fraud`
// na karcie zostawia admina bez odpowiedzi, co się stało.
import { describe, expect, it } from "vitest";

import { ADMIN_REVENUE_FINANCE_I18N } from "@/lib/i18n-admin-revenue-finance";
import {
  CHURN_REASONS,
  OFFER_PLAN_ISSUES,
  OFFER_TIER_ISSUES,
  REALIZED_CATEGORIES,
  REVENUE_INPUT_INVALID_CODES,
  REVENUE_INPUT_KINDS,
} from "@/lib/revenue/finance/dto";
import { MRR_MOVEMENT_KINDS, MRR_MOVEMENT_REASONS } from "@/lib/revenue/limits";

type Tree = { [key: string]: string | Tree };

function flat(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flat(v, key)) out.set(kk, vv);
  }
  return out;
}

const pl = flat(ADMIN_REVENUE_FINANCE_I18N.pl as unknown as Tree);
const en = flat(ADMIN_REVENUE_FINANCE_I18N.en as unknown as Tree);
const F = "adminRevenue.finance";

describe("nakładka finansów: parytet PL/EN", () => {
  it("te same klucze w obu językach", () => {
    expect([...en.keys()].sort()).toEqual([...pl.keys()].sort());
  });

  it("żaden napis nie jest pusty, a napisy z treścią są przetłumaczone", () => {
    for (const [key, value] of pl) {
      expect(value.trim(), key).not.toBe("");
      const other = en.get(key)!;
      if (/\p{L}{4,}/u.test(value)) expect(other, key).not.toBe(value);
    }
  });

  it("te same zmienne interpolacji w PL i EN", () => {
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [key, value] of pl) expect(vars(en.get(key)!), key).toEqual(vars(value));
  });
});

describe("pokrycie słowników DTO etykietami", () => {
  it.each([
    ["movementKind", [...MRR_MOVEMENT_KINDS, "opening"]],
    ["movementReason", MRR_MOVEMENT_REASONS],
    ["churn.reason", CHURN_REASONS],
    ["realized.category", REALIZED_CATEGORIES],
    ["offer.planIssue", OFFER_PLAN_ISSUES],
    ["offer.tierIssue", OFFER_TIER_ISSUES],
    ["inputs.kind", REVENUE_INPUT_KINDS],
    ["inputs.invalid", REVENUE_INPUT_INVALID_CODES],
  ] as const)("%s", (group, values) => {
    for (const value of values) {
      expect(pl.has(`${F}.${group}.${value}`), `${group}.${value}`).toBe(true);
    }
  });
});

describe("arkusz publiczny", () => {
  // Pliki `src/lib/i18n-*.ts` skanuje generator CSS czytelnika: słowo będące
  // klasą narzędziową dokłada regułę do każdej strony.
  const UTILITIES = new Set([
    "block",
    "inline",
    "flex",
    "grid",
    "table",
    "contents",
    "hidden",
    "visible",
    "invisible",
    "collapse",
    "static",
    "fixed",
    "absolute",
    "relative",
    "sticky",
    "grow",
    "shrink",
    "truncate",
    "italic",
    "underline",
    "overline",
    "uppercase",
    "lowercase",
    "capitalize",
    "border",
    "rounded",
    "shadow",
    "ring",
    "outline",
    "blur",
    "invert",
    "sepia",
    "grayscale",
    "filter",
    "transform",
    "transition",
    "container",
    "isolate",
    "resize",
    "group",
    "peer",
    "ordinal",
    "antialiased",
  ]);

  it("żaden napis nie zawiera samodzielnej nazwy klasy narzędziowej", () => {
    for (const [key, value] of [...pl, ...en]) {
      for (const word of value.split(/[^A-Za-z-]+/)) {
        expect(UTILITIES.has(word), `${key}: ${word}`).toBe(false);
      }
    }
  });
});
