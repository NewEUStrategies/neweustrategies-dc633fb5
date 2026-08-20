// Edytor działu klubu - REGUŁY wyprowadzone z ciała `ClubGroupEditorDialog`.
//
// CO TEN PLIK DOWODZI. Osiem rzeczy, które przed wyprowadzeniem dały się
// sprawdzić wyłącznie przez zamontowanie dialogu z piętnastoma polami:
//
//   1. DZIEDZICZENIE JEDZIE DO RPC JAKO PUSTY STRING (próg planu jako `null`),
//      a nie jako wartość widoczna w wyłączonej dropliście. Wysłanie wartości
//      efektywnej „przyklejałoby" ustawienie klubu do działu: pierwsza
//      późniejsza zmiana w klubie przestawałaby działać BEZ komunikatu.
//   2. ZDJĘCIE DZIEDZICZENIA WIDOCZNOŚCI SPROWADZA WARTOŚĆ W DÓŁ
//      (`public` -> `members`), bo CHECK `club_groups.visibility` nie zna
//      `public`: dział nie może być bardziej otwarty niż klub. To zawężenie
//      jest NIESYMETRYCZNE - obejmuje wyłącznie widoczność, a pozostałe cztery
//      ustawienia klient przepuszcza w obie strony.
//   3. WERSJA ROBOCZA DEGRADUJE WARTOŚCI Z RPC słownikiem, bo generator
//      Supabase typuje kolumny CHECK-owe jako goły `string`.
//   4. HARMONOGRAM PRZECHODZI W OBIE STRONY, a wartość niepoprawna daje PUSTE
//      pole i `null` w payloadzie - nie napis „Invalid Date".
//   5. PUSTE POLE OPISU JEDZIE JAKO `null`, a nazwa angielska dziedziczy po
//      polskiej.
//   6. WALIDACJA ODRZUCA pusty adres albo pustą nazwę polską i zwraca KLUCZ,
//      nie napis.
//   7. KASOWANIE MA TRZY RÓŻNE ODMOWY z trzema różnymi kluczami, a przycisk
//      jest wyłączony dokładnie wtedy, gdy odmowa jest PEWNA.
//   8. POTWIERDZENIE PO SKASOWANIU ma liczebnik tylko wtedy, gdy coś
//      przeniesiono - klucz bez form mnogich z doklejonym `count` zależałby od
//      kolejności wpisów w słowniku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Rozwiązywania dziedziczenia - robi to BAZA
// i zwraca kolumny `*_inherited`; `toGroupSettings` ma test w `clubTypes`.
// (2) Zawężania enumów - `narrowClubEnum` i `toClubGroupVisibility` mają własne
// testy; tu dowodzimy, że wersja robocza ich UŻYWA. (3) Renderu pól, dropList
// i okna potwierdzenia - `ClubGroupEditorDialog.test.tsx`,
// `ClubDialogInheritedEnum.test.tsx`. (4) Tego, czy RPC przyjmie payload -
// `admin_club_group_upsert` i pgTAP.
//
// DETERMINIZM STREFY. Testy harmonogramu nie zakładają strefy maszyny: pole
// `datetime-local` jest z definicji lokalne, więc dowodzimy OBROTU (ISO -> pole
// -> ISO) i formatu, a nie konkretnych cyfr.
import { describe, expect, it } from "vitest";
import { CLUB_BASE_ISO, clubGroupRow, clubIsoOffset } from "@/test/clubs/fixtures";
import type { ClubGroupRow } from "@/lib/clubs/types";
import {
  CLUB_GROUP_OVERRIDE_FIELDS,
  CLUB_GROUP_OVERRIDE_OPTIONS,
  canDeleteClubGroup,
  clubGroupDeleteConfirm,
  clubGroupDeleteErrorKey,
  clubGroupDeleteNotice,
  clubGroupDeletedToast,
  clubGroupHasThreads,
  clubGroupIsoFromLocalInput,
  clubGroupLocalInput,
  clubGroupMinTierFromInput,
  clubGroupMoveTargets,
  clubGroupOverridePatch,
  clubGroupSaveBlockKey,
  clubGroupSavePayload,
  clubGroupVisibilityOptions,
  toClubGroupDraft,
  type ClubGroupDraft,
  type ClubGroupDraftSource,
} from "../adminClubGroupForm";

const KLUB = "11111111-1111-4111-8111-111111111111";
const DZIAL = "22222222-2222-4222-8222-222222222222";

/** Wersja robocza w stanie „wszystko dziedziczone", czyli po świeżym odczycie. */
function robocza(overrides: Partial<ClubGroupDraft> = {}): ClubGroupDraft {
  return {
    slug: "dyskusje",
    namePl: "Dyskusje",
    nameEn: "Discussions",
    descriptionPl: "",
    descriptionEn: "",
    status: "active",
    visibility: "members",
    visibilityInherit: true,
    whoCanPost: "moderators",
    whoCanPostInherit: true,
    moderationMode: "trusted",
    moderationModeInherit: true,
    attributionMode: "attributed",
    attributionModeInherit: true,
    minTierRank: 20,
    minTierRankInherit: true,
    opensAt: "",
    closesAt: "",
    ...overrides,
  };
}

/** Wiersz działu z fixture'ów - kolumny CHECK-owe są tam gołym `string`iem. */
function wiersz(overrides: Partial<ClubGroupRow> = {}): ClubGroupRow {
  return clubGroupRow(overrides);
}

/**
 * Wiersz w kształcie, który moduł FAKTYCZNIE czyta. Osobny od fixture'a,
 * bo generator Supabase typuje kolumny opcjonalne jako `string`/`number`
 * (nigdy `null`), a `GroupInheritanceFields` w `types.ts` - już jako
 * nullowalne. Pustka kolumny jest więc realnym wejściem tego modułu i musi mieć
 * dowód: gołe `null` na ekranie formularza to najtańszy możliwy błąd.
 */
function zrodlo(overrides: Partial<ClubGroupDraftSource> = {}): ClubGroupDraftSource {
  return { ...clubGroupRow(), ...overrides };
}

describe("toClubGroupDraft", () => {
  it("przepisuje wiersz RPC na wersję roboczą i zawęża kolumny CHECK-owe", () => {
    // Fixture celowo trzyma wartości SPOZA słowników klienta (`published`
    // w statusie, `named` w atrybucji) - dokładnie tak, jak wygląda kolumna
    // typowana przez generator Supabase jako goły `string`.
    const draft = toClubGroupDraft(wiersz());
    expect(draft.slug).toBe("dyskusje");
    expect(draft.namePl).toBe("Dyskusje");
    expect(draft.nameEn).toBe("Discussions");
    expect(draft.status).toBe("draft");
    expect(draft.attributionMode).toBe("attributed");
    expect(draft.visibility).toBe("public");
    expect(draft.visibilityInherit).toBe(true);
  });

  it("status znany ze słownika przechodzi bez degradacji", () => {
    expect(toClubGroupDraft(wiersz({ status: "frozen" })).status).toBe("frozen");
  });

  it("brak opisu (null) daje PUSTE pole, nie napis „null”", () => {
    // To jest cały punkt: `?? ""` na obu kolumnach opisu. Bez tego pole
    // pokazywałoby gołe `null` w formularzu.
    const draft = toClubGroupDraft(zrodlo({ description_pl: null, description_en: null }));
    expect(draft.descriptionPl).toBe("");
    expect(draft.descriptionEn).toBe("");
  });

  it("opis obecny przechodzi wprost", () => {
    const draft = toClubGroupDraft(
      wiersz({ description_pl: "Opis polski", description_en: "English description" }),
    );
    expect(draft.descriptionPl).toBe("Opis polski");
    expect(draft.descriptionEn).toBe("English description");
  });

  it("brak terminu (null) daje puste pole harmonogramu", () => {
    const draft = toClubGroupDraft(zrodlo({ opens_at: null, closes_at: null }));
    expect(draft.opensAt).toBe("");
    expect(draft.closesAt).toBe("");
  });

  it("flagi dziedziczenia przechodzą z RPC 1:1 - klient reguły NIE powtarza", () => {
    const draft = toClubGroupDraft(
      wiersz({
        visibility: "private",
        visibility_inherited: false,
        who_can_post: "staff_only",
        who_can_post_inherited: false,
        moderation_mode: "pre",
        moderation_mode_inherited: false,
        attribution_mode: "chatham",
        attribution_mode_inherited: false,
        min_tier_rank: 40,
        min_tier_rank_inherited: false,
      }),
    );
    expect(draft).toMatchObject({
      visibility: "private",
      visibilityInherit: false,
      whoCanPost: "staff_only",
      whoCanPostInherit: false,
      moderationMode: "pre",
      moderationModeInherit: false,
      attributionMode: "chatham",
      attributionModeInherit: false,
      minTierRank: 40,
      minTierRankInherit: false,
    });
  });

  it("brak progu planu (null) schodzi do zera, nie do NaN", () => {
    expect(toClubGroupDraft(zrodlo({ min_tier_rank: null })).minTierRank).toBe(0);
  });
});

describe("clubGroupLocalInput / clubGroupIsoFromLocalInput", () => {
  it("obrót ISO -> pole -> ISO zachowuje moment z dokładnością do minuty", () => {
    expect(clubGroupIsoFromLocalInput(clubGroupLocalInput(CLUB_BASE_ISO))).toBe(CLUB_BASE_ISO);
  });

  it("pole ma format, którego oczekuje `datetime-local` - bez strefy i sekund", () => {
    expect(clubGroupLocalInput(CLUB_BASE_ISO)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("sekundy są ucinane - pole HTML i tak ich nie pokaże", () => {
    const zSekundami = "2026-08-18T10:00:37.500Z";
    expect(clubGroupLocalInput(zSekundami)).toBe(clubGroupLocalInput(CLUB_BASE_ISO));
    expect(clubGroupIsoFromLocalInput(clubGroupLocalInput(zSekundami))).toBe(CLUB_BASE_ISO);
  });

  it("różne momenty dają różne wartości pola - konwersja nie jest stała", () => {
    expect(clubGroupLocalInput(clubIsoOffset(90))).not.toBe(clubGroupLocalInput(CLUB_BASE_ISO));
  });

  it.each([
    ["null", null],
    ["pusty napis", ""],
    ["napis, który nie jest datą", "nie-data"],
  ])("wartość „%s” daje PUSTE pole, a nie napis „Invalid Date”", (_opis, value) => {
    expect(clubGroupLocalInput(value)).toBe("");
  });

  it.each([
    ["pustka", ""],
    ["same spacje", "   "],
    ["śmieć", "kiedyś-w-przyszłości"],
  ])("wartość pola „%s” jedzie do RPC jako null, nie jako Invalid Date", (_opis, value) => {
    expect(clubGroupIsoFromLocalInput(value)).toBeNull();
  });
});

describe("clubGroupSaveBlockKey", () => {
  it("wypełniony adres i nazwa polska nie blokują zapisu", () => {
    expect(clubGroupSaveBlockKey(robocza())).toBeNull();
  });

  it.each([
    ["pusty adres", { slug: "" }],
    ["adres ze samych spacji", { slug: "   " }],
    ["pusta nazwa polska", { namePl: "" }],
    ["nazwa polska ze samych spacji", { namePl: "  " }],
  ])("%s blokuje zapis kluczem, nie napisem", (_opis, overrides) => {
    expect(clubGroupSaveBlockKey(robocza(overrides))).toBe("adminClubs.requiredFields");
  });

  it("pusta nazwa ANGIELSKA zapisu NIE blokuje - dziedziczy po polskiej", () => {
    expect(clubGroupSaveBlockKey(robocza({ nameEn: "" }))).toBeNull();
  });
});

describe("clubGroupSavePayload", () => {
  it("wszystko dziedziczone jedzie jako PUSTY STRING, a próg planu jako null", () => {
    // Regresja, którą to łapie: wysłanie wartości efektywnej „przykleja"
    // ustawienie klubu do działu i pierwsza późniejsza zmiana w klubie
    // przestaje działać bez żadnego komunikatu.
    const payload = clubGroupSavePayload(robocza(), { id: DZIAL, clubId: KLUB });
    expect(payload).toMatchObject({
      id: DZIAL,
      club_id: KLUB,
      visibility: "",
      who_can_post: "",
      moderation_mode: "",
      attribution_mode: "",
      min_tier_rank: null,
    });
  });

  it("wszystko nadpisane jedzie z WARTOŚCIAMI, nie z pustkami", () => {
    const payload = clubGroupSavePayload(
      robocza({
        visibility: "private",
        visibilityInherit: false,
        whoCanPost: "staff_only",
        whoCanPostInherit: false,
        moderationMode: "pre",
        moderationModeInherit: false,
        attributionMode: "chatham",
        attributionModeInherit: false,
        minTierRank: 30,
        minTierRankInherit: false,
      }),
      { id: DZIAL, clubId: KLUB },
    );
    expect(payload).toMatchObject({
      visibility: "private",
      who_can_post: "staff_only",
      moderation_mode: "pre",
      attribution_mode: "chatham",
      min_tier_rank: 30,
    });
  });

  it("próg planu ZERO nadpisany jedzie jako 0, nie jako null", () => {
    // Granica, która łatwo ginie na `||`: 0 jest poprawnym progiem („każdy"),
    // a `null` znaczy „dziedzicz".
    const payload = clubGroupSavePayload(
      robocza({ minTierRank: 0, minTierRankInherit: false }),
      { id: DZIAL, clubId: KLUB },
    );
    expect(payload.min_tier_rank).toBe(0);
  });

  it("adres i nazwy są przycinane, a nazwa angielska dziedziczy po polskiej", () => {
    const payload = clubGroupSavePayload(
      robocza({ slug: " dyskusje ", namePl: " Dyskusje ", nameEn: "   " }),
      { id: DZIAL, clubId: KLUB },
    );
    expect(payload.slug).toBe("dyskusje");
    expect(payload.name_pl).toBe("Dyskusje");
    expect(payload.name_en).toBe("Dyskusje");
  });

  it("wpisana nazwa angielska NIE jest nadpisywana polską", () => {
    const payload = clubGroupSavePayload(robocza({ nameEn: " Discussions " }), {
      id: DZIAL,
      clubId: KLUB,
    });
    expect(payload.name_en).toBe("Discussions");
  });

  it("wyczyszczony opis jedzie jako null, wypełniony - przycięty", () => {
    const puste = clubGroupSavePayload(
      robocza({ descriptionPl: "   ", descriptionEn: "" }),
      { id: DZIAL, clubId: KLUB },
    );
    expect(puste.description_pl).toBeNull();
    expect(puste.description_en).toBeNull();

    const pelne = clubGroupSavePayload(
      robocza({ descriptionPl: " Opis ", descriptionEn: " Description " }),
      { id: DZIAL, clubId: KLUB },
    );
    expect(pelne.description_pl).toBe("Opis");
    expect(pelne.description_en).toBe("Description");
  });

  it("harmonogram jedzie jako ISO albo null - nigdy jako wartość pola HTML", () => {
    const wypelniony = clubGroupSavePayload(
      robocza({ opensAt: clubGroupLocalInput(CLUB_BASE_ISO), closesAt: "" }),
      { id: DZIAL, clubId: KLUB },
    );
    expect(wypelniony.opens_at).toBe(CLUB_BASE_ISO);
    expect(wypelniony.closes_at).toBeNull();
  });

  it("status wersji roboczej przechodzi wprost do payloadu", () => {
    expect(
      clubGroupSavePayload(robocza({ status: "archived" }), { id: DZIAL, clubId: KLUB }).status,
    ).toBe("archived");
  });
});

describe("clubGroupOverridePatch", () => {
  it("zdjęcie dziedziczenia widoczności SPROWADZA wartość klubu w dół", () => {
    // Klub publiczny pokazuje w dziedziczonej dropliście `public`, a CHECK
    // `club_groups.visibility` tej wartości nie zna. Bez zawężenia
    // administrator zapisywałby wybór, który baza odbija.
    expect(clubGroupOverridePatch("visibility", false, { visibility: "public" })).toEqual({
      visibilityInherit: false,
      visibility: "members",
    });
  });

  it("widoczność już mieszcząca się w słowniku działu zostaje bez zmiany", () => {
    expect(clubGroupOverridePatch("visibility", false, { visibility: "secret" })).toEqual({
      visibilityInherit: false,
      visibility: "secret",
    });
  });

  it("powrót do dziedziczenia widoczności NIE rusza wartości - i tak nie poleci", () => {
    expect(clubGroupOverridePatch("visibility", true, { visibility: "public" })).toEqual({
      visibilityInherit: true,
    });
  });

  it.each([true, false])(
    "pozostałe ustawienia przełączają TYLKO flagę (inherit=%s) - zawężenia tu NIE MA",
    (inherit) => {
      expect(clubGroupOverridePatch("whoCanPost", inherit, { visibility: "public" })).toEqual({
        whoCanPostInherit: inherit,
      });
      expect(clubGroupOverridePatch("moderationMode", inherit, { visibility: "public" })).toEqual({
        moderationModeInherit: inherit,
      });
      expect(clubGroupOverridePatch("attributionMode", inherit, { visibility: "public" })).toEqual({
        attributionModeInherit: inherit,
      });
      expect(clubGroupOverridePatch("minTierRank", inherit, { visibility: "public" })).toEqual({
        minTierRankInherit: inherit,
      });
    },
  );

  it("każde z pięciu ustawień dziedziczonych ma swoją łatkę", () => {
    // Nowe pole dopisane do tablicy bez gałęzi w `clubGroupOverridePatch`
    // milczałoby: przełącznik byłby widoczny i nic by nie robił.
    for (const field of CLUB_GROUP_OVERRIDE_FIELDS) {
      const patch = clubGroupOverridePatch(field, false, { visibility: "members" });
      expect(Object.keys(patch).length, field).toBeGreaterThan(0);
    }
  });
});

describe("clubGroupVisibilityOptions", () => {
  it("dziedziczenie pokazuje słownik KLUBU, bo wartość efektywna bywa publiczna", () => {
    expect(clubGroupVisibilityOptions(true)).toContain("public");
  });

  it("nadpisanie pokazuje węższy słownik DZIAŁU - bez wartości publicznej", () => {
    expect(clubGroupVisibilityOptions(false)).not.toContain("public");
    expect(clubGroupVisibilityOptions(false)).toEqual(["members", "private", "secret"]);
  });
});

describe("clubGroupMinTierFromInput", () => {
  it.each([
    ["7", 7],
    ["0", 0],
    ["", 0],
    ["abc", 0],
  ])("wartość pola „%s” daje %i - nigdy NaN", (raw, expected) => {
    expect(clubGroupMinTierFromInput(raw)).toBe(expected);
  });
});

describe("CLUB_GROUP_OVERRIDE_OPTIONS", () => {
  it("każda droplista nadpisania ma NIEPUSTY słownik", () => {
    expect(CLUB_GROUP_OVERRIDE_OPTIONS.whoCanPost.length).toBeGreaterThan(0);
    expect(CLUB_GROUP_OVERRIDE_OPTIONS.moderationMode.length).toBeGreaterThan(0);
    expect(CLUB_GROUP_OVERRIDE_OPTIONS.attributionMode.length).toBeGreaterThan(0);
  });
});

describe("clubGroupMoveTargets / clubGroupHasThreads", () => {
  it("kasowany dział nie jest celem przeniesienia własnych wątków", () => {
    const targets = clubGroupMoveTargets(
      [{ id: DZIAL }, { id: "inny-1" }, { id: "inny-2" }],
      DZIAL,
    );
    expect(targets.map((g) => g.id)).toEqual(["inny-1", "inny-2"]);
  });

  it("brak identyfikatora działu zostawia całą listę - nie ma czego odfiltrować", () => {
    expect(clubGroupMoveTargets([{ id: "a" }], undefined)).toHaveLength(1);
  });

  it.each([
    [4, true],
    [1, true],
    [0, false],
    [null, false],
    [undefined, false],
  ])("liczba wątków %s znaczy „ma wątki” = %s", (count, expected) => {
    expect(clubGroupHasThreads(count)).toBe(expected);
  });
});

describe("canDeleteClubGroup", () => {
  it("pusty dział z rodzeństwem wolno skasować", () => {
    expect(
      canDeleteClubGroup({ isPending: false, targetCount: 2, hasThreads: false, moveTo: "" }),
    ).toBe(true);
  });

  it("dział z wątkami i WSKAZANYM celem wolno skasować", () => {
    expect(
      canDeleteClubGroup({ isPending: false, targetCount: 2, hasThreads: true, moveTo: "inny" }),
    ).toBe(true);
  });

  it("dział z wątkami BEZ celu to pewna odmowa RPC - przycisk jest wyłączony", () => {
    expect(
      canDeleteClubGroup({ isPending: false, targetCount: 2, hasThreads: true, moveTo: "" }),
    ).toBe(false);
  });

  it("ostatni dział klubu jest nieusuwalny - klub bez działu nie przyjmie tematu", () => {
    expect(
      canDeleteClubGroup({ isPending: false, targetCount: 0, hasThreads: false, moveTo: "" }),
    ).toBe(false);
  });

  it("trwające kasowanie blokuje DRUGIE kliknięcie", () => {
    expect(
      canDeleteClubGroup({ isPending: true, targetCount: 2, hasThreads: false, moveTo: "" }),
    ).toBe(false);
  });
});

describe("clubGroupDeleteConfirm / clubGroupDeleteNotice", () => {
  it("dział z wątkami ostrzega o PRZENIESIENIU, pusty - o samym skasowaniu", () => {
    expect(clubGroupDeleteConfirm(true)).toEqual({
      titleKey: "adminClubs.groups.deleteConfirmTitle",
      descriptionKey: "adminClubs.groups.deleteConfirmMove",
    });
    expect(clubGroupDeleteConfirm(false)).toEqual({
      titleKey: "adminClubs.groups.deleteConfirmTitle",
      descriptionKey: "adminClubs.groups.deleteConfirmBody",
    });
  });

  it("napis strefy kasowania niesie LICZBĘ wątków tylko wtedy, gdy wątki są", () => {
    expect(clubGroupDeleteNotice(4)).toEqual({
      key: "adminClubs.groups.deleteWithThreads",
      count: 4,
    });
    expect(clubGroupDeleteNotice(0)).toEqual({
      key: "adminClubs.groups.deleteEmpty",
      count: null,
    });
  });

  it("brak liczby wątków czyta się jak zero, nie jak „nie wiem”", () => {
    expect(clubGroupDeleteNotice(null)).toEqual({
      key: "adminClubs.groups.deleteEmpty",
      count: null,
    });
    expect(clubGroupDeleteNotice(undefined).key).toBe("adminClubs.groups.deleteEmpty");
  });
});

describe("clubGroupDeletedToast", () => {
  it("przeniesione wątki dostają klucz z liczebnikiem", () => {
    expect(clubGroupDeletedToast(3)).toEqual({
      key: "adminClubs.groups.deletedWithMove",
      count: 3,
    });
  });

  it("brak przeniesień to klucz BEZ liczebnika", () => {
    // Doklejenie `count` do klucza bez form mnogich każe i18next szukać
    // `..._one`/`..._other` i cofać się do klucza bazowego - napis ten sam,
    // ale zależny od kolejności wpisów w słowniku.
    expect(clubGroupDeletedToast(0)).toEqual({ key: "adminClubs.groups.deleted", count: null });
  });
});

describe("clubGroupDeleteErrorKey", () => {
  it("dział z wątkami bez celu dostaje komunikat o WSKAZANIU celu", () => {
    expect(clubGroupDeleteErrorKey(new Error("group not empty"))).toBe(
      "adminClubs.groups.deleteNeedsTarget",
    );
  });

  it("ostatni dział dostaje własny komunikat, nie ogólne „nie udało się”", () => {
    expect(clubGroupDeleteErrorKey(new Error("cannot delete last group"))).toBe(
      "adminClubs.groups.deleteLast",
    );
  });

  it("każda inna odmowa schodzi na ogólny komunikat zapisu", () => {
    expect(clubGroupDeleteErrorKey(new Error("network down"))).toBe("adminClubs.saveFailed");
  });

  it("odmowa, która nie jest wyjątkiem, też ma klucz", () => {
    expect(clubGroupDeleteErrorKey("group not empty")).toBe("adminClubs.saveFailed");
  });
});
