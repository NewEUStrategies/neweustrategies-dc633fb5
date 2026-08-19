// Kontrakt katalogu organizacji: schemat wiersza z RPC, klucz cache, doklejenie
// przypisanej firmy do droplisty i ATOMOWY patch przypisania.
//
// Ta powierzchnia niesie atrybucję komercyjną wpisu - `posts.organization_*` to
// MIGAWKA firmy z chwili publikacji, a nie referencja do CRM-u. Jej rozjazd
// nie wywala się na typach i nie widać go w panelu; widać go dopiero
// w opublikowanym artykule, przy nocie sponsorskiej.
import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_DROPLIST_LIMIT,
  ORGANIZATION_NONE_VALUE,
  ORGANIZATION_SEARCH_KEY,
  ORGANIZATION_SEARCH_LIMIT,
  organizationPatch,
  organizationRowSchema,
  organizationSearchKey,
  organizationSelectRows,
  type OrganizationRow,
  type OrganizationSnapshotFields,
} from "../organizationDirectory";

function row(over: Partial<OrganizationRow> = {}): OrganizationRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Firma A",
    website: "https://a.test",
    logo_url: "https://a.test/logo.svg",
    country: "PL",
    city: "Warszawa",
    branch: null,
    ...over,
  };
}

function snapshot(over: Partial<OrganizationSnapshotFields> = {}): OrganizationSnapshotFields {
  return {
    organization_id: null,
    organization_name: null,
    organization_logo_url: null,
    organization_website: null,
    ...over,
  };
}

describe("organizationRowSchema", () => {
  it("przyjmuje wiersz w kształcie zwracanym przez RPC", () => {
    expect(organizationRowSchema.safeParse(row()).success).toBe(true);
  });

  it("dopuszcza puste kolumny opcjonalne - CRM nie wymusza kompletu danych", () => {
    const parsed = organizationRowSchema.safeParse(
      row({ website: null, logo_url: null, country: null, city: null, branch: null }),
    );
    expect(parsed.success).toBe(true);
  });

  it("ODRZUCA wiersz o niezgodnym kształcie, zamiast wpuścić go dalej", () => {
    // RPC oddaje kolumny wyliczone w SQL-u, których TypeScript nie weryfikuje.
    // `safeParse` ma dać pustą listę i wpis w konsoli, a nie wyjątek w środku
    // dialogu ani `as` zdejmujący kontrolę typów.
    expect(organizationRowSchema.safeParse({ id: "nie-uuid", name: "X" }).success).toBe(false);
    expect(organizationRowSchema.safeParse({ ...row(), name: 42 }).success).toBe(false);
    expect(organizationRowSchema.safeParse(null).success).toBe(false);
  });

  it("wymaga UUID w identyfikatorze - to klucz obcy do CRM-u", () => {
    expect(organizationRowSchema.safeParse(row({ id: "12" })).success).toBe(false);
  });
});

describe("organizationSearchKey", () => {
  it("REGUŁA IZOLACJI: klucz cache niesie tenanta", () => {
    // Bez tenanta w kluczu wyniki wyszukiwania firm zostawałyby w pamięci
    // podręcznej po przelogowaniu do innego obszaru roboczego - czyli katalog
    // jednego najemcy pokazywałby się drugiemu.
    const a = organizationSearchKey("tenant-a", "acme");
    const b = organizationSearchKey("tenant-b", "acme");
    expect(a).not.toEqual(b);
    expect(a).toContain("tenant-a");
  });

  it("brak tenanta ma własną, jawną reprezentację", () => {
    expect(organizationSearchKey(null, "acme")).toEqual(organizationSearchKey(undefined, "acme"));
    expect(organizationSearchKey(null, "acme")).toContain(null);
  });

  it("normalizuje zapytanie: białe znaki i wielkość liter nie mnożą wpisów cache", () => {
    // „ACME", „acme " i „ Acme" to dla użytkownika to samo szukanie - trzy
    // osobne klucze oznaczałyby trzy round-tripy po ten sam wynik.
    const canonical = organizationSearchKey("t", "acme");
    expect(organizationSearchKey("t", "  ACME ")).toEqual(canonical);
    expect(organizationSearchKey("t", "Acme")).toEqual(canonical);
  });

  it("zaczyna się od wspólnego prefiksu, po którym idzie unieważnienie", () => {
    const key = organizationSearchKey("t", "acme");
    expect(key.slice(0, ORGANIZATION_SEARCH_KEY.length)).toEqual([...ORGANIZATION_SEARCH_KEY]);
  });
});

describe("organizationSelectRows", () => {
  it("bez przypisanej organizacji oddaje listę bez zmian", () => {
    const rows = [row({ id: "aaaaaaaa-1111-1111-1111-111111111111" })];
    expect(organizationSelectRows(rows, snapshot())).toEqual(rows);
  });

  it("REGRESJA: przypisana firma spoza droplisty jest DOKLEJANA na początek", () => {
    // Bez tego `<Select>` pokazuje pustą wartość dla wpisu, który organizację
    // MA - wygląda jak utrata danych i zaprasza do „naprawienia" przez ponowny
    // wybór, czyli do nadpisania migawki bieżącym stanem CRM.
    const rows = [row({ id: "aaaaaaaa-1111-1111-1111-111111111111", name: "Inna" })];
    const result = organizationSelectRows(
      rows,
      snapshot({
        organization_id: "bbbbbbbb-2222-2222-2222-222222222222",
        organization_name: "Zapisana Sp. z o.o.",
        organization_website: "https://zapisana.test",
        organization_logo_url: "https://zapisana.test/logo.png",
      }),
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("bbbbbbbb-2222-2222-2222-222222222222");
    expect(result[0].name).toBe("Zapisana Sp. z o.o.");
    expect(result[0].website).toBe("https://zapisana.test");
  });

  it("doklejony wiersz powstaje z MIGAWKI wpisu, nie z CRM-u", () => {
    // Migawka jest dowodem stanu z chwili publikacji. Podstawienie tu nazwy
    // z CRM-u przepisałoby historię atrybucji po cichu.
    const result = organizationSelectRows(
      [],
      snapshot({
        organization_id: "cccccccc-3333-3333-3333-333333333333",
        organization_name: "Stara Nazwa",
      }),
    );
    expect(result[0].name).toBe("Stara Nazwa");
  });

  it("gdy migawka nie ma nazwy, pokazuje identyfikator zamiast pustki", () => {
    const result = organizationSelectRows(
      [],
      snapshot({
        organization_id: "dddddddd-4444-4444-4444-444444444444",
        organization_name: null,
      }),
    );
    expect(result[0].name).toBe("dddddddd-4444-4444-4444-444444444444");
  });

  it("nie duplikuje firmy, która JEST już w dropliście", () => {
    const id = "eeeeeeee-5555-5555-5555-555555555555";
    const rows = [row({ id, name: "Z listy" })];
    const result = organizationSelectRows(
      rows,
      snapshot({ organization_id: id, organization_name: "Z migawki" }),
    );

    expect(result).toHaveLength(1);
    // Wygrywa wiersz z CRM-u: skoro firma jest na liście, jej dane są świeższe.
    expect(result[0].name).toBe("Z listy");
  });

  it("nie mutuje listy wejściowej", () => {
    const rows = [row()];
    organizationSelectRows(
      rows,
      snapshot({ organization_id: "ffffffff-6666-6666-6666-666666666666" }),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("organizationPatch", () => {
  it("przypisanie ustawia WSZYSTKIE cztery kolumny jednym patchem", () => {
    // Cztery osobne `set()` dałyby cztery wpisy w historii cofania i cztery
    // renderowania, z których każde mogłoby trafić w debounce autozapisu
    // osobno - zapisując stan pośredni, np. nowe id ze starą nazwą.
    expect(
      organizationPatch({
        id: "org-1",
        name: "Acme",
        logoUrl: "https://acme.test/logo.svg",
        website: "https://acme.test",
      }),
    ).toEqual({
      organization_id: "org-1",
      organization_name: "Acme",
      organization_logo_url: "https://acme.test/logo.svg",
      organization_website: "https://acme.test",
    });
  });

  it("odpięcie ZERUJE komplet migawki, nie tylko identyfikator", () => {
    // Zostawienie nazwy przy pustym `id` dałoby wpis przypisany do firmy,
    // do której już się nie przyznaje - a nota sponsorska renderuje się
    // właśnie z migawki.
    expect(organizationPatch(null)).toEqual({
      organization_id: null,
      organization_name: null,
      organization_logo_url: null,
      organization_website: null,
    });
  });

  it("puste pola opcjonalne przechodzą jako null, nie jako undefined", () => {
    // `undefined` w patchu formularza nie nadpisałoby poprzedniej wartości -
    // logo poprzedniej firmy zostałoby przy nowej.
    const patch = organizationPatch({
      id: "org-2",
      name: "Bez logo",
      logoUrl: null,
      website: null,
    });
    expect(patch.organization_logo_url).toBeNull();
    expect(patch.organization_website).toBeNull();
  });
});

describe("stałe katalogu", () => {
  it("wartość „brak organizacji” jest NIEPUSTA - Radix rezerwuje pusty string", () => {
    expect(ORGANIZATION_NONE_VALUE).not.toBe("");
  });

  it("dialog wyszukiwania pokazuje mniej wyników niż droplista", () => {
    // Droplista jest przeglądem katalogu, dialog - wynikiem szukania.
    expect(ORGANIZATION_SEARCH_LIMIT).toBeLessThan(ORGANIZATION_DROPLIST_LIMIT);
  });
});
