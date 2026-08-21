// Zakładanie klubu - REGUŁY wyprowadzone z ciała `ClubCreateDialog`.
//
// CO TEN PLIK DOWODZI. Pięć rzeczy, które przed wyprowadzeniem dały się
// sprawdzić wyłącznie przez zamontowanie dialogu z atrapą zapytania
// o dostępność adresu i odczekaniem opóźnienia:
//
//   1. KOLEJNOŚĆ WARUNKÓW STANU ADRESU JEST TREŚCIĄ. Kolizja zgłoszona przy
//      ZAPISIE bije odpowiedź „wolny" leżącą w cache React Query; niezgodność
//      adresu z odpytanym znaczy „sprawdzam"; BRAK odpowiedzi znaczy
//      „sprawdzam", a nie „wolny". Domyślna zieleń pozwalałaby zapisać adres,
//      o którym nic nie wiadomo - i tego nie widać w recenzji, bo każda
//      z tych linijek osobno wygląda poprawnie.
//   2. WARUNEK WYSYŁKI ODCINA TRZY RÓŻNE POMYŁKI: nazwę zbyt krótką, adres
//      w stanie innym niż `free` (w tym `checking`) i drugie kliknięcie
//      w trakcie zapisu.
//   3. ZAJAWKA TRAFIA DO KOLUMNY JĘZYKA REDAKTORA, a druga zostaje `null` -
//      zapisanie tego samego tekstu w obu udawałoby tłumaczenie, którego nie ma.
//   4. PUSTE POLE JEDZIE JAKO `null`, NAZWA ANGIELSKA DZIEDZICZY PO POLSKIEJ,
//      a klub powstaje jako WERSJA ROBOCZA z rangą progu, nie z nazwą progu.
//   5. ODMOWA `slug_taken` ROBI DWIE RZECZY: wybiera napis i zostawia trwały
//      ślad przy polu adresu. Pozostałe kody robią tylko pierwszą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Słownika kodów odmowy - `toClubSaveError`
// ma własny test (`clubTypes.test.ts`); tutaj dowodzimy tylko ZŁOŻENIA klucza
// i skutku ubocznego. (2) Normalizacji adresu z nazwy - `clubSlugFromName`
// w `types.ts` ma swój test; tu sprawdzamy wyłącznie, KIEDY adres podąża za
// nazwą, a kiedy przestaje. (3) Odwzorowania progu planu na rangę -
// `planTiers.test.ts`. (4) Renderu pól i dialogu - `ClubCreateDialog.test.tsx`
// i `ClubDialogSlugRow.test.tsx`. (5) Tego, czy RPC przyjmie payload - to
// `admin_club_upsert` i pgTAP.
import { describe, expect, it } from "vitest";
import {
  CLUB_CREATE_MIN_NAME_LENGTH,
  CLUB_SLUG_MIN_LENGTH,
  canSubmitClubCreate,
  clubCreateEffectiveSlug,
  clubCreateFailure,
  clubCreatePayload,
  clubCreateSlugMark,
  clubCreateSlugMessage,
  clubCreateSlugState,
  nextClubSlugConflict,
  type ClubCreateFormValues,
  type ClubCreateSlugInput,
  type ClubCreateSlugState,
} from "../adminClubCreateForm";

/** Stan adresu: wszystko wolne, adres odpytany i odpowiedź „wolny". */
function stanAdresu(overrides: Partial<ClubCreateSlugInput> = {}): ClubCreateSlugInput {
  return {
    effectiveSlug: "klub-energetyczny",
    debouncedSlug: "klub-energetyczny",
    isFetching: false,
    available: true,
    serverConflict: null,
    ...overrides,
  };
}

/** Wartości formularza wypełnione minimalnie sensownie. */
function wartosci(overrides: Partial<ClubCreateFormValues> = {}): ClubCreateFormValues {
  return {
    slug: "klub-energetyczny",
    namePl: "Klub Energetyczny",
    nameEn: "",
    tagline: "",
    visibility: "members",
    joinPolicy: "request",
    attribution: "attributed",
    layout: "list",
    planTier: "pro",
    cover: "",
    topic: null,
    ...overrides,
  };
}

describe("clubCreateEffectiveSlug", () => {
  it("dopóki pole adresu nie zostało tknięte, adres podąża za nazwą", () => {
    expect(
      clubCreateEffectiveSlug({ slugTouched: false, slug: "cokolwiek", namePl: "Klub Łączności" }),
    ).toBe("klub-lacznosci");
  });

  it("po ręcznej edycji adres przestaje podążać za nazwą", () => {
    // Regresja, którą to łapie: poprawiony adres znikałby przy następnej
    // literze wpisanej w nazwę - czyli nie dałoby się go poprawić w ogóle.
    expect(
      clubCreateEffectiveSlug({ slugTouched: true, slug: "wlasny-adres", namePl: "Zupełnie Inna" }),
    ).toBe("wlasny-adres");
  });

  it("pusta nazwa daje pusty adres, a nie napis z myślnikiem", () => {
    expect(clubCreateEffectiveSlug({ slugTouched: false, slug: "", namePl: "   " })).toBe("");
  });
});

describe("clubCreateSlugState", () => {
  it("pusty adres to stan wejścia, nie odpowiedź serwera", () => {
    expect(clubCreateSlugState(stanAdresu({ effectiveSlug: "" }))).toBe("empty");
  });

  it.each([1, 2])("adres o długości %i jest zbyt krótki, żeby o niego pytać", (length) => {
    expect(length).toBeLessThan(CLUB_SLUG_MIN_LENGTH);
    expect(
      clubCreateSlugState(
        stanAdresu({ effectiveSlug: "a".repeat(length), debouncedSlug: "a".repeat(length) }),
      ),
    ).toBe("short");
  });

  it("adres o minimalnej długości JUŻ jest pytaniem do serwera", () => {
    expect(clubCreateSlugState(stanAdresu({ effectiveSlug: "abc", debouncedSlug: "abc" }))).toBe(
      "free",
    );
  });

  it("kolizja z ZAPISU bije odpowiedź „wolny” leżącą w cache", () => {
    // To jest wyścig, nie teoria: ktoś inny mógł zająć adres między
    // sprawdzeniem a kliknięciem. Odwrotna kolejność warunków pokazywałaby
    // zieloną fajkę przy adresie odrzuconym sekundę wcześniej.
    expect(
      clubCreateSlugState(stanAdresu({ available: true, serverConflict: "klub-energetyczny" })),
    ).toBe("taken");
  });

  it("kolizja pod INNYM adresem nie blokuje adresu bieżącego", () => {
    expect(clubCreateSlugState(stanAdresu({ serverConflict: "stary-adres" }))).toBe("free");
  });

  it("adres inny niż odpytany znaczy „sprawdzam”, choćby odpowiedź brzmiała „zajęty”", () => {
    expect(
      clubCreateSlugState(
        stanAdresu({ effectiveSlug: "nowy-adres", debouncedSlug: "stary-adres", available: false }),
      ),
    ).toBe("checking");
  });

  it("zapytanie w locie znaczy „sprawdzam”", () => {
    expect(clubCreateSlugState(stanAdresu({ isFetching: true }))).toBe("checking");
  });

  it("odpowiedź „zajęty” daje stan zajęty", () => {
    expect(clubCreateSlugState(stanAdresu({ available: false }))).toBe("taken");
  });

  it("BRAK odpowiedzi to „sprawdzam”, nie „wolny”", () => {
    // Regresja, którą to łapie: domyślna zieleń pozwoliłaby wysłać zapis
    // adresu, o którym nic nie wiadomo - a `canSubmit` przepuszcza tylko
    // stan `free`.
    expect(clubCreateSlugState(stanAdresu({ available: undefined }))).toBe("checking");
  });
});

describe("nextClubSlugConflict", () => {
  it("ślad kolizji znika, gdy adres się zmienił", () => {
    expect(nextClubSlugConflict("stary", "nowy")).toBeNull();
  });

  it("ślad kolizji zostaje, gdy adres się NIE zmienił", () => {
    expect(nextClubSlugConflict("stary", "stary")).toBe("stary");
  });

  it("brak śladu zostaje brakiem - efekt nie tworzy kolizji z niczego", () => {
    expect(nextClubSlugConflict(null, "nowy")).toBeNull();
  });
});

describe("clubCreateSlugMessage", () => {
  it("zajęty adres to komunikat BŁĘDU - czytnik ekranu ma go przeczytać", () => {
    expect(clubCreateSlugMessage("taken")).toEqual({
      key: "adminClubs.create.slugTaken",
      alert: true,
    });
  });

  it("wolny adres to potwierdzenie, nie alarm", () => {
    expect(clubCreateSlugMessage("free")).toEqual({
      key: "adminClubs.create.slugFree",
      alert: false,
    });
  });

  it.each<ClubCreateSlugState>(["empty", "short", "checking"])(
    "stan %s pokazuje neutralną podpowiedź o formacie adresu",
    (state) => {
      expect(clubCreateSlugMessage(state)).toEqual({
        key: "adminClubs.fields.slugHint",
        alert: false,
      });
    },
  );
});

describe("clubCreateSlugMark", () => {
  it("każdy znacznik widoczny NIESIE etykietę - ikona bez tekstu nie znaczy nic", () => {
    const WIDOCZNE: readonly ClubCreateSlugState[] = ["checking", "free", "taken"];
    for (const state of WIDOCZNE) {
      const descriptor = clubCreateSlugMark(state);
      if (descriptor.mark === "none") {
        throw new Error(`stan ${state} musi rysować znacznik`);
      }
      expect(descriptor.labelKey.length, state).toBeGreaterThan(0);
    }
  });

  it("stan sprawdzania rysuje wirujący znacznik z własną etykietą", () => {
    expect(clubCreateSlugMark("checking")).toEqual({
      mark: "spinner",
      labelKey: "adminClubs.create.slugChecking",
    });
  });

  it("wolny i zajęty mają RÓŻNE znaczniki i różne etykiety", () => {
    expect(clubCreateSlugMark("free")).toEqual({
      mark: "ok",
      labelKey: "adminClubs.create.slugFree",
    });
    expect(clubCreateSlugMark("taken")).toEqual({
      mark: "error",
      labelKey: "adminClubs.create.slugTaken",
    });
  });

  it.each<ClubCreateSlugState>(["empty", "short"])(
    "stan %s nie rysuje nic i nie mówi nic - miejsce jest tylko zarezerwowane",
    (state) => {
      expect(clubCreateSlugMark(state)).toEqual({ mark: "none" });
    },
  );
});

describe("canSubmitClubCreate", () => {
  it("nazwa i adres w porządku, zapis nie leci - wolno wysłać", () => {
    expect(canSubmitClubCreate({ namePl: "Klub", slugState: "free", isPending: false })).toBe(true);
  });

  it("nazwa krótsza niż minimum blokuje wysyłkę", () => {
    expect(CLUB_CREATE_MIN_NAME_LENGTH).toBe(3);
    expect(canSubmitClubCreate({ namePl: "Kl", slugState: "free", isPending: false })).toBe(false);
  });

  it("nazwa ze spacji to nazwa pusta - spacje nie liczą się do minimum", () => {
    expect(canSubmitClubCreate({ namePl: "  a  ", slugState: "free", isPending: false })).toBe(
      false,
    );
  });

  it.each<ClubCreateSlugState>(["empty", "short", "checking", "taken"])(
    "adres w stanie %s blokuje wysyłkę",
    (slugState) => {
      expect(canSubmitClubCreate({ namePl: "Klub", slugState, isPending: false })).toBe(false);
    },
  );

  it("trwający zapis blokuje DRUGIE kliknięcie", () => {
    // Regresja, którą to łapie: podwójny submit tworzy dwa kluby.
    expect(canSubmitClubCreate({ namePl: "Klub", slugState: "free", isPending: true })).toBe(false);
  });
});

describe("clubCreatePayload", () => {
  it("polski interfejs zapisuje zajawkę do kolumny polskiej, angielską zostawia pustą", () => {
    const payload = clubCreatePayload(wartosci({ tagline: "  Energia i klimat  " }), {
      writesPolish: true,
    });
    expect(payload.tagline_pl).toBe("Energia i klimat");
    expect(payload.tagline_en).toBeNull();
  });

  it("angielski interfejs zapisuje zajawkę do kolumny angielskiej, polską zostawia pustą", () => {
    // Zapisanie tego samego tekstu w obu kolumnach udawałoby tłumaczenie,
    // którego nie ma - `pickLocalized` cofa się do drugiego języka SAM.
    const payload = clubCreatePayload(wartosci({ tagline: "Energy and climate" }), {
      writesPolish: false,
    });
    expect(payload.tagline_en).toBe("Energy and climate");
    expect(payload.tagline_pl).toBeNull();
  });

  it.each([true, false])(
    "pusta zajawka jedzie jako null w OBU kolumnach (writesPolish=%s)",
    (writesPolish) => {
      const payload = clubCreatePayload(wartosci({ tagline: "   " }), { writesPolish });
      expect(payload.tagline_pl).toBeNull();
      expect(payload.tagline_en).toBeNull();
    },
  );

  it("nazwa angielska dziedziczy po polskiej, gdy pole jest puste", () => {
    const payload = clubCreatePayload(wartosci({ namePl: " Klub Energetyczny ", nameEn: "  " }), {
      writesPolish: true,
    });
    expect(payload.name_pl).toBe("Klub Energetyczny");
    expect(payload.name_en).toBe("Klub Energetyczny");
  });

  it("wpisana nazwa angielska NIE jest nadpisywana polską", () => {
    const payload = clubCreatePayload(wartosci({ nameEn: " Energy Club " }), {
      writesPolish: true,
    });
    expect(payload.name_en).toBe("Energy Club");
  });

  it("okładka i obszar tematyczny: pustka jedzie jako null, treść przycięta", () => {
    const puste = clubCreatePayload(wartosci({ cover: "  ", topic: null }), {
      writesPolish: true,
    });
    expect(puste.cover_image_url).toBeNull();
    expect(puste.policy_area).toBeNull();

    const pelne = clubCreatePayload(
      wartosci({ cover: " https://example.test/a.jpg ", topic: "energy" }),
      { writesPolish: true },
    );
    expect(pelne.cover_image_url).toBe("https://example.test/a.jpg");
    expect(pelne.policy_area).toBe("energy");
  });

  it("próg planu zapisuje się jako RANGA, a nie jako nazwa progu", () => {
    // Kolumna `min_tier_rank` jest liczbą i porównuje się ją nierównością;
    // nazwa progu jest wyłącznie etykietą droplisty.
    expect(
      clubCreatePayload(wartosci({ planTier: "free" }), { writesPolish: true }).min_tier_rank,
    ).toBe(0);
    expect(
      clubCreatePayload(wartosci({ planTier: "pro" }), { writesPolish: true }).min_tier_rank,
    ).toBe(20);
    expect(
      clubCreatePayload(wartosci({ planTier: "presidents_circle" }), { writesPolish: true })
        .min_tier_rank,
    ).toBe(60);
  });

  it("klub powstaje jako WERSJA ROBOCZA - zakładanie nie jest publikowaniem", () => {
    expect(clubCreatePayload(wartosci(), { writesPolish: true }).status).toBe("draft");
  });

  it("pełny kształt payloadu jedzie do RPC bez klucza `id` - to nowy klub", () => {
    const payload = clubCreatePayload(
      wartosci({
        slug: "klub-cyfrowy",
        namePl: "Klub Cyfrowy",
        nameEn: "Digital Club",
        tagline: "Regulacje cyfrowe",
        visibility: "private",
        joinPolicy: "invite",
        attribution: "chatham",
        layout: "magazine",
        planTier: "vip",
        cover: "https://example.test/c.png",
        topic: "digital",
      }),
      { writesPolish: true },
    );
    expect(payload).toEqual({
      slug: "klub-cyfrowy",
      name_pl: "Klub Cyfrowy",
      name_en: "Digital Club",
      tagline_pl: "Regulacje cyfrowe",
      tagline_en: null,
      visibility: "private",
      join_policy: "invite",
      attribution_mode: "chatham",
      layout: "magazine",
      min_tier_rank: 25,
      cover_image_url: "https://example.test/c.png",
      policy_area: "digital",
      status: "draft",
    });
    expect(payload.id).toBeUndefined();
  });

  it("adres jedzie do RPC BEZ przycinania - normalizacja stała się już w polu", () => {
    // Pole adresu przepuszcza tylko `[a-z0-9-]` (`clubSlugFromName`), więc
    // dodatkowe `trim()` tutaj tylko ukrywałoby błąd tamtej normalizacji.
    expect(clubCreatePayload(wartosci({ slug: "klub-x" }), { writesPolish: true }).slug).toBe(
      "klub-x",
    );
  });
});

describe("clubCreateFailure", () => {
  it("zajęty adres zostawia TRWAŁY ślad przy polu, bo naprawia się go jednym polem", () => {
    expect(clubCreateFailure(new Error("slug already taken"))).toEqual({
      key: "adminClubs.create.error.slug_taken",
      blocksSlug: true,
    });
  });

  it.each([
    ["tenant not resolved", "tenant_unresolved"],
    ["forbidden", "forbidden"],
    ["slug and name_pl are required", "missing_fields"],
    ["coś zupełnie innego", "unknown"],
  ])("odmowa „%s” składa klucz %s i NIE blokuje pola adresu", (message, code) => {
    expect(clubCreateFailure(new Error(message))).toEqual({
      key: `adminClubs.create.error.${code}`,
      blocksSlug: false,
    });
  });

  it("odmowa, która nie jest wyjątkiem, też ma swój klucz", () => {
    expect(clubCreateFailure("nie-wyjatek")).toEqual({
      key: "adminClubs.create.error.unknown",
      blocksSlug: false,
    });
  });
});
