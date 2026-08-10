// Parzystość kluczy PL/EN dla słownika strony "Dołącz do nas".
// Brakujący klucz w jednym z języków to na produkcji surowa ścieżka i18n
// w miejscu treści - dlatego pilnujemy tego testem, a nie recenzją.
import { describe, expect, it } from "vitest";
import { membershipJoinResources } from "@/lib/i18n-membership-join";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

describe("i18n-membership-join", () => {
  const pl = flatten(membershipJoinResources.pl as unknown as Tree).sort();
  const en = flatten(membershipJoinResources.en as unknown as Tree).sort();

  it("ma identyczny zestaw kluczy w PL i EN", () => {
    expect(pl).toEqual(en);
  });

  it("nie zawiera pustych tłumaczeń ani pauzy typograficznej", () => {
    const values = [membershipJoinResources.pl, membershipJoinResources.en]
      .map((tree) => JSON.stringify(tree))
      .join(" ");
    expect(values).not.toContain("\u2014");
    expect(values).not.toContain('""');
  });
});
