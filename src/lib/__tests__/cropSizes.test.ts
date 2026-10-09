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
  IMAGE_QUALITY_SMALL,
  RESPONSIVE_IMAGE_QUALITY,
  SMALL_VARIANT_MAX_WIDTH,
  qualityForWidth,
  RESPONSIVE_WIDTHS,
  LEGACY_AVATAR_RESPONSIVE_WIDTHS,
  renderedMediaUrl,
  type CropSize,
} from "@/lib/cropSizes";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";

const OBJ = "https://proj.supabase.co/storage/v1/object/public/media/cover.jpg";
const RENDER = OBJ.replace("/object/", "/render/image/");
const EXT = "https://cdn.example.com/cover.jpg";
/** Obcy host z katalogiem `/media/` - kształt ścieżki jak nasz, host cudzy. */
const EXT_MEDIA = "https://cdn.example.com/media/cover.jpg";
/** Ten sam kształt ścieżki, ale na NASZYM origin - to jest adres markowy. */
const BRANDED = `${PUBLIC_MEDIA_ORIGIN}/media/cover.jpg`;
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

  // Marker `/media/` jest adresem MARKOWYM, więc liczy się tylko na naszym
  // origin. Wcześniej funkcja patrzyła na samą ścieżkę i mówiła „tak" także
  // obcemu hostowi z katalogiem `/media/` - a wtedy `buildImageSrcSet` doklejał
  // mu kandydatów `…/storage/v1/render/image/public/…`, których ten host nie
  // obsłuży. Przeglądarka wybiera kandydata po szerokości, więc pokazywała
  // martwy obrazek przy nienaruszonym `src`.
  it("marker `/media/` na OBCYM hoście to NIE jest Storage", () => {
    expect(isSupabaseStorageUrl(EXT_MEDIA)).toBe(false);
    expect(buildImageSrcSet(EXT_MEDIA)).toBe("");
    expect(buildAvatarSrcSet(EXT_MEDIA, 24)).toBe("");
  });

  it("ten sam kształt ścieżki na NASZYM origin nadal jest Storage", () => {
    expect(isSupabaseStorageUrl(BRANDED)).toBe(true);
    expect(buildImageSrcSet(BRANDED)).toContain("/media/cover.jpg?width=");
  });

  it("ścieżka WZGLĘDNA należy do tego serwisu, więc przechodzi", () => {
    // Aplikacja renderuje media właśnie ścieżką względną (`mediaRenderUrl`),
    // żeby świeżo wgrany plik działał w podglądzie przed publikacją trasy.
    expect(isSupabaseStorageUrl("/media/cover.jpg")).toBe(true);
    expect(buildImageSrcSet("/media/cover.jpg")).toContain("/media/cover.jpg?width=");
  });

  it("markery `/storage/v1/...` zostają bez warunku na host", () => {
    // Techniczny host magazynu bywa inny niż markowy i różni się per
    // środowisko, a te ścieżki są jednoznacznie supabase'owe.
    expect(
      isSupabaseStorageUrl("https://inny.supabase.co/storage/v1/object/public/media/a.jpg"),
    ).toBe(true);
    expect(
      isSupabaseStorageUrl("https://inny.supabase.co/storage/v1/render/image/public/media/a.jpg"),
    ).toBe(true);
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

  it("domyślna jakość idzie ze wspólnej reguły, nie z liczby wpisanej z palca", () => {
    // ZMIANA OCZEKIWANIA (F27): wcześniej każdy wariant dostawał IMAGE_QUALITY
    // (88). Teraz kandydaci ≤ 640 px jadą na 78 - to one są obrazem LCP na
    // telefonie, a artefakty przy takiej gęstości pikseli są niewidoczne.
    // Asercja celowo odwołuje się do `qualityForWidth`, a nie do literału:
    // pilnuje spójności URL-a z regułą, a nie konkretnej wartości.
    expect(new URL(buildScaledImageUrl(OBJ, 320)).searchParams.get("quality")).toBe(
      String(qualityForWidth(320)),
    );
    expect(new URL(buildScaledImageUrl(OBJ, 1280)).searchParams.get("quality")).toBe(
      String(qualityForWidth(1280)),
    );
  });

  it("jawna jakość wygrywa z regułą szerokościową", () => {
    // GalleryBlock prosi o 82 dla 1920 px - wywołujący wie lepiej i reguła nie
    // może mu tego nadpisać.
    expect(new URL(buildScaledImageUrl(OBJ, 320, 95)).searchParams.get("quality")).toBe("95");
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
  it("mały kandydat dostaje 76, duży 80 - jakość jest funkcją szerokości", () => {
    // Sedno F27: 9 kandydatów jechało na q88, także 320w. Najtańsze warianty
    // obsługują telefon, gdzie każde kilkadziesiąt kB przekłada się na LCP.
    const parts = buildImageSrcSet(OBJ, [320, 1280]).split(", ");
    expect(new URL(parts[0].split(" ")[0]).searchParams.get("quality")).toBe("76");
    expect(new URL(parts[1].split(" ")[0]).searchParams.get("quality")).toBe("80");
  });

  it("jawna jakość obowiązuje cały zestaw, bez różnicowania", () => {
    const parts = buildImageSrcSet(OBJ, [320, 1280], 91).split(", ");
    for (const part of parts) {
      expect(new URL(part.split(" ")[0]).searchParams.get("quality")).toBe("91");
    }
  });

  it("PARYTET: dwa wywołania z tymi samymi argumentami dają bajtowo ten sam łańcuch", () => {
    // Preload (`imagesrcset`) i renderowany `<img>` idą przez tę samą funkcję.
    // Gdyby jakość zależała od czegoś spoza argumentów (np. losowania albo
    // stanu modułu), preload pobierałby inny plik niż malowany - podwójny
    // transfer zamiast przyspieszenia.
    expect(buildImageSrcSet(OBJ)).toBe(buildImageSrcSet(OBJ, RESPONSIVE_WIDTHS));
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

  it("drabina 5 szerokości (P3.2a, HW-4, decyzja właściciela 2026-10-08)", () => {
    // ZMIANA OCZEKIWANIA (P3.2a): dawniej 9 szerokości [320 ... 2400]. Każdy
    // kandydat to ~120 B w HTML-u (img, preload, `Link`), a pośrednie warianty
    // dawały podwójne pobrania tej samej okładki na desktopie.
    expect([...RESPONSIVE_WIDTHS]).toEqual([480, 640, 768, 1280, 1920]);
  });

  it("żaden kandydat nie przekracza 2500 px - inaczej deskryptor kłamie", () => {
    // Supabase przycina szerokość transformacji do 2500 px, więc kandydat
    // „2560w" dostawał realnie 2500 px pod etykietą 2560 i na ekranach 2560+
    // przeglądarka wybierała wariant mniejszy niż deklarowany.
    expect(RESPONSIVE_WIDTHS.every((w) => w <= 2500)).toBe(true);
  });

  it("dawna drabina zostaje WYŁĄCZNIE dla zdjęć osób (awatary bez zmian)", () => {
    expect([...LEGACY_AVATAR_RESPONSIVE_WIDTHS]).toEqual([
      320, 480, 640, 768, 1024, 1280, 1536, 1920, 2400,
    ]);
  });
});

describe("renderedMediaUrl (P3.2a/P4.2: adresy względne tylko w renderze)", () => {
  it("kanoniczny `/media/...` -> ścieżka z zapytaniem i fragmentem", () => {
    expect(renderedMediaUrl(BRANDED)).toBe("/media/cover.jpg");
    expect(renderedMediaUrl(`${PUBLIC_MEDIA_ORIGIN}/media/a/b.jpg?width=640&quality=76#x`)).toBe(
      "/media/a/b.jpg?width=640&quality=76#x",
    );
  });

  it.each([
    ["inny origin z katalogiem /media/", EXT_MEDIA],
    ["origin najemcy", "https://najemca.example/media/cover.jpg"],
    ["host techniczny magazynu", OBJ],
    ["ścieżka już względna", "/media/cover.jpg"],
    ["kanoniczny poza /media/", `${PUBLIC_MEDIA_ORIGIN}/assets/logo.svg`],
    ["segment `..` wychodzący z /media/", `${PUBLIC_MEDIA_ORIGIN}/media/../admin/x.jpg`],
    ["origin z innym portem", `${PUBLIC_MEDIA_ORIGIN}:8443/media/cover.jpg`],
    ["dane logowania przed hostem", `https://u@${new URL(PUBLIC_MEDIA_ORIGIN).host}/media/x.jpg`],
    ["data:", "data:image/gif;base64,R0lGODlhAQABAAAAACw="],
    ["pusty", ""],
    ["śmieci", "nie-adres"],
  ])("%s: bez zmian", (_label, url) => {
    expect(renderedMediaUrl(url)).toBe(url);
  });
});

describe("buildImageSrcSet: adresy względne tylko na domyślnej drabinie", () => {
  it("kanoniczny adres markowy: 5 kandydatów, każdy względny `/media/`", () => {
    const parts = buildImageSrcSet(BRANDED).split(", ");
    expect(parts.map((part) => part.split(" ")[1])).toEqual([
      "480w",
      "640w",
      "768w",
      "1280w",
      "1920w",
    ]);
    for (const part of parts) expect(part.startsWith("/media/cover.jpg?width=")).toBe(true);
    expect(parts[1]).toBe("/media/cover.jpg?width=640&resize=contain&quality=76 640w");
  });

  it("host techniczny magazynu zostaje absolutny", () => {
    for (const part of buildImageSrcSet(OBJ).split(", ")) {
      expect(part.startsWith("https://proj.supabase.co/storage/v1/render/image/public/")).toBe(
        true,
      );
    }
  });

  it("własna drabina (miniatury, treść, mega menu) zostaje absolutna", () => {
    for (const part of buildImageSrcSet(BRANDED, [128, 256, 384]).split(", ")) {
      expect(part.startsWith(`${PUBLIC_MEDIA_ORIGIN}/media/cover.jpg?width=`)).toBe(true);
    }
  });

  it("STRAŻNIK WŁAŚCICIELA: dawna drabina awatara daje dawny `srcset` bajt w bajt", () => {
    // Literał z bazy fali (64dddffe, `buildImageSrcSet(BRANDED)` sprzed P3.2a).
    const q = (w: number) => (w <= 640 ? 76 : 80);
    const before = [320, 480, 640, 768, 1024, 1280, 1536, 1920, 2400]
      .map(
        (w) =>
          `https://neweuropeanstrategies.com/media/cover.jpg?width=${w}&resize=contain&quality=${q(w)} ${w}w`,
      )
      .join(", ");
    expect(buildImageSrcSet(BRANDED, LEGACY_AVATAR_RESPONSIVE_WIDTHS)).toBe(before);
  });
});

describe("IMAGE_QUALITY", () => {
  it("stoi na 88, nie na domyślnych 75", () => {
    // 75 dawało widoczne zmiękczenie: rozmyte twarze na awatarach i tekst na
    // okładkach. Stała jest decyzją jakościową, nie parametrem do zgadywania.
    expect(IMAGE_QUALITY).toBe(88);
  });
});

describe("qualityForWidth", () => {
  it("≤ 640 px używa 76, duże zdjęcia responsywne 80", () => {
    expect(qualityForWidth(320)).toBe(IMAGE_QUALITY_SMALL);
    expect(qualityForWidth(SMALL_VARIANT_MAX_WIDTH)).toBe(IMAGE_QUALITY_SMALL);
    expect(qualityForWidth(SMALL_VARIANT_MAX_WIDTH + 1)).toBe(RESPONSIVE_IMAGE_QUALITY);
    expect(qualityForWidth(2400)).toBe(RESPONSIVE_IMAGE_QUALITY);
  });

  it("próg jest domknięty od góry - 640 to jeszcze mały wariant", () => {
    // Granica leży na realnym breakpoincie z RESPONSIVE_WIDTHS, więc pomyłka
    // o jeden przesunęłaby cały wariant 640w na drugą stronę reguły.
    expect(SMALL_VARIANT_MAX_WIDTH).toBe(640);
    expect(RESPONSIVE_WIDTHS).toContain(SMALL_VARIANT_MAX_WIDTH);
  });

  it("jakość nigdy nie rośnie wraz ze zmniejszaniem wariantu", () => {
    // Monotoniczność: mniejszy kandydat nie może być droższy w bajtach na
    // piksel niż większy - inaczej srcSet przestaje mieć sens ekonomiczny.
    for (let i = 1; i < RESPONSIVE_WIDTHS.length; i += 1) {
      expect(qualityForWidth(RESPONSIVE_WIDTHS[i])).toBeGreaterThanOrEqual(
        qualityForWidth(RESPONSIVE_WIDTHS[i - 1]),
      );
    }
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
  it("STRAŻNIK WŁAŚCICIELA (P3.2a): awatar z adresu kanonicznego - dawne ciągi bajt w bajt", () => {
    // Decyzja właściciela 2026-10-08: awatary bez zmian (ani szerokości, ani
    // adresu absolutnego). Literały z bazy fali 64dddffe.
    const base = "https://neweuropeanstrategies.com/media/cover.jpg";
    expect(buildAvatarSrc(BRANDED, 48)).toBe(`${base}?width=96&height=96&resize=cover&quality=88`);
    expect(buildAvatarSrcSet(BRANDED, 48)).toBe(
      [
        `${base}?width=48&height=48&resize=cover&quality=88 1x`,
        `${base}?width=96&height=96&resize=cover&quality=88 2x`,
        `${base}?width=144&height=144&resize=cover&quality=88 3x`,
      ].join(", "),
    );
  });

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

it("does not send vector logos to the raster transformation service", () => {
  const svg = OBJ.replace("cover.jpg", "logo.svg");
  expect(buildScaledImageUrl(svg, 768)).toBe(svg);
  expect(buildImageSrcSet(svg)).toBe("");
});
