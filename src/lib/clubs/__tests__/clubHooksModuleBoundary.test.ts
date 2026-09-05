// Bramka architektury po rozbiciu `useClubs.ts` na sześć modułów domenowych.
//
// DLACZEGO OSOBNA BRAMKA. Podział trzyma się na jednym założeniu: `useClubs.ts`
// jest MODUŁEM ZGODNOŚCI, a nie drugą implementacją. Gdyby ktoś kiedyś dopisał
// hook wprost do bariery zamiast do modułu domenowego - albo, gorzej, wkleił
// jego kopię - repo miałoby dwa hooki o tej samej nazwie i różnym zachowaniu,
// a rozjazd wyszedłby dopiero na produkcji, w tym z dwóch miejsc naraz.
//
// Ten sam wzorzec, co `workspaceModuleBoundary.test.ts` po rozdzieleniu
// workspace klubu i wątku (PR #206/#207).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as barrel from "@/lib/clubs/useClubs";
import * as catalog from "@/lib/clubs/useClubCatalog";
import * as admin from "@/lib/clubs/useClubAdmin";
import * as invites from "@/lib/clubs/useClubInvites";
import * as threads from "@/lib/clubs/useClubThreadsData";
import * as reactions from "@/lib/clubs/useClubReactions";
import * as moderation from "@/lib/clubs/useClubModeration";
import * as owner from "@/lib/clubs/useClubOwner";

const DOMAIN_MODULES = {
  catalog,
  admin,
  invites,
  threads,
  reactions,
  moderation,
  owner,
} as const;

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

describe("useClubs - moduł zgodności", () => {
  it("re-eksportuje TE SAME funkcje, a nie ich kopie", () => {
    const seen: string[] = [];
    for (const domain of Object.values(DOMAIN_MODULES)) {
      for (const [name, value] of Object.entries(domain)) {
        if (typeof value !== "function") continue;
        seen.push(name);
        // Tożsamość referencji jest tu całym sednem: kopia hooka przeszłaby
        // typecheck i wszystkie testy, a zachowywałaby się inaczej po
        // pierwszej poprawce w jednym z dwóch miejsc.
        expect(barrel[name as keyof typeof barrel], `${name} nie jest re-eksportem`).toBe(value);
      }
    }
    expect(seen.length).toBeGreaterThan(50);
  });

  it("nie eksportuje NICZEGO, czego nie ma w modułach domenowych", () => {
    const domainNames = new Set(Object.values(DOMAIN_MODULES).flatMap((m) => Object.keys(m)));
    const orphans = Object.keys(barrel).filter((name) => !domainNames.has(name));

    // Hook dopisany wprost do bariery omija podział i rośnie w miejscu,
    // z którego właśnie go wyprowadziliśmy.
    expect(orphans).toEqual([]);
  });

  it("bariera NIE zawiera implementacji - same re-eksporty", () => {
    const source = read("src/lib/clubs/useClubs.ts");

    expect(source).not.toMatch(/\buseQuery\(|\buseMutation\(|\buseInfiniteQuery\(/);
    expect(source).not.toMatch(/^export function /m);
  });

  it("żaden moduł domenowy nie importuje z bariery (brak cyklu)", () => {
    for (const name of [
      "useClubCatalog",
      "useClubAdmin",
      "useClubInvites",
      "useClubThreadsData",
      "useClubReactions",
      "useClubModeration",
    ]) {
      const source = read(`src/lib/clubs/${name}.ts`);
      expect(source, `${name} importuje z bariery`).not.toMatch(/from "\.\/useClubs"/);
      expect(source, `${name} importuje z bariery`).not.toMatch(/from "@\/lib\/clubs\/useClubs"/);
    }
  });

  it("nazwy hooków nie powtarzają się MIĘDZY modułami domenowymi", () => {
    const owner = new Map<string, string>();
    for (const [domainName, domain] of Object.entries(DOMAIN_MODULES)) {
      for (const name of Object.keys(domain)) {
        const previous = owner.get(name);
        expect(previous, `${name} jest w dwóch modułach: ${previous} i ${domainName}`).toBe(
          undefined,
        );
        owner.set(name, domainName);
      }
    }
  });
});

describe("clubInvalidations - jedyne źródło reguł unieważniania", () => {
  it("żaden moduł hooków nie woła invalidateQueries bezpośrednio", () => {
    for (const name of [
      "useClubCatalog",
      "useClubAdmin",
      "useClubInvites",
      "useClubThreadsData",
      "useClubReactions",
      "useClubModeration",
    ]) {
      const source = read(`src/lib/clubs/${name}.ts`);
      // Wyjątek: `cancelQueries`/`setQueryData` w mutacji optymistycznej to co
      // innego niż unieważnianie - reguła zakresu ich nie dotyczy.
      expect(source, `${name} omija clubInvalidations`).not.toMatch(/qc\.invalidateQueries\(/);
    }
  });

  it("moduł reguł nie zależy od Reacta ani od warstwy danych", () => {
    const source = read("src/lib/clubs/clubInvalidations.ts");

    expect(source).not.toMatch(/from "react"/);
    expect(source).not.toMatch(/from "\.\/api"/);
    // `import type` z react-query jest w porządku - to sam typ klucza,
    // znikający w kompilacji.
    expect(source).not.toMatch(/^import \{[^}]*\} from "@tanstack\/react-query"/m);
  });
});
