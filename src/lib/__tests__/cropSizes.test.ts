// Rejestr rozmiarów kadrowania + budowniczowie URL-i wariantów obrazu.
//
// Z tego modułu wychodzi adres KAŻDEGO obrazu renderowanego przez serwis:
// miniatury wpisów, awatary w bylinie i w widgetach, kafle mega menu, warianty
// z `custom_crop_sizes`. Błąd tutaj nie wywala aplikacji - daje rozmyte twarze,
// czterokrotnie za duży transfer albo `srcSet`, który kłamie przeglądarce o
// szerokości kandydata. To są regresje, których nie widać w żadnym teście
// renderującym, bo komponent nadal się rysuje.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, fail, type SupabaseFromStub } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import {
  isSupabaseStorageUrl,
  buildScaledImageUrl,
  buildImageSrcSet,
  buildTransformedImageUrl,
  buildAvatarSrc,
  buildAvatarSrcSet,
  listCropSizes,
  upsertCropSize,
  deleteCropSize,
  IMAGE_QUALITY,
  RESPONSIVE_WIDTHS,
  type CropSize,
} from "@/lib/cropSizes";

const OBJ = "https://proj.supabase.co/storage/v1/object/public/media/cover.jpg";
const RENDER = OBJ.replace("/object/", "/render/image/");
const EXT = "https://cdn.example.com/cover.jpg";
const TENANT = "11111111-1111-4111-8111-111111111111";

function stub() {
  const s = stubs.from;
  if (!s) throw new Error("atrapa supabase nie została zainicjalizowana");
  return s;
}

beforeEach(() => {
  stub().reset();
});

describe("isSupabaseStorageUrl", () => {
  it("detects object + render storage urls", () => {
    expect(isSupabaseStorageUrl(OBJ)).toBe(true);
    expect(isSupabaseStorageUrl(OBJ.replace("/object/", "/render/image/"))).toBe(true);
  });
  it("is false for external / empty", () => {
    expect(isSupabaseStorageUrl(EXT)).toBe(false);
    expect(isSupabaseStorageUrl("")).toBe(false);
    expect(isSupabaseStorageUrl("not a url")).toBe(false);
  });
});

describe("buildScaledImageUrl", () => {
  it("rewrites storage object urls to width-only render transforms", () => {
    const out = new URL(buildScaledImageUrl(OBJ, 640, 70));
    expect(out.pathname).toContain("/storage/v1/render/image/public/");
    expect(out.searchParams.get("width")).toBe("640");
    expect(out.searchParams.get("quality")).toBe("70");
    expect(out.searchParams.get("height")).toBeNull(); // width-only preserves ratio
  });
  it("appends a w hint for external urls", () => {
    expect(new URL(buildScaledImageUrl(EXT, 640)).searchParams.get("w")).toBe("640");
  });

  it("wymusza resize=contain, bo bez niego Supabase NIE skaluje proporcjonalnie", () => {
    // Regresja opisana w komentarzu przy funkcji: bez `resize` endpoint render
    // oddaje oryginalną wysokość z przyciętym pasem szerokości (1920×1169 ->
    // 320×1169), co w miniaturach widgetów wygląda jak skrajny zoom.
    expect(new URL(buildScaledImageUrl(OBJ, 320)).searchParams.get("resize")).toBe("contain");
  });

  it("domyślna jakość to wspólna stała, nie liczba wpisana z palca", () => {
    expect(new URL(buildScaledImageUrl(OBJ, 320)).searchParams.get("quality")).toBe(
      String(IMAGE_QUALITY),
    );
  });

  it("pusty adres zwraca bez zmian", () => {
    expect(buildScaledImageUrl("", 640)).toBe("");
  });

  it("adres, którego nie da się sparsować, wraca nietknięty zamiast wywalić render", () => {
    expect(buildScaledImageUrl("nie-adres", 640)).toBe("nie-adres");
  });
});

describe("buildImageSrcSet", () => {
  it("emits one width-descriptor candidate per width for storage urls", () => {
    const set = buildImageSrcSet(OBJ, [320, 640]);
    const parts = set.split(", ");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/width=320.* 320w$/);
    expect(parts[1]).toMatch(/width=640.* 640w$/);
  });
  it("returns empty for non-transformable urls so callers omit srcSet", () => {
    expect(buildImageSrcSet(EXT)).toBe("");
    expect(buildImageSrcSet("")).toBe("");
  });

  it("domyślne szerokości pokrywają cały zestaw breakpointów", () => {
    expect(buildImageSrcSet(OBJ).split(", ")).toHaveLength(RESPONSIVE_WIDTHS.length);
  });

  it("DEFEKT (zapinany): dla adresu JUŻ przetransformowanego kandydaci kłamią", () => {
    // `isSupabaseStorageUrl` przepuszcza /render/image/public/, ale
    // `buildScaledImageUrl` szuka /object/public/ - więc taki adres wpada w
    // gałąź zewnętrzną i dostaje `?w=`, którego endpoint render NIE czyta.
    // Efekt: każdy kandydat ma tę samą, oryginalną szerokość, a deskryptor
    // „320w" kłamie przeglądarce - wybiera plik wielokrotnie za duży.
    // Pin na stan dzisiejszy; naprawa idzie osobnym commitem.
    const parts = buildImageSrcSet(RENDER, [320, 640]).split(", ");
    expect(parts[0]).toContain("w=320");
    expect(parts[0]).not.toContain("width=320");
  });
});

describe("buildTransformedImageUrl (crop) still works", () => {
  it("sets width+height+resize for crops", () => {
    const out = new URL(buildTransformedImageUrl(OBJ, { width: 400, height: 300 }));
    expect(out.searchParams.get("width")).toBe("400");
    expect(out.searchParams.get("height")).toBe("300");
    expect(out.searchParams.get("resize")).toBe("cover");
  });

  it("przekazuje jawny tryb dopasowania", () => {
    const out = new URL(
      buildTransformedImageUrl(OBJ, { width: 400, height: 300, resize: "contain" }),
    );
    expect(out.searchParams.get("resize")).toBe("contain");
  });

  it("dla adresu spoza Storage dokleja podpowiedź w/h, nie ścieżkę render", () => {
    const out = new URL(buildTransformedImageUrl(EXT, { width: 400, height: 300 }));
    expect(out.searchParams.get("w")).toBe("400");
    expect(out.searchParams.get("h")).toBe("300");
    expect(out.pathname).not.toContain("render");
  });

  it("pusty i niedający się sparsować adres wracają bez zmian", () => {
    expect(buildTransformedImageUrl("", { width: 400, height: 300 })).toBe("");
    expect(buildTransformedImageUrl("nie-adres", { width: 400, height: 300 })).toBe("nie-adres");
  });
});

describe("RESPONSIVE_WIDTHS", () => {
  it("rośnie monotonicznie", () => {
    for (let i = 1; i < RESPONSIVE_WIDTHS.length; i += 1) {
      expect(RESPONSIVE_WIDTHS[i]).toBeGreaterThan(RESPONSIVE_WIDTHS[i - 1]);
    }
  });

  it("kończy się na 2400, NIE na 2560 - inaczej deskryptor kłamie", () => {
    // Supabase przycina szerokość transformacji do 2500 px, więc kandydat
    // „2560w" dostawał realnie 2500 px pod etykietą 2560 i na ekranach 2560+
    // przeglądarka wybierała wariant mniejszy niż deklarowany.
    expect(RESPONSIVE_WIDTHS.at(-1)).toBe(2400);
    expect(RESPONSIVE_WIDTHS.every((w) => w <= 2500)).toBe(true);
  });
});

describe("IMAGE_QUALITY", () => {
  it("stoi na 88, nie na domyślnych 75", () => {
    // 75 dawało widoczne zmiękczenie: rozmyte twarze na awatarach i tekst na
    // okładkach. Stała jest decyzją jakościową, nie parametrem do zgadywania.
    expect(IMAGE_QUALITY).toBe(88);
  });
});

describe("buildAvatarSrc", () => {
  it("prosi serwer o kwadrat 2× większy niż bok CSS", () => {
    // Bez tego mały awatar ładuje oryginał 1600×1600 i przeglądarka skaluje go
    // jednym przebiegiem - twarz robi się miękka, a transfer kilkadziesiąt razy
    // większy niż potrzebny.
    const out = new URL(buildAvatarSrc(OBJ, 48));
    expect(out.searchParams.get("width")).toBe("96");
    expect(out.searchParams.get("height")).toBe("96");
    expect(out.searchParams.get("resize")).toBe("cover");
    expect(out.pathname).toContain("/render/image/public/");
  });

  it("respektuje jawny dpr", () => {
    expect(new URL(buildAvatarSrc(OBJ, 48, 3)).searchParams.get("width")).toBe("144");
    expect(new URL(buildAvatarSrc(OBJ, 48, 1)).searchParams.get("width")).toBe("48");
  });

  it("nie schodzi poniżej 32 px boku", () => {
    // Awatary 16 px (SimpleWidgets) przy dpr 1 dałyby wariant 16×16 - poniżej
    // progu, przy którym transformacja w ogóle ma sens.
    expect(new URL(buildAvatarSrc(OBJ, 16, 1)).searchParams.get("width")).toBe("32");
    expect(new URL(buildAvatarSrc(OBJ, 4, 1)).searchParams.get("width")).toBe("32");
  });

  it("zaokrągla bok do pełnego piksela", () => {
    expect(new URL(buildAvatarSrc(OBJ, 25, 1.5)).searchParams.get("width")).toBe("38");
  });

  it("adres spoza Storage i pusty wracają bez zmian", () => {
    expect(buildAvatarSrc(EXT, 48)).toBe(EXT);
    expect(buildAvatarSrc("", 48)).toBe("");
  });
});

describe("buildAvatarSrcSet", () => {
  it("emituje warianty 1x/2x/3x z deskryptorem gęstości", () => {
    const parts = buildAvatarSrcSet(OBJ, 48).split(", ");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/ 1x$/);
    expect(parts[2]).toMatch(/ 3x$/);
    expect(new URL(parts[2].split(" ")[0]).searchParams.get("width")).toBe("144");
  });

  it("oddaje pusty łańcuch dla adresów, których nie umiemy skalować", () => {
    // Pusty srcSet pozwala wywołującemu pominąć atrybut - lepsze niż zestaw
    // kandydatów prowadzących do tego samego, nieskalowanego pliku.
    expect(buildAvatarSrcSet(EXT, 48)).toBe("");
    expect(buildAvatarSrcSet("", 48)).toBe("");
  });
});

describe("listCropSizes", () => {
  it("sortuje po pozycji, a potem po nazwie", () => {
    // Kolejność jest widoczna w adminie i w selektorze rozmiaru - bez drugiego
    // klucza rozmiary o tej samej pozycji skakałyby między odświeżeniami.
    stub().setResponse("custom_crop_sizes", ok([]));
    return listCropSizes().then(() => {
      const chain = stub().lastChain("custom_crop_sizes");
      const orders = chain?.calls.filter((c) => c.method === "order").map((c) => c.args[0]);
      expect(orders).toEqual(["position", "name"]);
    });
  });

  it("bez tenanta NIE dokłada filtra - lista jest wtedy zawężana przez RLS", async () => {
    stub().setResponse("custom_crop_sizes", ok([]));
    await listCropSizes();
    expect(stub().lastChain("custom_crop_sizes")?.has("eq")).toBe(false);
  });

  it("z tenantem zawęża jawnie", async () => {
    stub().setResponse("custom_crop_sizes", ok([]));
    await listCropSizes(TENANT);
    expect(stub().lastChain("custom_crop_sizes")?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
  });

  it("pusta odpowiedź daje pustą listę, nie null", async () => {
    stub().setResponse("custom_crop_sizes", ok(null));
    expect(await listCropSizes()).toEqual([]);
  });

  it("błąd zapytania wychodzi na wierzch", async () => {
    stub().setResponse("custom_crop_sizes", fail("brak dostępu"));
    await expect(listCropSizes()).rejects.toThrow("brak dostępu");
  });

  it("oddaje wiersze w kształcie CropSize", async () => {
    const row: CropSize = {
      id: "cs-1",
      tenant_id: TENANT,
      name: "Karta",
      ratio_w: 16,
      ratio_h: 9,
      width: 640,
      height: 360,
      position: 1,
    };
    stub().setResponse("custom_crop_sizes", ok([row]));
    expect(await listCropSizes()).toEqual([row]);
  });
});

describe("upsertCropSize", () => {
  const draft = {
    name: "Karta",
    ratio_w: 16,
    ratio_h: 9,
    width: 640,
    height: 360,
    position: 1,
  };

  it("dokleja tenant_id z argumentu, nie z wersji roboczej", async () => {
    // Klient nie może zadeklarować cudzego tenanta w treści formularza.
    stub().setResponse("custom_crop_sizes", ok({ id: "cs-1", tenant_id: TENANT, ...draft }));
    await upsertCropSize(TENANT, draft);
    expect(stub().lastChain("custom_crop_sizes")?.argsOf("upsert")?.[0]).toMatchObject({
      tenant_id: TENANT,
      name: "Karta",
    });
  });

  it("błąd zapisu wychodzi na wierzch", async () => {
    stub().setResponse("custom_crop_sizes", fail("konflikt unikalności"));
    await expect(upsertCropSize(TENANT, draft)).rejects.toThrow("konflikt unikalności");
  });
});

describe("deleteCropSize", () => {
  it("kasuje dokładnie jeden wiersz po identyfikatorze", async () => {
    stub().setResponse("custom_crop_sizes", ok(null));
    await deleteCropSize("cs-1");
    const chain = stub().lastChain("custom_crop_sizes");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", "cs-1"]);
  });

  it("błąd kasowania wychodzi na wierzch", async () => {
    stub().setResponse("custom_crop_sizes", fail("wiersz w użyciu"));
    await expect(deleteCropSize("cs-1")).rejects.toThrow("wiersz w użyciu");
  });
});
