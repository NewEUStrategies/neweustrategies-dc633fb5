// `cn()` z ograniczoną pamięcią (P2.4, hydration:H10 d): ten sam wynik co
// `twMerge(clsx(...))`, pamięć z twardym limitem.
//
// CO TEN PLIK DOWODZI:
//  1. Wynik jest identyczny z dotychczasowym `twMerge(clsx(...))` - także po
//     trafieniu w pamięć i po wypchnięciu najstarszych wpisów.
//  2. Pojedyncza klasa (bez białych znaków) wraca bez scalania.
//  3. Pamięć ma limit - tysiące różnych napisów nie psują wyników.
import { describe, expect, it } from "vitest";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { cn } from "../utils";

const CASES: ClassValue[][] = [
  ["p-2", "p-4"],
  ["px-2 py-1", "p-3"],
  ["text-sm", { "text-lg": true, hidden: false }],
  ["bg-brand hover:opacity-90", ["bg-muted", undefined, null]],
  ["inline-flex items-center", "flex"],
  ["!p-2", "p-4"],
  ["font-display text-3xl md:text-4xl", "text-5xl"],
  ["w-full\nh-full", "h-auto"],
  [""],
  [],
];

describe("cn - wynik jak twMerge(clsx(...))", () => {
  it.each(CASES.map((c) => [JSON.stringify(c), c] as const))("%s", (_label, inputs) => {
    const expected = twMerge(clsx(inputs));
    expect(cn(...inputs)).toBe(expected);
    // Drugie wywołanie trafia w pamięć - ten sam wynik.
    expect(cn(...inputs)).toBe(expected);
  });

  it("pojedyncza klasa wraca bez zmian", () => {
    expect(cn("p-2")).toBe("p-2");
    expect(cn(undefined, false, "text-foreground")).toBe("text-foreground");
    expect(cn()).toBe("");
  });

  it("po wypchnięciu najstarszych wpisów wyniki zostają poprawne", () => {
    const first = cn("p-1", "p-2");
    for (let i = 0; i < 5000; i++) cn(`m-${i}`, `m-${i + 1}`);
    expect(cn("p-1", "p-2")).toBe(first);
    expect(cn("m-1", "m-2")).toBe(twMerge("m-1 m-2"));
  });
});
