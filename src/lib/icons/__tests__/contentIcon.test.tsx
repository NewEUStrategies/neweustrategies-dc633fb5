// @vitest-environment node
//
// `contentIcon` - rozdzielczość nazwy ikony z treści CMS (osiem miejsc
// publicznego renderu) NA SERWERZE: środowisko `node`, bez `document`, więc
// `DynamicIcon` idzie prawdziwą drogą serwerową (porcja danych katalogu).
//
// CO TEN PLIK DOWODZI:
//  1. KAŻDA nazwa, którą wybierak ikon (`LucideIconPicker`) może zapisać,
//     rysuje na serwerze TEN SAM glif co komponent `lucide-react` tej nazwy -
//     nie zastępnik miejsca i nie znak zapytania (także `grid-2x2` i pięć
//     pokrewnych, które klucz PascalCase gubił);
//  2. kolejność: eksport shimu -> zestaw kuratorowany -> katalog -> zastępnik,
//     z nazwami brzegowymi;
//  3. klucze prototypu nie są ikoną także wtedy, gdy przestrzeń nazw shimu
//     jest zwykłym obiektem - jak w artefakcie Rolldowna (`__export` tworzy
//     `{}` z prototypem `Object`), czego vitest sam nie odtwarza.
import { Suspense, type ComponentType, type ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup, renderToString } from "react-dom/server";
import * as Lucide from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import catalogIconNames from "@/lib/icons/iconNames.generated.json";

// Przestrzeń nazw shimu jako ZWYKŁY obiekt (prototyp `Object`), jak w buildzie.
vi.mock("@/lib/lucide-shim", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.assign({}, actual);
});

const ShimNamespace = (await import("@/lib/lucide-shim")) as unknown as Record<string, unknown>;
const { contentIcon } = await import("../contentIcon");

type IconComponent = ComponentType<Lucide.LucideProps>;

const CATALOG = catalogIconNames as string[];

/** Zastępnik miejsca rozpoznawalny w HTML-u. */
function Fallback(props: Lucide.LucideProps): ReactElement {
  return <Lucide.Star {...props} data-zastepnik="" />;
}

async function serverHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

/** `toPascalCase` z lucide (`arrow-down-0-1` -> `ArrowDown01`, `grid-2x2` -> `Grid2x2`). */
function lucideExportName(name: string): string {
  const camel = name.replace(/^([A-Z])|[\s-_]+(\w)/g, (_match, first: string, next: string) =>
    next ? next.toUpperCase() : first.toLowerCase(),
  );
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Dzieci `<svg>` (sam rysunek, bez atrybutów i klas korzenia). */
function glyph(html: string): string {
  const match = /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(html);
  return match ? match[1] : "";
}

describe("contentIcon - nazwy z wybieraka ikon na serwerze", () => {
  it("każda nazwa katalogu rysuje glif komponentu lucide-react tej nazwy", async () => {
    expect(CATALOG.length).toBeGreaterThan(1000);
    const lucide = Lucide as unknown as Record<string, IconComponent | undefined>;
    const wrong: string[] = [];
    // Jeden render na całą listę (porcje katalogu ładują się raz). Render
    // strumieniowy czeka na porcje, ale przy ~1600 granicach Fizz wysyła
    // dalsze z nich poza kolejnością (`<template>` + skrypt); drugi przebieg
    // (`renderToString`, wszystko już rozwiązane) stawia każdą ikonę w jej
    // miejscu w HTML-u.
    const page = (
      <div>
        {CATALOG.map((name) => {
          const Icon = contentIcon(name, Fallback, 16);
          return (
            <i key={name} data-name={name}>
              <Icon className="size-4" />
            </i>
          );
        })}
      </div>
    );
    await serverHtml(page);
    const html = renderToString(page);
    expect(html).not.toMatch(/<!--\$[?!]-->/);
    for (const name of CATALOG) {
      const Reference = lucide[lucideExportName(name)];
      const chunk = new RegExp(`<i data-name="${name}">([\\s\\S]*?)</i>`).exec(html)?.[1] ?? "";
      if (!Reference) {
        wrong.push(`${name}: brak eksportu ${lucideExportName(name)} w lucide-react`);
        continue;
      }
      if (chunk.includes("data-zastepnik") || chunk.includes("data-dyn-missing")) {
        wrong.push(`${name}: zastępnik zamiast ikony`);
        continue;
      }
      const expected = glyph(renderToStaticMarkup(<Reference />));
      if (glyph(chunk) !== expected) wrong.push(`${name}: inny glif`);
    }
    expect(wrong).toEqual([]);
  });

  it.each([
    // Nazwy z całego katalogu: kuratorowana, przez porcję, alias, sklejony zapis cyfr.
    ["star", false],
    ["alarm-clock-check", true],
    ["arrow-down-0-1", true],
    ["grid-2x2", true],
    ["grid-3x3", true],
    ["house", true],
  ] as const)("%s: klasa miejsca zostaje, pudełko z `boxSize`", async (name, suspense) => {
    const Icon = contentIcon(name, Fallback, 16);
    const html = await serverHtml(
      <span>
        <Icon className="w-4 h-4 shrink-0" aria-label="ikona" />
      </span>,
    );
    const svg = /<svg\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(html).not.toContain("data-zastepnik");
    expect(svg).toContain('class="lucide ');
    expect(svg).toContain(" w-4 h-4 shrink-0");
    expect(svg).toContain('aria-label="ikona"');
    // Kuratorowana ikona dostaje propsy miejsca 1:1 (bez `boxSize`);
    // ikona z katalogu ma `size` = pudełko miejsca.
    expect(svg).toContain(suspense ? 'width="16" height="16"' : 'width="24" height="24"');
    expect(/<!--\$-->/.test(html)).toBe(suspense);
  });
});

describe("contentIcon - kolejność rozstrzygania", () => {
  it("eksport shimu wygrywa i jest tym samym komponentem co dziś", () => {
    for (const name of Object.keys(ShimNamespace)) {
      expect(contentIcon(name, Fallback, 16), name).toBe(ShimNamespace[name]);
    }
  });

  it("zestaw kuratorowany - bez wielkości liter i separatora (Bell, Flag)", () => {
    expect(contentIcon("Bell", Fallback, 16)).toBe(Lucide.Bell);
    expect(contentIcon("Flag", null, 16)).toBe(Lucide.Flag);
    expect(contentIcon("bell", null, 16)).toBe(Lucide.Bell);
    expect(contentIcon("FILE-TEXT", null, 16)).toBe(Lucide.FileText);
  });

  it("nazwa wybieraka spoza obu zestawów - stały komponent katalogu", () => {
    const a = contentIcon("alarm-clock-check", Fallback, 16);
    expect(a).not.toBe(Fallback);
    expect(a).not.toBeNull();
    // Ta sama tożsamość przy każdym renderze - inaczej ikona by się przemontowywała.
    expect(contentIcon("alarm-clock-check", Fallback, 16)).toBe(a);
    // Inny zastępnik albo pudełko - inny komponent (inna rezerwacja / inny brak).
    expect(contentIcon("alarm-clock-check", null, 16)).not.toBe(a);
    expect(contentIcon("alarm-clock-check", Fallback, 14)).not.toBe(a);
  });

  it("nazwa wybieraka z odpowiednikiem w shimie - ten sam komponent shimu, bez porcji katalogu", () => {
    const shim = ShimNamespace as unknown as Record<string, unknown>;
    expect(contentIcon("send", Fallback, 16)).toBe(shim.Send);
    expect(contentIcon("trash-2", Fallback, 16)).toBe(shim.Trash2);
    expect(contentIcon("triangle-alert", null, 14)).toBe(shim.TriangleAlert);
    // Alias innej ikony w shimie (`Redo2` = `Redo`) - nie skrót, tylko katalog.
    expect(contentIcon("redo-2", Fallback, 16)).not.toBe(shim.Redo2);
    expect(contentIcon("redo-2", Fallback, 16)).toBe(contentIcon("redo-2", Fallback, 16));
    expect(contentIcon("redo-2", Fallback, 16)).not.toBe(Fallback);
  });

  it.each([
    "",
    " ",
    "AlarmClockCheck",
    "alarm_clock_check",
    "alarm--clock",
    "-alarm",
    "Alarm-clock",
    "BellRing",
    "<svg>",
    'x" onload="',
  ])("%j: poza alfabetem wybieraka i poza zestawami - zastępnik", (name) => {
    expect(contentIcon(name, Fallback, 16)).toBe(Fallback);
    expect(contentIcon(name, null, 16)).toBeNull();
  });

  it.each([undefined, null, 42, {}, ["Star"]])("wartość nie-tekstowa %j - zastępnik", (value) => {
    expect(contentIcon(value, Fallback, 16)).toBe(Fallback);
  });

  it("klucze prototypu nie są ikoną, choć shim jest zwykłym obiektem (jak w buildzie)", () => {
    // Warunek testu: przestrzeń nazw dziedziczy po `Object.prototype`.
    expect("toString" in ShimNamespace).toBe(true);
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      expect(contentIcon(key, Fallback, 16), key).toBe(Fallback);
      expect(contentIcon(key, null, 16), key).toBeNull();
    }
  });

  it("nazwa wybieraka, której katalog nie zna - zastępnik miejsca ze znacznikiem, bez znaku zapytania", async () => {
    const Icon = contentIcon("nie-ma-takiej-ikony", Fallback, 16);
    const html = await serverHtml(
      <Suspense fallback={null}>
        <Icon className="w-4 h-4" />
      </Suspense>,
    );
    expect(html).toContain("data-zastepnik");
    expect(html).toContain('data-dyn-missing="NieMaTakiejIkony"');
    expect(html).not.toContain("data-dyn-icon");
    expect(html).not.toMatch(/lucide-(?:circle-question-mark|help-circle)/);

    const None = contentIcon("nie-ma-takiej-ikony", null, 16)!;
    const empty = await serverHtml(<None className="w-4 h-4" />);
    expect(empty).toBe(
      '<!--$--><template data-dyn-missing="NieMaTakiejIkony"></template><!--/$-->',
    );
  });
});
