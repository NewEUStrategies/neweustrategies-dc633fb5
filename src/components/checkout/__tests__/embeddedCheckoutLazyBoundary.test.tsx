// Kontrakt LENIWEJ granicy checkoutu - to jest sedno naprawy z 2026-08-06.
//
// Testujemy dokładnie te dwie własności, których utrata przywraca regresję
// „anonimowy czytelnik pobiera SDK bramki płatniczej":
//   1. GRAF STATYCZNY: żaden moduł poza `StripeEmbeddedFrame` nie importuje
//      `@stripe/*` statycznie, a sam `StripeEmbeddedFrame` jest osiągalny
//      wyłącznie przez `import()`. Sprawdzamy to na ŹRÓDLE, bo to jedyna
//      warstwa, w której da się to udowodnić bez builda (w CI dokłada się
//      `scripts/check-entry-purity.ts` na gotowych chunkach).
//   2. ZACHOWANIE: dopóki `clientSecret` nie istnieje, modal nie montuje ramki
//      w ogóle - więc nie ma czego pobierać.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { EmbeddedCheckoutDialog } from "../EmbeddedCheckoutDialog";
import { ThemeProvider } from "@/components/ThemeProvider";
import { stripTsComments } from "../../../../scripts/lib/stripTsComments";

const SRC_DIR = "src";
const FRAME_MODULE = "src/components/checkout/StripeEmbeddedFrame.tsx";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Statyczny `import ... from "x"` - z pominięciem `import type` i `import("x")`.
 * Komentarze ścinamy pierwsze: nagłówki tych właśnie modułów CYTUJĄ zakazany
 * import jako opis regresji, więc surowe źródło dawałoby fałszywe trafienia.
 */
function staticImportsOf(rawSource: string): string[] {
  const source = stripTsComments(rawSource);
  const out: string[] = [];
  const re = /import\s+(?!type\s)(?:[\s\S]*?from\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) out.push(match[1]);
  return out;
}

const files = walk(SRC_DIR);

/**
 * Skan drzewa `src` wykonujemy RAZ i trzymamy w pamięci: dwa niezależne
 * przejścia po ~tysiącu plików potrafiły przekroczyć domyślny timeout, gdy
 * pełny przebieg CI rywalizuje o I/O między workerami (stąd „przechodzi solo,
 * pada w pakiecie"). Jedno przejście = deterministyczny koszt.
 */
const importGraph = new Map<string, string[]>(
  files.map((file) => [file, staticImportsOf(readFileSync(file, "utf8"))]),
);

function importersMatching(predicate: (spec: string) => boolean): string[] {
  return [...importGraph.entries()]
    .filter(([file]) => file !== FRAME_MODULE)
    .filter(([, specs]) => specs.some(predicate))
    .map(([file]) => file);
}

describe("granica leniwego ładowania SDK płatności", () => {
  it("tylko StripeEmbeddedFrame importuje @stripe/* statycznie", { timeout: 60_000 }, () => {
    const offenders = importersMatching((spec) => spec.startsWith("@stripe/"));
    expect(
      offenders,
      "Statyczny import @stripe/* poza StripeEmbeddedFrame wraca do wspólnego przodka " +
        "chunków (entry) - patrz nagłówek EmbeddedCheckoutFrame.tsx",
    ).toEqual([]);
  });

  it("StripeEmbeddedFrame jest osiągalny wyłącznie przez import dynamiczny", { timeout: 60_000 }, () => {
    const importers = importersMatching((spec) =>
      spec.endsWith("checkout/StripeEmbeddedFrame"),
    );
    expect(importers, "Pośredniość istnieje po to, by ten moduł wchodził tylko przez lazy").toEqual(
      [],
    );
  });

  it("lib/stripe.ts ładuje loadStripe dynamicznie", () => {
    const source = readFileSync("src/lib/stripe.ts", "utf8");
    expect(source).toContain('import("@stripe/stripe-js")');
    expect(staticImportsOf(source).filter((s) => s.startsWith("@stripe/"))).toEqual([]);
  });
});

describe("EmbeddedCheckoutDialog", () => {
  it("bez clientSecret nie montuje ramki ani nie otwiera modala", () => {
    const { container } = render(
      <ThemeProvider>
        <EmbeddedCheckoutDialog clientSecret={null} onOpenChange={() => {}} />
      </ThemeProvider>,
    );
    expect(container.querySelector("[data-testid='checkout-frame-skeleton']")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("z clientSecret pokazuje placeholder ramki, zanim chunk SDK się pobierze", () => {
    render(
      <ThemeProvider>
        <EmbeddedCheckoutDialog clientSecret="cs_test_123" onOpenChange={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("checkout-frame-skeleton")).toBeInTheDocument();
  });
});
