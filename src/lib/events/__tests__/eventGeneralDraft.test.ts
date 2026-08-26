// Testy wersji roboczej ekranu „Informacje ogolne" studia wydarzenia.
//
// SPRAWDZAMY REGULY, KTORE STOJA TAKZE W BAZIE. Kazda taka regula ma dwa
// miejsca zycia (CHECK w migracji i funkcja czysta tutaj), a dwa miejsca
// rozjezdzaja sie w ciszy - dopoki redaktor nie zobaczy surowego 23514 zamiast
// zdania po polsku. Test jest jedynym miejscem, w ktorym obie strony kontraktu
// da sie zestawic bez DOM-u i bez bazy.
import { describe, expect, it } from "vitest";
import {
  clearEventLocation,
  eventAddressLine,
  eventGeneralDirty,
  eventGeneralDraftFromRow,
  eventGeneralPayload,
  eventGeneralWarnings,
  parseVideoId,
  validateEventGeneralDraft,
  videoEmbedUrl,
  type EventGeneralDraft,
} from "@/lib/events/eventGeneralDraft";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

/** Szkic, ktory przechodzi walidacje - punkt odniesienia dla wszystkich prob. */
const VALID: EventGeneralDraft = {
  titlePl: "Kongres Nowych Strategii",
  titleEn: "New Strategies Congress",
  slug: "kongres-2026",
  startsAt: "2026-09-14T08:00:00.000Z",
  endsAt: "2026-09-15T16:00:00.000Z",
  timezone: "Europe/Warsaw",
  coverUrl: "https://example.org/cover.jpg",
  videoPlatform: "youtube",
  videoId: "",
  format: "onsite",
  location: "Centrum Kongresowe",
  streetAddress: "Krucza 1",
  city: "Warszawa",
  region: "mazowieckie",
  postalCode: "00-001",
  country: "Polska",
  descriptionPl: "Opis wydarzenia.",
  descriptionEn: "Event description.",
  socialHashtag: "NES2026",
  languages: ["pl", "en"],
  supportEmail: "kontakt@example.org",
};

function draft(patch: Partial<EventGeneralDraft>): EventGeneralDraft {
  return { ...VALID, ...patch };
}

function fields(patch: Partial<EventGeneralDraft>): string[] {
  return validateEventGeneralDraft(draft(patch)).map((error) => error.field);
}

describe("walidacja informacji ogolnych", () => {
  it("poprawny szkic nie zglasza zadnego bledu", () => {
    expect(validateEventGeneralDraft(VALID)).toEqual([]);
  });

  it("wymaga tytulu w OBU jezykach osobno", () => {
    expect(fields({ titlePl: "   " })).toEqual(["titlePl"]);
    expect(fields({ titleEn: "" })).toEqual(["titleEn"]);
    expect(fields({ titlePl: "", titleEn: "" })).toEqual(["titlePl", "titleEn"]);
  });

  it("odrzuca slug niepasujacy do wzorca ^[a-z0-9-]{3,120}$", () => {
    expect(fields({ slug: "" })).toContain("slug");
    expect(fields({ slug: "ab" })).toContain("slug");
    expect(fields({ slug: "Kongres-2026" })).toContain("slug");
    expect(fields({ slug: "kongres 2026" })).toContain("slug");
    expect(fields({ slug: "kongres_2026" })).toContain("slug");
    expect(fields({ slug: "a".repeat(121) })).toContain("slug");
  });

  it("przyjmuje slug na obu granicach dlugosci", () => {
    expect(fields({ slug: "abc" })).toEqual([]);
    expect(fields({ slug: "a".repeat(120) })).toEqual([]);
  });

  it("wymaga daty poczatku", () => {
    expect(fields({ startsAt: "" })).toContain("startsAt");
    expect(fields({ startsAt: "   " })).toContain("startsAt");
  });

  it("nie przepuszcza konca rownego poczatkowi ani wczesniejszego", () => {
    expect(fields({ endsAt: VALID.startsAt })).toEqual(["endsAt"]);
    expect(fields({ endsAt: "2026-09-13T08:00:00.000Z" })).toEqual(["endsAt"]);
  });

  it("koniec pozniejszy niz poczatek NIE jest bledem", () => {
    expect(fields({ endsAt: "2026-09-14T08:00:00.001Z" })).toEqual([]);
    expect(fields({ endsAt: "" })).toEqual([]);
  });

  it("wymaga strefy czasowej", () => {
    expect(fields({ timezone: "  " })).toContain("timezone");
  });

  it("zglasza brak okladki przy naglowku wideo NA POLU okladki", () => {
    // Regula blizniacza do warunku bazy `events_video_header_requires_cover`:
    // naglowek wideo nie zwalnia z obrazu, bo miniatura w katalogu, w karcie
    // spolecznosciowej i w e-mailu nadal bierze sie z okladki. Blad musi
    // wskazywac `coverUrl` - tam redaktor ma cos zrobic, nie przy polu wideo.
    const errors = validateEventGeneralDraft(draft({ videoId: "ABC123", coverUrl: "" }));
    expect(errors.map((error) => error.field)).toEqual(["coverUrl"]);
    expect(errors[0]?.messageKey).toBe("adminEvents.general.errors.coverRequiredForVideo");
  });

  it("nie zglasza nic, gdy naglowek wideo ma okladke albo gdy wideo nie ma", () => {
    expect(fields({ videoId: "ABC123", coverUrl: "https://example.org/c.jpg" })).toEqual([]);
    expect(fields({ videoId: "", coverUrl: "" })).toEqual([]);
  });

  it("odrzuca hashtag ze spacja albo z krzyzykiem w srodku", () => {
    expect(fields({ socialHashtag: "NES 2026" })).toContain("socialHashtag");
    expect(fields({ socialHashtag: "NES#2026" })).toContain("socialHashtag");
    expect(fields({ socialHashtag: "NES-2026" })).toContain("socialHashtag");
    expect(fields({ socialHashtag: "x".repeat(61) })).toContain("socialHashtag");
  });

  // Krzyzyk wiodacy PRZECHODZI: jest prezentacja, nie trescia, wiec wklejenie
  // „#NES2026" ma sie udac, a nie zapalac blad. Walidacja patrzy na to samo, co
  // zapisze `eventGeneralPayload` (ten sam `replace(/^#+/, "")`).
  it("przepuszcza wklejony krzyzyk wiodacy, bo payload i tak go obcina", () => {
    expect(fields({ socialHashtag: "#NES2026" })).toEqual([]);
    expect(eventGeneralPayload("id", draft({ socialHashtag: "#NES2026" }))["social_hashtag"]).toBe(
      "NES2026",
    );
  });

  it("przyjmuje hashtag z litera, cyfra i podkresleniem", () => {
    expect(fields({ socialHashtag: "NES_2026" })).toEqual([]);
    expect(fields({ socialHashtag: "" })).toEqual([]);
  });

  it("odrzuca e-mail wsparcia bez domeny", () => {
    expect(fields({ supportEmail: "kontakt@example" })).toContain("supportEmail");
    expect(fields({ supportEmail: "kontakt" })).toContain("supportEmail");
    expect(fields({ supportEmail: "kontakt @example.org" })).toContain("supportEmail");
    expect(fields({ supportEmail: "" })).toEqual([]);
  });

  it("wymaga co najmniej jednego jezyka tresci", () => {
    expect(fields({ languages: [] })).toEqual(["languages"]);
  });
});

describe("ostrzezenia informacji ogolnych", () => {
  it("upomina sie o adres dla formatu stacjonarnego i hybrydowego", () => {
    const bezAdresu = { city: "", streetAddress: "" };
    expect(eventGeneralWarnings(draft({ ...bezAdresu, format: "onsite" }))).toContain(
      "adminEvents.general.warnings.addressMissing",
    );
    expect(eventGeneralWarnings(draft({ ...bezAdresu, format: "hybrid" }))).toContain(
      "adminEvents.general.warnings.addressMissing",
    );
  });

  it("NIE upomina sie o adres dla wydarzenia online", () => {
    expect(
      eventGeneralWarnings(draft({ city: "", streetAddress: "", format: "online" })),
    ).not.toContain("adminEvents.general.warnings.addressMissing");
  });

  it("uznaje sama ulice albo samo miasto za adres wystarczajacy do ciszy", () => {
    expect(eventGeneralWarnings(draft({ city: "Warszawa", streetAddress: "" }))).not.toContain(
      "adminEvents.general.warnings.addressMissing",
    );
    expect(eventGeneralWarnings(draft({ city: "", streetAddress: "Krucza 1" }))).not.toContain(
      "adminEvents.general.warnings.addressMissing",
    );
  });

  it("upomina sie o okladke, gdy pole jest puste", () => {
    expect(eventGeneralWarnings(draft({ coverUrl: "  " }))).toContain(
      "adminEvents.general.warnings.coverMissing",
    );
    expect(eventGeneralWarnings(VALID)).not.toContain("adminEvents.general.warnings.coverMissing");
  });

  it("o bardzo dlugim wydarzeniu mowi dopiero POWYZEJ 30 dni", () => {
    // Granica pilnuje literowki w roku daty konca - ale kongres trwajacy
    // miesiac jest mozliwy, wiec rowne 30 dni musi milczec.
    const trzydziesci = draft({
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-01-31T00:00:00.000Z",
    });
    const trzydziesciJeden = draft({
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-02-01T00:00:00.000Z",
    });
    expect(eventGeneralWarnings(trzydziesci)).not.toContain(
      "adminEvents.general.warnings.veryLong",
    );
    expect(eventGeneralWarnings(trzydziesciJeden)).toContain(
      "adminEvents.general.warnings.veryLong",
    );
  });

  it("milczy o dlugosci, gdy daty nie da sie odczytac", () => {
    expect(
      eventGeneralWarnings(draft({ startsAt: "nie-data", endsAt: "tez-nie-data" })),
    ).not.toContain("adminEvents.general.warnings.veryLong");
  });

  it("poprawny szkic nie generuje zadnego ostrzezenia", () => {
    expect(eventGeneralWarnings(VALID)).toEqual([]);
  });
});

describe("ladunek zapisu informacji ogolnych", () => {
  it("zapisuje hashtag BEZ krzyzyka, nawet gdy w polu byl", () => {
    const payload = eventGeneralPayload(EVENT_ID, draft({ socialHashtag: "#NES2026" }));
    expect(payload["social_hashtag"]).toBe("NES2026");
    expect(
      eventGeneralPayload(EVENT_ID, draft({ socialHashtag: "  ##NES2026  " }))["social_hashtag"],
    ).toBe("NES2026");
  });

  it("sprowadza e-mail wsparcia do malych liter", () => {
    expect(
      eventGeneralPayload(EVENT_ID, draft({ supportEmail: "  Kontakt@Example.ORG " }))[
        "support_email"
      ],
    ).toBe("kontakt@example.org");
  });

  it("puste pole identyfikatora wideo zeruje TAKZE platforme", () => {
    // Inaczej w bazie zostaje `video_header_platform = 'vimeo'` bez materialu,
    // czyli stan, ktorego ekran nie umie odtworzyc.
    const payload = eventGeneralPayload(
      EVENT_ID,
      draft({ videoId: "   ", videoPlatform: "vimeo" }),
    );
    expect(payload["video_header_id"]).toBe("");
    expect(payload["video_header_platform"]).toBe("");
  });

  it("zachowuje platforme, gdy identyfikator wideo jest podany", () => {
    const payload = eventGeneralPayload(
      EVENT_ID,
      draft({ videoId: " 123456 ", videoPlatform: "vimeo" }),
    );
    expect(payload["video_header_id"]).toBe("123456");
    expect(payload["video_header_platform"]).toBe("vimeo");
  });

  it("normalizuje jezyki: bez duplikatow, malymi literami, posortowane", () => {
    expect(
      eventGeneralPayload(EVENT_ID, draft({ languages: [" PL ", "en", "pl", "DE"] }))["languages"],
    ).toEqual(["de", "en", "pl"]);
  });

  it("obcina biale znaki we wszystkich polach tekstowych i schodzi ze slugiem do malych liter", () => {
    const payload = eventGeneralPayload(
      EVENT_ID,
      draft({
        titlePl: "  Kongres  ",
        titleEn: "  Congress  ",
        slug: "  Kongres-2026  ",
        city: "  Warszawa  ",
        descriptionPl: "  Opis.  ",
      }),
    );
    expect(payload["title_pl"]).toBe("Kongres");
    expect(payload["title_en"]).toBe("Congress");
    expect(payload["slug"]).toBe("kongres-2026");
    expect(payload["city"]).toBe("Warszawa");
    expect(payload["description_pl"]).toBe("Opis.");
  });

  it("niesie identyfikator wydarzenia pod kluczem `id`", () => {
    expect(eventGeneralPayload(EVENT_ID, VALID)["id"]).toBe(EVENT_ID);
  });
});

describe("wykrycie zmian wersji roboczej", () => {
  it("roznica wylacznie w bialych znakach NIE jest zmiana", () => {
    // Sens tej funkcji: przycisk „Zapisz" ma sie budzic wtedy, gdy zmieni sie
    // to, CO POJEDZIE do bazy - a payload i tak obcina biale znaki.
    expect(eventGeneralDirty(VALID, draft({ titlePl: `  ${VALID.titlePl}  ` }))).toBe(false);
    expect(eventGeneralDirty(VALID, draft({ supportEmail: " Kontakt@Example.org " }))).toBe(false);
  });

  it("inna kolejnosc tych samych jezykow NIE jest zmiana", () => {
    expect(eventGeneralDirty(VALID, draft({ languages: ["en", "pl", "pl"] }))).toBe(false);
  });

  it("realna roznica jest zmiana", () => {
    expect(eventGeneralDirty(VALID, draft({ titlePl: "Kongres Nowych Strategii 2027" }))).toBe(
      true,
    );
    expect(eventGeneralDirty(VALID, draft({ languages: ["pl"] }))).toBe(true);
    expect(eventGeneralDirty(VALID, draft({ format: "online" }))).toBe(true);
  });

  it("ten sam szkic nie jest brudny wzgledem samego siebie", () => {
    expect(eventGeneralDirty(VALID, { ...VALID })).toBe(false);
  });
});

describe("identyfikator materialu wideo", () => {
  it("goly identyfikator przechodzi bez zmian", () => {
    expect(parseVideoId("ABC123", "youtube")).toBe("ABC123");
    expect(parseVideoId("  ABC123  ", "youtube")).toBe("ABC123");
    expect(parseVideoId("", "youtube")).toBe("");
  });

  it("wyciaga identyfikator z adresu YouTube w obu postaciach", () => {
    expect(parseVideoId("https://www.youtube.com/watch?v=ABC123", "youtube")).toBe("ABC123");
    expect(parseVideoId("https://youtu.be/ABC123", "youtube")).toBe("ABC123");
    expect(parseVideoId("https://www.youtube.com/watch?v=ABC123&t=42", "youtube")).toBe("ABC123");
  });

  it("wyciaga identyfikator z adresu Vimeo", () => {
    expect(parseVideoId("https://vimeo.com/123456", "vimeo")).toBe("123456");
    expect(parseVideoId("https://vimeo.com/123456/", "vimeo")).toBe("123456");
  });

  it("smiec niebedacy adresem wraca bez zmian, zamiast rzucac", () => {
    expect(parseVideoId("to nie jest adres", "youtube")).toBe("to nie jest adres");
    expect(parseVideoId("???", "vimeo")).toBe("???");
  });
});

describe("adres osadzenia naglowka wideo", () => {
  it("zwraca null, gdy naglowka wideo nie ma", () => {
    expect(videoEmbedUrl("youtube", "")).toBeNull();
    expect(videoEmbedUrl("youtube", "   ")).toBeNull();
    expect(videoEmbedUrl("vimeo", "")).toBeNull();
  });

  it("zwraca null dla identyfikatora ze znakami spoza [A-Za-z0-9_-]", () => {
    // To jest zabezpieczenie przed wstrzyknieciem do atrybutu `src`: adres
    // powstaje przez sklejenie napisu, wiec identyfikator musi byc zamkniety
    // w alfabecie, ktory nie potrafi wyjsc z atrybutu ani z domeny.
    expect(videoEmbedUrl("youtube", 'ABC" onload="alert(1)')).toBeNull();
    expect(videoEmbedUrl("youtube", "../../evil")).toBeNull();
    expect(videoEmbedUrl("youtube", "ABC?autoplay=1")).toBeNull();
    expect(videoEmbedUrl("vimeo", "123456#x")).toBeNull();
    expect(videoEmbedUrl("youtube", "a".repeat(65))).toBeNull();
  });

  it("sklada adres osadzenia dla obu platform", () => {
    expect(videoEmbedUrl("youtube", "ABC_123-x")).toBe(
      "https://www.youtube-nocookie.com/embed/ABC_123-x",
    );
    expect(videoEmbedUrl("vimeo", " 123456 ")).toBe("https://player.vimeo.com/video/123456");
  });
});

describe("adres w jednej linii i czyszczenie lokalizacji", () => {
  it("skleja kod pocztowy z miastem w JEDEN czlon", () => {
    expect(eventAddressLine(VALID)).toBe("Krucza 1, 00-001 Warszawa, mazowieckie, Polska");
  });

  it("pomija czlony puste, zamiast zostawiac przecinki", () => {
    expect(eventAddressLine(draft({ streetAddress: "", region: "", country: "" }))).toBe(
      "00-001 Warszawa",
    );
    expect(eventAddressLine(draft({ postalCode: "", region: "" }))).toBe(
      "Krucza 1, Warszawa, Polska",
    );
    expect(eventAddressLine(draft({ city: "", postalCode: "" }))).toBe(
      "Krucza 1, mazowieckie, Polska",
    );
  });

  it("bez zadnego czlonu daje pusty napis, a nie same przecinki", () => {
    expect(
      eventAddressLine(
        draft({ streetAddress: " ", city: " ", region: " ", postalCode: " ", country: " " }),
      ),
    ).toBe("");
  });

  it("czysci komplet szesciu pol lokalizacji", () => {
    const cleared = clearEventLocation(VALID);
    expect(cleared.location).toBe("");
    expect(cleared.streetAddress).toBe("");
    expect(cleared.city).toBe("");
    expect(cleared.region).toBe("");
    expect(cleared.postalCode).toBe("");
    expect(cleared.country).toBe("");
    expect(eventAddressLine(cleared)).toBe("");
  });

  it("NIE rusza reszty szkicu ani oryginalu", () => {
    const cleared = clearEventLocation(VALID);
    expect(cleared.titlePl).toBe(VALID.titlePl);
    expect(cleared.format).toBe(VALID.format);
    expect(cleared.startsAt).toBe(VALID.startsAt);
    expect(cleared.languages).toEqual(VALID.languages);
    expect(VALID.city).toBe("Warszawa");
  });
});

describe("szkic z wiersza RPC", () => {
  it("czyta komplet pol wiersza", () => {
    const draftFromRow = eventGeneralDraftFromRow({
      title_pl: "Kongres",
      title_en: "Congress",
      slug: "kongres-2026",
      starts_at: "2026-09-14T08:00:00.000Z",
      ends_at: "2026-09-15T16:00:00.000Z",
      timezone: "Europe/Warsaw",
      cover_url: "https://example.org/cover.jpg",
      video_header_platform: "vimeo",
      video_header_id: "123456",
      format: "hybrid",
      street_address: "Krucza 1",
      city: "Warszawa",
      postal_code: "00-001",
      languages: ["EN", "pl", "pl"],
      support_email: "kontakt@example.org",
    });
    expect(draftFromRow.titlePl).toBe("Kongres");
    expect(draftFromRow.videoPlatform).toBe("vimeo");
    expect(draftFromRow.format).toBe("hybrid");
    expect(draftFromRow.postalCode).toBe("00-001");
    expect(draftFromRow.languages).toEqual(["en", "pl"]);
  });

  it("nieznane pole degraduje do wartosci bezpiecznej, a nie wywraca ekranu", () => {
    const draftFromRow = eventGeneralDraftFromRow({
      title_pl: 42,
      video_header_platform: "tiktok",
      format: "kosmos",
      languages: "pl,en",
    });
    expect(draftFromRow.titlePl).toBe("");
    expect(draftFromRow.videoPlatform).toBe("youtube");
    expect(draftFromRow.format).toBe("onsite");
    expect(draftFromRow.languages).toEqual([]);
  });

  it("pusty wiersz daje szkic z pustymi polami, nie z undefined", () => {
    const draftFromRow = eventGeneralDraftFromRow({});
    expect(draftFromRow.slug).toBe("");
    expect(draftFromRow.coverUrl).toBe("");
    expect(draftFromRow.languages).toEqual([]);
    expect(draftFromRow.format).toBe("onsite");
  });
});
