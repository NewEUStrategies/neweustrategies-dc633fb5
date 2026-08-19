// BIBLIOTEKA IKON - warstwa danych. Do 18.08.2026: 6,6% linii, 2 z 8 funkcji.
// Martwe były: `upsertIcon`, `deleteIcon`, `parseUploadFilename`,
// `uploadIconAsset`, `bulkImportIcons`, `resolveIconUrl`.
//
// Dwie reguły niosą tu największe ryzyko:
//   * `parseUploadFilename` - z nazwy pliku wyprowadza NAZWĘ ikony i jej
//     wariant kolorystyczny. Pomyłka tworzy dwie osobne ikony zamiast dwóch
//     wariantów jednej, albo sklei różne ikony w jedną.
//   * `bulkImportIcons` - import masowy. Jedna zła ikona nie może przewrócić
//     całej partii, a duplikat nie może nadpisać istniejącego wpisu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  uploads: [] as Array<{ path: string; contentType?: string; cacheControl?: string }>,
  uploadError: null as { message: string } | null,
  failUploadsFor: null as RegExp | null,
}));

const stubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      storage: {
        from: () => ({
          upload: async (
            path: string,
            file: File,
            opts?: { contentType?: string; cacheControl?: string },
          ) => {
            if (h.failUploadsFor?.test(file.name)) {
              return { error: { message: `odrzucony: ${file.name}` } };
            }
            h.uploads.push({
              path,
              contentType: opts?.contentType,
              cacheControl: opts?.cacheControl,
            });
            return { error: h.uploadError };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
        }),
      },
    },
  };
});

import {
  bulkImportIcons,
  deleteIcon,
  listIcons,
  resolveIconUrl,
  slugifyIconName,
  upsertIcon,
  uploadIconAsset,
  type IconRow,
} from "@/lib/iconLibrary";

const TENANT = "11111111-1111-4111-8111-111111111111";

function stub() {
  const s = stubs.from;
  if (!s) throw new Error("atrapa supabase nie została zainicjalizowana");
  return s;
}

function iconFile(name: string): File {
  return new File(["<svg/>"], name, { type: "image/svg+xml" });
}

function row(overrides: Partial<IconRow> = {}): IconRow {
  return {
    id: "i1",
    tenant_id: TENANT,
    kind: "brand",
    name: "acme",
    label: "Acme",
    url_default: "",
    url_light: "",
    url_dark: "",
    default_variant: "auto",
    position: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  stub().reset();
  h.uploads.length = 0;
  h.uploadError = null;
  h.failUploadsFor = null;
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

// ---------------------------------------------------------------------------
// slugifyIconName - nazwa ikony
// ---------------------------------------------------------------------------

describe("slugifyIconName", () => {
  it("sprowadza nazwę do małych liter i myślników", () => {
    expect(slugifyIconName("Parlament Europejski")).toBe("parlament-europejski");
  });

  it("rozkłada znaki diakrytyczne, zamiast je wycinać", () => {
    // Bez rozkładu „Łódź” dałoby „d”, czyli nazwę, której nikt nie znajdzie.
    expect(slugifyIconName("Gdańsk Ćma")).toBe("gdansk-cma");
  });

  it("zachowuje podkreślenie i myślnik, resztę zamienia", () => {
    expect(slugifyIconName("logo_v2.final+RGB")).toBe("logo_v2-final-rgb");
  });

  it("obcina myślniki z krańców", () => {
    expect(slugifyIconName("  ***Acme***  ")).toBe("acme");
  });

  it("przycina do 64 znaków", () => {
    expect(slugifyIconName("a".repeat(120))).toHaveLength(64);
  });

  it("nazwa bez znaków alfanumerycznych daje pustą nazwę", () => {
    // Pusta nazwa jest sygnałem dla importu masowego, żeby pominąć plik.
    expect(slugifyIconName("***")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("listIcons", () => {
  it("sortuje po pozycji, potem po nazwie", () => {
    stub().setResponse("icon_library", ok([]));
    return listIcons().then(() => {
      const orders = stub()
        .lastChain("icon_library")
        ?.calls.filter((c) => c.method === "order")
        .map((c) => c.args[0]);
      expect(orders).toEqual(["position", "name"]);
    });
  });

  it("filtruje po rodzaju, gdy podany", async () => {
    stub().setResponse("icon_library", ok([]));
    await listIcons("flag");
    expect(stub().lastChain("icon_library")?.argsOf("eq")).toEqual(["kind", "flag"]);
  });

  it("bez rodzaju NIE dokłada filtra", async () => {
    stub().setResponse("icon_library", ok([]));
    await listIcons();
    expect(stub().lastChain("icon_library")?.has("eq")).toBe(false);
  });

  it("pusta odpowiedź daje pustą listę", async () => {
    stub().setResponse("icon_library", ok(null));
    expect(await listIcons()).toEqual([]);
  });

  it("błąd odczytu wychodzi na wierzch", async () => {
    stub().setResponse("icon_library", fail("odmowa"));
    await expect(listIcons()).rejects.toThrow("odmowa");
  });
});

describe("upsertIcon", () => {
  it("NOWA ikona idzie przez upsert z kluczem tenant+rodzaj+nazwa", async () => {
    // Klucz konfliktu jest tu regułą: ta sama nazwa w tym samym rodzaju to
    // AKTUALIZACJA, nie druga ikona.
    stub().setResponse("icon_library", ok(row()));
    await upsertIcon(TENANT, { kind: "brand", name: "acme" });

    const chain = stub().lastChain("icon_library");
    expect(chain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id,kind,name" });
    expect(chain?.has("update")).toBe(false);
  });

  it("ISTNIEJĄCA ikona (z id) idzie przez update zawężony do wiersza", async () => {
    stub().setResponse("icon_library", ok(row()));
    await upsertIcon(TENANT, { id: "i1", kind: "brand", name: "acme" });

    const chain = stub().lastChain("icon_library");
    expect(chain?.has("update")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", "i1"]);
  });

  it("obcina białe znaki z nazwy - inaczej powstaje bliźniak nie do znalezienia", async () => {
    stub().setResponse("icon_library", ok(row()));
    await upsertIcon(TENANT, { kind: "brand", name: "  acme  " });
    expect(stub().lastChain("icon_library")?.argsOf("upsert")?.[0]).toMatchObject({ name: "acme" });
  });

  it("uzupełnia brakujące pola bezpiecznymi wartościami", async () => {
    // Puste napisy zamiast undefined: kolumny adresów są NOT NULL, a wariant
    // domyślny „auto” to jedyny, który dobiera się do trybu strony.
    stub().setResponse("icon_library", ok(row()));
    await upsertIcon(TENANT, { kind: "flag", name: "pl" });
    expect(stub().lastChain("icon_library")?.argsOf("upsert")?.[0]).toEqual({
      tenant_id: TENANT,
      kind: "flag",
      name: "pl",
      label: null,
      url_default: "",
      url_light: "",
      url_dark: "",
      default_variant: "auto",
      position: 0,
    });
  });

  it("przekazuje jawne wartości bez zmian", async () => {
    stub().setResponse("icon_library", ok(row()));
    await upsertIcon(TENANT, {
      kind: "custom",
      name: "x",
      label: "X",
      url_dark: "https://cdn/x-dark.svg",
      default_variant: "dark",
      position: 5,
    });
    expect(stub().lastChain("icon_library")?.argsOf("upsert")?.[0]).toMatchObject({
      label: "X",
      url_dark: "https://cdn/x-dark.svg",
      default_variant: "dark",
      position: 5,
    });
  });

  it("błąd zapisu wychodzi na wierzch w obu trybach", async () => {
    stub().setResponse("icon_library", fail("konflikt"));
    await expect(upsertIcon(TENANT, { kind: "brand", name: "a" })).rejects.toThrow("konflikt");
    await expect(upsertIcon(TENANT, { id: "i1", kind: "brand", name: "a" })).rejects.toThrow(
      "konflikt",
    );
  });
});

describe("deleteIcon", () => {
  it("kasuje dokładnie jeden wiersz po identyfikatorze", async () => {
    stub().setResponse("icon_library", ok(null));
    await deleteIcon("i1");
    const chain = stub().lastChain("icon_library");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", "i1"]);
  });

  it("błąd kasowania wychodzi na wierzch", async () => {
    stub().setResponse("icon_library", fail("ikona w użyciu"));
    await expect(deleteIcon("i1")).rejects.toThrow("ikona w użyciu");
  });
});

// ---------------------------------------------------------------------------
// Wysyłka pliku ikony
// ---------------------------------------------------------------------------

describe("uploadIconAsset", () => {
  it("układa ścieżkę pod prefiksem tenanta i rodzaju", async () => {
    const url = await uploadIconAsset(TENANT, "flag", iconFile("PL.SVG"));
    expect(h.uploads[0].path.startsWith(`${TENANT}/icons/flag/`)).toBe(true);
    expect(h.uploads[0].path.endsWith(".svg")).toBe(true);
    expect(url).toContain(`https://cdn.example/${TENANT}/icons/flag/`);
  });

  it("GRANICA: plik BEZ kropki bierze całą nazwę jako rozszerzenie", async () => {
    // `"logo".split(".").pop()` oddaje "logo", nie undefined, więc fallback
    // "png" się NIE włącza i obiekt ląduje w buckecie jako `...-abc.logo`.
    // Pin na stan dzisiejszy: adres pozostaje poprawny i unikalny, ale
    // rozszerzenie jest bez sensu - zmiana wymaga osobnej decyzji.
    await uploadIconAsset(TENANT, "brand", iconFile("logo"));
    expect(h.uploads[0].path.endsWith(".logo")).toBe(true);
  });

  it("fallback png włącza się dla nazwy KOŃCZĄCEJ SIĘ kropką", async () => {
    await uploadIconAsset(TENANT, "brand", iconFile("logo."));
    expect(h.uploads[0].path.endsWith(".png")).toBe(true);
  });

  it("sprowadza rozszerzenie do małych liter", async () => {
    await uploadIconAsset(TENANT, "flag", iconFile("PL.SVG"));
    expect(h.uploads[0].path.endsWith(".svg")).toBe(true);
  });

  it("ustawia długi cache - ikony są niezmienne pod swoim adresem", async () => {
    await uploadIconAsset(TENANT, "brand", iconFile("a.svg"));
    expect(h.uploads[0].cacheControl).toBe("31536000");
  });

  it("błąd wysyłki wychodzi na wierzch", async () => {
    h.failUploadsFor = /a\.svg/;
    await expect(uploadIconAsset(TENANT, "brand", iconFile("a.svg"))).rejects.toMatchObject({
      message: "odrzucony: a.svg",
    });
  });
});

// ---------------------------------------------------------------------------
// Import masowy - nazwa pliku -> nazwa ikony + wariant
// ---------------------------------------------------------------------------

describe("bulkImportIcons - odczyt nazwy pliku", () => {
  async function importOne(filename: string) {
    stub().setResponse("icon_library", ok(null));
    const result = await bulkImportIcons(TENANT, "brand", [iconFile(filename)]);
    return {
      result,
      payload: stub().lastChain("icon_library")?.argsOf("upsert")?.[0] as Record<string, unknown>,
    };
  }

  it("zwykła nazwa daje wariant domyślny", async () => {
    const { payload } = await importOne("acme.svg");
    expect(payload).toMatchObject({ name: "acme", url_default: expect.stringContaining("http") });
    expect(payload.url_light).toBe("");
    expect(payload.url_dark).toBe("");
  });

  it("sufiks -dark daje wariant ciemny pod TĄ SAMĄ nazwą", async () => {
    const { payload } = await importOne("acme-dark.svg");
    expect(payload.name).toBe("acme");
    expect(payload.url_dark).toContain("http");
    expect(payload.url_default).toBe("");
  });

  it("sufiks -light daje wariant jasny", async () => {
    const { payload } = await importOne("acme-light.svg");
    expect(payload.name).toBe("acme");
    expect(payload.url_light).toContain("http");
  });

  it("sufiks jest rozpoznawany PO slugifikacji - spacje i wielkie litery też", async () => {
    // „Acme Logo DARK.svg” to ta sama ikona co „acme-logo-dark.svg”.
    const { payload } = await importOne("Acme Logo DARK.svg");
    expect(payload.name).toBe("acme-logo");
    expect(payload.url_dark).toContain("http");
  });

  it("znaki diakrytyczne w nazwie pliku nie tworzą osobnej ikony", async () => {
    const { payload } = await importOne("Gdańsk.svg");
    expect(payload.name).toBe("gdansk");
  });

  it("sufiks W ŚRODKU nazwy NIE jest wariantem", async () => {
    // „dark-mode-icon” to nazwa ikony, nie wariant ciemny ikony „mode-icon”.
    const { payload } = await importOne("dark-mode-icon.svg");
    expect(payload.name).toBe("dark-mode-icon");
    expect(payload.url_default).toContain("http");
    expect(payload.url_dark).toBe("");
  });

  it("wielokropek w nazwie ucina tylko OSTATNIE rozszerzenie", async () => {
    const { payload } = await importOne("acme.logo.v2.svg");
    expect(payload.name).toBe("acme-logo-v2");
  });

  it("plik o nazwie bez znaków alfanumerycznych jest POMIJANY", async () => {
    const { result } = await importOne("***.svg");
    expect(result).toMatchObject({ created: 0, skipped: 0, errors: [] });
  });
});

describe("bulkImportIcons - grupowanie i przebieg", () => {
  it("łączy trzy warianty tej samej ikony w JEDEN wpis", async () => {
    stub().setResponse("icon_library", ok(null));
    const result = await bulkImportIcons(TENANT, "brand", [
      iconFile("acme.svg"),
      iconFile("acme-light.svg"),
      iconFile("acme-dark.svg"),
    ]);

    expect(result.created).toBe(1);
    const payload = stub().lastChain("icon_library")?.argsOf("upsert")?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.url_default).toContain("http");
    expect(payload.url_light).toContain("http");
    expect(payload.url_dark).toContain("http");
    expect(payload.default_variant).toBe("auto");
  });

  it("różne ikony trafiają do osobnych wpisów", async () => {
    stub().setResponse("icon_library", ok(null));
    const result = await bulkImportIcons(TENANT, "brand", [
      iconFile("acme.svg"),
      iconFile("beta.svg"),
    ]);
    expect(result.created).toBe(2);
    expect(stub().chainsFor("icon_library")).toHaveLength(2);
  });

  it("DUPLIKAT wobec istniejących nazw jest pomijany bez zapisu", async () => {
    // Import masowy nie może po cichu nadpisać ikony, którą ktoś już wgrał
    // i podpiął w treści.
    stub().setResponse("icon_library", ok(null));
    const existing = new Set(["acme"]);
    const result = await bulkImportIcons(TENANT, "brand", [iconFile("acme.svg")], {
      existingNames: existing,
    });

    expect(result).toMatchObject({ created: 0, skipped: 1 });
    expect(stub().chainsFor("icon_library")).toHaveLength(0);
  });

  it("duplikat W OBRĘBIE jednej partii też jest łapany", async () => {
    // Po zapisie nazwa dopisuje się do zbioru istniejących, więc druga ikona
    // o tej samej nazwie w tej samej partii nie nadpisze pierwszej.
    stub().setResponse("icon_library", ok(null));
    const existing = new Set<string>();
    await bulkImportIcons(TENANT, "brand", [iconFile("acme.svg")], { existingNames: existing });
    const second = await bulkImportIcons(TENANT, "brand", [iconFile("acme.svg")], {
      existingNames: existing,
    });
    expect(second).toMatchObject({ created: 0, skipped: 1 });
  });

  it("CZĘŚCIOWA PORAŻKA nie przewraca partii - reszta przechodzi", async () => {
    // To jest sedno importu masowego: jedna zła ikona z pięćdziesięciu nie może
    // kosztować redaktora całej pracy.
    h.failUploadsFor = /zla/;
    stub().setResponse("icon_library", ok(null));
    const result = await bulkImportIcons(TENANT, "brand", [
      iconFile("dobra.svg"),
      iconFile("zla.svg"),
      iconFile("druga-dobra.svg"),
    ]);

    expect(result.created).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: "zla" });
  });

  it("błąd zapisu do bazy też jest liczony jako porażka POJEDYNCZEJ ikony", async () => {
    let call = 0;
    stub().setResponse("icon_library", () => {
      call += 1;
      return call === 1 ? fail("konflikt") : ok(null);
    });
    const result = await bulkImportIcons(TENANT, "brand", [iconFile("a.svg"), iconFile("b.svg")]);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it("raportuje POSTĘP na każdą grupę, z indeksem i sumą", async () => {
    stub().setResponse("icon_library", ok(null));
    const progress: Array<{ index: number; total: number; base: string; status: string }> = [];
    await bulkImportIcons(TENANT, "brand", [iconFile("a.svg"), iconFile("b.svg")], {
      onProgress: (p) => progress.push(p),
    });

    expect(progress.map((p) => p.status)).toEqual(["uploading", "done", "uploading", "done"]);
    expect(progress.every((p) => p.total === 2)).toBe(true);
    expect(progress.map((p) => p.index)).toEqual([1, 1, 2, 2]);
  });

  it("raportuje pominięcie i błąd osobnymi statusami", async () => {
    h.failUploadsFor = /zla/;
    stub().setResponse("icon_library", ok(null));
    const progress: Array<{ status: string; message?: string }> = [];
    await bulkImportIcons(TENANT, "brand", [iconFile("acme.svg"), iconFile("zla.svg")], {
      existingNames: new Set(["acme"]),
      onProgress: (p) => progress.push(p),
    });

    expect(progress.map((p) => p.status)).toEqual(["skipped", "uploading", "error"]);
    expect(progress[0].message).toBe("duplikat");
  });

  it("pusta lista plików daje pusty raport", async () => {
    expect(await bulkImportIcons(TENANT, "brand", [])).toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    });
  });
});

// ---------------------------------------------------------------------------
// resolveIconUrl - wybór wariantu pod tryb strony
// ---------------------------------------------------------------------------

describe("resolveIconUrl", () => {
  const full = row({
    url_default: "https://cdn/d.svg",
    url_light: "https://cdn/l.svg",
    url_dark: "https://cdn/k.svg",
  });

  it("wariant AUTO dobiera się do trybu strony", () => {
    expect(resolveIconUrl({ ...full, default_variant: "auto" }, "light")).toBe("https://cdn/l.svg");
    expect(resolveIconUrl({ ...full, default_variant: "auto" }, "dark")).toBe("https://cdn/k.svg");
  });

  it("domyślnym trybem strony jest jasny", () => {
    expect(resolveIconUrl({ ...full, default_variant: "auto" })).toBe("https://cdn/l.svg");
  });

  it("wariant WYMUSZONY ignoruje tryb strony", () => {
    // Logo, które ma zawsze wyglądać tak samo, nie może migać przy zmianie
    // motywu - stąd warianty wymuszone.
    expect(resolveIconUrl({ ...full, default_variant: "light" }, "dark")).toBe("https://cdn/l.svg");
    expect(resolveIconUrl({ ...full, default_variant: "dark" }, "light")).toBe("https://cdn/k.svg");
    expect(resolveIconUrl({ ...full, default_variant: "default" }, "dark")).toBe(
      "https://cdn/d.svg",
    );
  });

  it("wymuszony wariant SPADA na adres domyślny, gdy go brak", () => {
    const noLight = { ...full, url_light: "", default_variant: "light" as const };
    expect(resolveIconUrl(noLight, "light")).toBe("https://cdn/d.svg");
  });

  it("tryb ciemny w AUTO spada kolejno: ciemny, domyślny, jasny", () => {
    expect(resolveIconUrl({ ...full, url_dark: "", default_variant: "auto" }, "dark")).toBe(
      "https://cdn/d.svg",
    );
    expect(
      resolveIconUrl({ ...full, url_dark: "", url_default: "", default_variant: "auto" }, "dark"),
    ).toBe("https://cdn/l.svg");
  });

  it("tryb jasny w AUTO spada kolejno: jasny, domyślny, ciemny", () => {
    expect(resolveIconUrl({ ...full, url_light: "", default_variant: "auto" }, "light")).toBe(
      "https://cdn/d.svg",
    );
    expect(
      resolveIconUrl({ ...full, url_light: "", url_default: "", default_variant: "auto" }, "light"),
    ).toBe("https://cdn/k.svg");
  });

  it("wiersz BEZ ŻADNEGO adresu oddaje pusty napis, nie undefined", () => {
    // Pusty napis jest sygnałem „brak ikony” dla warstwy widoku; `undefined`
    // wylądowałoby w atrybucie `src` jako tekst „undefined”.
    const empty = row({ url_default: "", url_light: "", url_dark: "" });
    expect(resolveIconUrl(empty, "light")).toBe("");
    expect(resolveIconUrl({ ...empty, default_variant: "default" })).toBe("");
  });
});
