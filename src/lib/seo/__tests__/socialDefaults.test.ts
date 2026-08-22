// Kontrakt domyślnej karty społecznościowej: obrazek z /admin/settings/
// social-preview musi wygrywać z plikiem marki, być tenant-scoped (host) i
// nigdy nie nadpisywać własnej okładki strony.
import { describe, it, expect, beforeEach } from "vitest";
import { buildContentHead, buildRootHead, SITE_DEFAULT_OG_IMAGE } from "@/lib/seo/meta";
import {
  clearSocialDefaults,
  EMPTY_SOCIAL_DEFAULTS,
  rememberSocialDefaults,
  socialDefaultsFor,
  socialHostKey,
} from "@/lib/seo/socialDefaults";

const find = (meta: Array<Record<string, string>>, key: string, value: string) =>
  meta.find((m) => m[key] === value);

describe("domyślna karta społecznościowa", () => {
  beforeEach(() => clearSocialDefaults());

  it("bez ustawienia używa pliku marki", () => {
    const head = buildContentHead({
      url: "https://neweuropeanstrategies.com/",
      lang: "pl",
      type: "website",
      title: "T",
      description: "D",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      `https://neweuropeanstrategies.com${SITE_DEFAULT_OG_IMAGE}`,
    );
  });

  it("ustawiony obrazek wygrywa z plikiem marki (og + twitter)", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "https://cdn.example.com/card.jpg",
      imageAlt: "Karta marki",
    });
    const head = buildContentHead({
      url: "https://neweuropeanstrategies.com/blog",
      lang: "pl",
      type: "website",
      title: "T",
      description: "D",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      "https://cdn.example.com/card.jpg",
    );
    expect(find(head.meta, "name", "twitter:image")?.content).toBe(
      "https://cdn.example.com/card.jpg",
    );
  });

  it("okładka strony nadal wygrywa z domyślną kartą", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "https://cdn.example.com/card.jpg",
      imageAlt: "",
    });
    const head = buildContentHead({
      url: "https://neweuropeanstrategies.com/blog/a",
      lang: "pl",
      type: "article",
      title: "T",
      description: "D",
      image: "https://cdn.example.com/cover.jpg",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      "https://cdn.example.com/cover.jpg",
    );
  });

  it("nie przecieka między hostami tenantów", () => {
    rememberSocialDefaults("https://a.example", { imageUrl: "https://cdn/a.jpg", imageAlt: "" });
    const head = buildContentHead({
      url: "https://b.example/",
      lang: "en",
      type: "website",
      title: "T",
      description: "D",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      `https://b.example${SITE_DEFAULT_OG_IMAGE}`,
    );
  });

  it("root head emituje ustawiony obrazek i og:image:alt", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "https://cdn.example.com/card.jpg",
      imageAlt: "Karta marki",
    });
    const meta = buildRootHead("pl", "https://neweuropeanstrategies.com");
    expect(find(meta, "property", "og:image")?.content).toBe("https://cdn.example.com/card.jpg");
    expect(find(meta, "property", "og:image:alt")?.content).toBe("Karta marki");
  });

  it("ścieżka względna jest rozwijana do absolutnego URL", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "/uploads/og.png",
      imageAlt: "",
    });
    const meta = buildRootHead("en", "https://neweuropeanstrategies.com");
    expect(find(meta, "property", "og:image")?.content).toBe(
      "https://neweuropeanstrategies.com/uploads/og.png",
    );
  });
});

// Dopisane 22.08 (moduł 8, etap 4). Plik dowodził dotąd tylko ŚCIEŻKI ZDROWEJ
// przez `buildRootHead`/`buildContentHead`; niepokryte zostały dwie rzeczy,
// które decydują o poprawności w SSR: normalizacja klucza hosta (bo od niej
// zależy izolacja tenantów) i sufit wpisów (bo bez niego długo żyjący isolate
// rośnie w nieskończoność przy wielu domenach).
describe("socialHostKey - normalizacja klucza hosta", () => {
  it.each([
    [null, "no-host"],
    [undefined, "no-host"],
    ["", "no-host"],
    ["   ", "no-host"],
    ["NES.Example", "nes.example"],
    ["nes.example:8443", "nes.example"],
    ["https://nes.example/blog/x?y=1", "nes.example"],
    ["http://NES.example:3000", "nes.example"],
    ["en.nes.example", "en.nes.example"],
  ])("%j -> %j", (input, expected) => {
    expect(socialHostKey(input)).toBe(expected);
  });

  it.each([
    // Wejścia, na których `new URL` RZUCA - wchodzi gałąź `catch` z ręcznym
    // rozbiorem `raw.split("/")[0]?.split(":")[0]`. To nie jest teoretyczne:
    // nagłówek `host` bywa zniekształcony przez pośredniki, a klucz musi wtedy
    // nadal być DETERMINISTYCZNY, bo od niego zależy, czy tenant A nie dostanie
    // karty tenanta B.
    //
    // Wartości poniżej są ZMIERZONE, nie postulowane - ręczny rozbiór bierze
    // pierwszy segment przed `/` i przed `:`, więc dla zniekształconego adresu
    // kluczem zostaje SCHEMAT ("http", "https"). Jest to nadal deterministyczne
    // i nadal nie koliduje z żadnym realnym hostem, ale nie jest tym, czego
    // można się spodziewać po nazwie funkcji - dlatego stoi tu jawnie.
    ["http://", "http"],
    ["https://[niepoprawny", "https"],
    ["://nes.example", "no-host"],
    ["//", "no-host"],
    ["a:b:c/d", "a"],
    ["nes example", "nes example"],
  ])("wejście nie-URL %j daje zmierzony klucz %j", (input, expected) => {
    expect(socialHostKey(input)).toBe(expected);
  });

  it("adres, który PARSUJE SIĘ, ale nie ma hosta, spada na `no-host`", () => {
    // Gałąź `url.hostname || "no-host"`: `new URL("file://")` przechodzi bez
    // wyjątku, ale hostname jest pusty. Bez tego spadku kluczem byłby pusty
    // napis, a `Map` trzymałaby wpis, którego żaden odczyt po hoście nie
    // znajdzie - karta cicho wracałaby do fallbacku marki.
    expect(socialHostKey("file://")).toBe("no-host");
  });

  it("dwa RÓŻNE zniekształcone adresy o tym samym schemacie kolidują w jednym kluczu", () => {
    // Konsekwencja gałęzi `catch` wyżej, zapisana wprost: gdyby dwa tenanty
    // trafiły tu ze zniekształconym nagłówkiem `host` o tym samym schemacie,
    // dostałyby WSPÓLNY wpis pamięci. Nie jest to droga osiągalna z produkcji
    // (host jest wcześniej walidowany przez `trustedPublicHost`), ale kolizja
    // jest realna i ten test ją utrwala, żeby nie została odkryta przypadkiem.
    expect(socialHostKey("https://[a")).toBe(socialHostKey("https://[b"));
  });

  it("ten sam host w różnych zapisach trafia w JEDEN wpis pamięci", () => {
    // Sedno izolacji tenantów: gdyby „NES.Example:443" i „nes.example" były
    // dwoma kluczami, root loader zapamiętywałby kartę pod jednym, a builder
    // czytał drugi - i strona wracałaby do fallbacku marki bez żadnego błędu.
    clearSocialDefaults();
    rememberSocialDefaults("NES.Example:443", { imageUrl: "/a.png", imageAlt: "A" });
    expect(socialDefaultsFor("https://nes.example/blog").imageUrl).toBe("/a.png");
  });

  it("wartości są PRZYCINANE przy zapisie", () => {
    clearSocialDefaults();
    rememberSocialDefaults("nes.example", { imageUrl: "  /a.png  ", imageAlt: "  A  " });
    expect(socialDefaultsFor("nes.example")).toEqual({ imageUrl: "/a.png", imageAlt: "A" });
  });

  it("host bez wpisu oddaje pusty obiekt, nie undefined", () => {
    clearSocialDefaults();
    expect(socialDefaultsFor("nieznany.example")).toEqual(EMPTY_SOCIAL_DEFAULTS);
  });

  it("powtórny zapis tego samego hosta NADPISUJE i nie mnoży wpisów", () => {
    clearSocialDefaults();
    rememberSocialDefaults("nes.example", { imageUrl: "/stary.png", imageAlt: "stary" });
    rememberSocialDefaults("nes.example", { imageUrl: "/nowy.png", imageAlt: "nowy" });
    expect(socialDefaultsFor("nes.example").imageUrl).toBe("/nowy.png");
  });

  it("sufit 100 hostów usuwa NAJSTARSZY wpis, a nie najnowszy", () => {
    // Pętla eksmisji (`while (byHost.size > MAX_HOSTS)`) stała niepokryta.
    // Kolejność ma znaczenie: isolate obsługujący 150 domen musi trzymać te
    // NAJŚWIEŻSZE - eksmisja od końca wyrzucałaby host, który właśnie
    // odpowiada na żądanie.
    clearSocialDefaults();
    for (let i = 0; i < 105; i += 1) {
      rememberSocialDefaults(`host-${i}.example`, { imageUrl: `/i${i}.png`, imageAlt: "" });
    }
    // Pierwsze pięć wypadło (105 - 100), ostatnie zostały.
    expect(socialDefaultsFor("host-0.example")).toEqual(EMPTY_SOCIAL_DEFAULTS);
    expect(socialDefaultsFor("host-4.example")).toEqual(EMPTY_SOCIAL_DEFAULTS);
    expect(socialDefaultsFor("host-5.example").imageUrl).toBe("/i5.png");
    expect(socialDefaultsFor("host-104.example").imageUrl).toBe("/i104.png");
  });

  it("ponowny zapis ODŚWIEŻA pozycję hosta w kolejce eksmisji", () => {
    // `byHost.delete(key)` przed `set` istnieje właśnie po to. Bez tego host
    // odpytywany bez przerwy wypadałby po 100 nowych domenach, mimo że jest
    // najaktywniejszy.
    clearSocialDefaults();
    rememberSocialDefaults("staly.example", { imageUrl: "/staly.png", imageAlt: "" });
    for (let i = 0; i < 99; i += 1) {
      rememberSocialDefaults(`h${i}.example`, { imageUrl: `/h${i}.png`, imageAlt: "" });
    }
    rememberSocialDefaults("staly.example", { imageUrl: "/staly2.png", imageAlt: "" });
    for (let i = 0; i < 5; i += 1) {
      rememberSocialDefaults(`n${i}.example`, { imageUrl: `/n${i}.png`, imageAlt: "" });
    }
    expect(socialDefaultsFor("staly.example").imageUrl).toBe("/staly2.png");
  });
});
