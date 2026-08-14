// Druga kłódka izolacji obszarów roboczych po stronie klienta.
//
// Reguła jest asymetryczna z rozmysłem i dokładnie ta asymetria wymaga dowodu:
// blokujemy WYŁĄCZNIE przy dowodzie rozjazdu (dwa znane, różne identyfikatory),
// a przy niewiedzy przepuszczamy - szczelności pilnuje RLS, a klient, który
// blokuje „na wszelki wypadek", wywraca legalny zakup w chwili, gdy kontekst
// tenanta jeszcze nie dojechał.
import { describe, expect, it } from "vitest";
import { isForeignTenantResource } from "@/lib/tenant";

const TENANT_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

describe("isForeignTenantResource", () => {
  it("wykrywa zasób z innego obszaru roboczego", () => {
    expect(isForeignTenantResource(TENANT_B, TENANT_A)).toBe(true);
  });

  it("przepuszcza zasób z tego samego obszaru roboczego", () => {
    expect(isForeignTenantResource(TENANT_A, TENANT_A)).toBe(false);
  });

  it("nie blokuje przy niepełnej wiedzy", () => {
    for (const unknown of [null, undefined, ""]) {
      expect(isForeignTenantResource(unknown, TENANT_A), `zasób: ${String(unknown)}`).toBe(false);
      expect(isForeignTenantResource(TENANT_A, unknown), `oglądający: ${String(unknown)}`).toBe(
        false,
      );
    }
    expect(isForeignTenantResource(null, null)).toBe(false);
  });

  it("porównuje identyfikatory dokładnie, bez normalizacji", () => {
    // Identyfikatory to UUID-y z bazy - żadnego przycinania ani ignorowania
    // wielkości liter, bo każda taka „uprzejmość" to potencjalna zgoda na obcy
    // zasób przy najbliższej zmianie formatu.
    expect(isForeignTenantResource(TENANT_A.toUpperCase(), TENANT_A)).toBe(true);
    expect(isForeignTenantResource(` ${TENANT_A}`, TENANT_A)).toBe(true);
  });
});
