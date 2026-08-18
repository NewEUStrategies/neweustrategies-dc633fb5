// Kontrakt katalogu organizacji - schemat wiersza z RPC, klucz cache i limity.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. SCHEMAT JEST ZAPORĄ, NIE OZDOBĄ. `search_companies_public` oddaje kolumny
//     wyliczone w SQL-u, więc TypeScript nie ma czego sprawdzić. Gdy schemat
//     przestanie odrzucać zły kształt (np. `id` niebędące UUID-em po nieudanej
//     migracji), trzy powierzchnie edytora (droplista, lista w dialogu,
//     formularz zakładania) zaczną wpisywać do `posts.organization_id` wartość,
//     której baza nie przyjmie - redaktor zobaczy „zapisano", a atrybucja
//     zniknie przy pierwszym autozapisie.
//
//  2. `tenantId` W KLUCZU CACHE TO ZAPORA PRYWATNOŚCI. Gdyby klucz go zgubił,
//     react-query oddałby po przelogowaniu (albo przy przełączeniu obszaru
//     roboczego) listę firm POPRZEDNIEGO najemcy z pamięci podręcznej - czyli
//     wyciek katalogu klientów CRM bez ani jednego zapytania do bazy.
//
//  3. NORMALIZACJA FRAZY. Klucz musi zbijać „ Acme " i „acme" do jednego wpisu,
//     inaczej każde naciśnięcie klawisza to osobny wpis cache i osobne
//     zapytanie do bazy.
import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_DROPLIST_LIMIT,
  ORGANIZATION_SEARCH_KEY,
  ORGANIZATION_SEARCH_LIMIT,
  organizationRowSchema,
  organizationSearchKey,
} from "../organizationDirectory";
import { EDITOR_IDS } from "@/test/post-editor/fixtures";

/** Kompletny wiersz w kształcie, jaki oddaje RPC (kolumny prezentacyjne). */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "ACME Europe",
    website: "https://acme.example",
    logo_url: "https://cdn.example/logo.png",
    country: "Belgia",
    city: "Bruksela",
    branch: "Energia",
    ...overrides,
  };
}

describe("organizationRowSchema", () => {
  it("przyjmuje pełny wiersz z RPC", () => {
    const parsed = organizationRowSchema.safeParse(row());
    expect(parsed.success).toBe(true);
  });

  it("przyjmuje NULL-e w każdym polu opcjonalnym - CRM nie wymaga adresu ani logo", () => {
    // Firma założona jednym polem (samą nazwą) musi dać się wybrać do wpisu.
    const parsed = organizationRowSchema.safeParse(
      row({ website: null, logo_url: null, country: null, city: null, branch: null }),
    );
    expect(parsed.success).toBe(true);
  });

  it("odrzuca `id`, które nie jest UUID-em", () => {
    // Taka wartość poleciałaby do `posts.organization_id` (kolumna uuid) i baza
    // odrzuciłaby CAŁY wiersz wpisu, gubiąc razem z atrybucją treść autora.
    const parsed = organizationRowSchema.safeParse(row({ id: "acme" }));
    expect(parsed.success).toBe(false);
  });

  it("odrzuca brak nazwy - bez niej migawka nie ma czego pokazać czytelnikowi", () => {
    const { id, website, logo_url, country, city, branch } = row();
    const parsed = organizationRowSchema.safeParse({
      id,
      website,
      logo_url,
      country,
      city,
      branch,
    });
    expect(parsed.success).toBe(false);
  });

  it("odrzuca pole opcjonalne podane jako `undefined` zamiast `null`", () => {
    // `nullable()` nie znaczy `optional()`: RPC zawsze oddaje kolumnę, więc
    // brak klucza jest sygnałem rozjazdu schematu, nie pustą wartością.
    const parsed = organizationRowSchema.safeParse(row({ website: undefined }));
    expect(parsed.success).toBe(false);
  });

  it("odrzuca nazwę o złym typie (liczba po błędnej migracji)", () => {
    const parsed = organizationRowSchema.safeParse(row({ name: 42 }));
    expect(parsed.success).toBe(false);
  });
});

describe("organizationSearchKey", () => {
  it("umieszcza tenanta w kluczu - cache nie przecieka między obszarami roboczymi", () => {
    const mine = organizationSearchKey(EDITOR_IDS.tenant, "acme");
    const foreign = organizationSearchKey(EDITOR_IDS.foreignTenant, "acme");
    expect(mine).not.toEqual(foreign);
    expect(mine).toContain(EDITOR_IDS.tenant);
  });

  it("brak tenanta zapisuje jawny `null`, nie `undefined` (klucz musi być stabilny)", () => {
    expect(organizationSearchKey(null, "acme")).toEqual([...ORGANIZATION_SEARCH_KEY, null, "acme"]);
    expect(organizationSearchKey(undefined, "acme")).toEqual(organizationSearchKey(null, "acme"));
  });

  it("normalizuje frazę: przycina brzegi i zbija wielkość liter", () => {
    // Inaczej „ Acme ", „acme" i „ACME" to trzy wpisy cache i trzy zapytania.
    expect(organizationSearchKey(EDITOR_IDS.tenant, "  ACME  ")).toEqual(
      organizationSearchKey(EDITOR_IDS.tenant, "acme"),
    );
  });

  it("zaczyna się prefiksem unieważnianym po dodaniu organizacji", () => {
    // Formularz zakładania unieważnia CAŁY prefiks - gdyby klucz zaczynał się
    // inaczej, świeżo dodana firma nie pojawiłaby się na liście bez F5.
    const key = organizationSearchKey(EDITOR_IDS.tenant, "acme");
    expect(key.slice(0, ORGANIZATION_SEARCH_KEY.length)).toEqual([...ORGANIZATION_SEARCH_KEY]);
  });

  it("rozróżnia frazy różniące się treścią", () => {
    expect(organizationSearchKey(EDITOR_IDS.tenant, "acme")).not.toEqual(
      organizationSearchKey(EDITOR_IDS.tenant, "beta"),
    );
  });
});

describe("limity", () => {
  it("droplista bierze więcej wierszy niż lista w dialogu", () => {
    // Droplista ma pokryć „zwykły" katalog bez pisania, dialog jest dla
    // wyszukiwania - odwrotna relacja znaczyłaby, że droplista gubi firmy,
    // które i tak zmieściłyby się w wynikach.
    expect(ORGANIZATION_DROPLIST_LIMIT).toBeGreaterThan(ORGANIZATION_SEARCH_LIMIT);
  });

  it("oba limity są dodatnie - zero oznaczałoby pustą listę zawsze", () => {
    expect(ORGANIZATION_DROPLIST_LIMIT).toBeGreaterThan(0);
    expect(ORGANIZATION_SEARCH_LIMIT).toBeGreaterThan(0);
  });
});
