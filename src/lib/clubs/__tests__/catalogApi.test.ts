// Katalogi klubów: obszary tematyczne (`topicsApi`, `topicCatalog`),
// specjalizacje (`specializationsApi`), publiczny odczyt klubu (`publicClub`)
// oraz warstwa zgodności starej taksonomii (`policyAreas`).
//
// Wszystkie cztery pliki stały na zerze albo blisko zera, a razem odpowiadają
// za JEDNO pytanie widoczne dla użytkownika: jak nazywa się obszar, w którym
// toczy się dyskusja. Etykieta rozjeżdża się cicho - chip w hubie, w klubie
// i w wątku może pokazać trzy różne rzeczy i nikt tego nie zauważy, dopóki
// ktoś nie porówna ich obok siebie.
//
// SORTOWANIE JEST CZĘŚCIĄ KONTRAKTU, nie kosmetyką: `sortTopics` domyka
// remisy `sort_order` alfabetycznie po kluczu, bo bez tiebreakera lista
// obszarów zmienia kolejność między odświeżeniami (Array.sort nie jest
// stabilny dla równych kluczy w każdej implementacji), a wtedy filtr
// „skacze" pod kursorem.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/clubs/fixtures")).clubSupabaseMock,
);

import { CLUB_IDS, clubListRow, clubRpc, clubViewRow, resetClubRpc } from "@/test/clubs/fixtures";
import {
  deleteClubTopic,
  fetchActiveClubTopics,
  fetchAdminClubTopics,
  setClubTopicActive,
  upsertClubTopic,
} from "@/lib/clubs/topicsApi";
import {
  deleteClubSpecialization,
  fetchAdminClubSpecializations,
  fetchClubsBySpecialization,
  fetchPublicClubSpecializations,
  setClubSpecializationActive,
  upsertClubSpecialization,
} from "@/lib/clubs/specializationsApi";
import { fetchClubBySlug } from "@/lib/clubs/publicClub";
import {
  CLUB_TOPIC_ALL,
  CLUB_TOPIC_NONE,
  isValidTopicKey,
  normalizeTopicValue,
  optionsWithCurrent,
  slugifyTopicKey,
  sortTopics,
  topicLabel,
} from "@/lib/clubs/topicCatalog";
import {
  CLUB_TOPICS,
  clubTopicLabel,
  isClubTopic,
  normalizeClubTopic,
} from "@/lib/clubs/policyAreas";

beforeEach(() => resetClubRpc());

// ---------------------------------------------------------------------------
// Obszary tematyczne - warstwa danych
// ---------------------------------------------------------------------------

describe("fetchActiveClubTopics", () => {
  it("porządkuje katalog po sort_order, remisy alfabetycznie po kluczu", async () => {
    clubRpc.setData("club_topics_active", [
      { key: "transport", label_pl: "Transport", label_en: "Transport", sort_order: 2 },
      { key: "energy", label_pl: "Energia", label_en: "Energy", sort_order: 2 },
      { key: "trade", label_pl: "Handel", label_en: "Trade", sort_order: 1 },
    ]);

    const topics = await fetchActiveClubTopics();

    // Bez tiebreakera po kluczu lista „skacze" między odświeżeniami, a filtr
    // pod kursorem zmienia znaczenie w trakcie klikania.
    expect(topics.map((t) => t.key)).toEqual(["trade", "energy", "transport"]);
  });

  it("sort_order przychodzący jako tekst jest liczbą po stronie klienta", async () => {
    clubRpc.setData("club_topics_active", [
      { key: "b", label_pl: "B", label_en: "B", sort_order: "10" },
      { key: "a", label_pl: "A", label_en: "A", sort_order: "9" },
    ]);

    // Bez `Number(...)` porównanie "10" < "9" byłoby leksykalne i katalog
    // ustawiałby się w kolejności, której nikt nie zamawiał.
    expect((await fetchActiveClubTopics()).map((t) => t.key)).toEqual(["a", "b"]);
  });

  it("null z bazy daje pusty katalog, nie wyjątek", async () => {
    clubRpc.setData("club_topics_active", null);
    expect(await fetchActiveClubTopics()).toEqual([]);
  });

  it("woła publiczne RPC bez argumentów (anon też je widzi)", async () => {
    clubRpc.setData("club_topics_active", []);

    await fetchActiveClubTopics();

    expect(clubRpc.lastCall("club_topics_active")?.args).toBeUndefined();
  });

  it("rzuca przy odmowie", async () => {
    clubRpc.setError("club_topics_active", "denied");
    await expect(fetchActiveClubTopics()).rejects.toThrow("denied");
  });
});

describe("fetchAdminClubTopics", () => {
  it("liczniki użycia są liczbami, flagi przechodzą bez zmian", async () => {
    clubRpc.setData("admin_club_topics_list", [
      {
        id: "t1",
        key: "energy",
        label_pl: "Energia",
        label_en: "Energy",
        sort_order: "1",
        is_active: true,
        is_system: false,
        clubs_count: "4",
        threads_count: "12",
      },
    ]);

    const [row] = await fetchAdminClubTopics();

    expect(row).toEqual({
      id: "t1",
      key: "energy",
      label_pl: "Energia",
      label_en: "Energy",
      sort_order: 1,
      is_active: true,
      is_system: false,
      clubs_count: 4,
      threads_count: 12,
    });
  });

  it("null daje pustą listę", async () => {
    clubRpc.setData("admin_club_topics_list", null);
    expect(await fetchAdminClubTopics()).toEqual([]);
  });
});

describe("zapis katalogu obszarów", () => {
  it("upsert używa prefiksu _ i mapuje camelCase na snake_case", async () => {
    clubRpc.setData("admin_club_topic_upsert", "t9");

    const id = await upsertClubTopic({
      key: "energy",
      labelPl: "Energia",
      labelEn: "Energy",
      sortOrder: 3,
      isActive: true,
    });

    expect(id).toBe("t9");
    expect(clubRpc.lastCall("admin_club_topic_upsert")?.args).toEqual({
      _id: undefined,
      _key: "energy",
      _label_pl: "Energia",
      _label_en: "Energy",
      _sort_order: 3,
      _is_active: true,
    });
  });

  it("upsert przy EDYCJI przekazuje _id", async () => {
    clubRpc.setData("admin_club_topic_upsert", "t9");

    await upsertClubTopic({
      id: "t9",
      key: "energy",
      labelPl: "Energia",
      labelEn: "Energy",
      sortOrder: 3,
      isActive: true,
    });

    expect(clubRpc.lastCall("admin_club_topic_upsert")?.arg("_id")).toBe("t9");
  });

  it("upsert sprowadza zwrotkę do tekstu", async () => {
    clubRpc.setData("admin_club_topic_upsert", 42);

    expect(
      await upsertClubTopic({
        key: "k",
        labelPl: "K",
        labelEn: "K",
        sortOrder: 0,
        isActive: true,
      }),
    ).toBe("42");
  });

  it("wyłączenie i skasowanie obszaru: brak błędu znaczy sukces", async () => {
    clubRpc.setData("admin_club_topic_set_active", null);
    clubRpc.setData("admin_club_topic_delete", null);

    expect(await setClubTopicActive("t1", false)).toBe(true);
    expect(clubRpc.lastCall("admin_club_topic_set_active")?.arg("_is_active")).toBe(false);

    expect(await deleteClubTopic("t1")).toBe(true);
    expect(clubRpc.lastCall("admin_club_topic_delete")?.arg("_id")).toBe("t1");
  });

  it("wszystkie trzy zapisy rzucają przy odmowie bramki admina", async () => {
    clubRpc.setError("admin_club_topic_upsert", "not admin", "42501");
    clubRpc.setError("admin_club_topic_set_active", "not admin", "42501");
    clubRpc.setError("admin_club_topic_delete", "not admin", "42501");

    await expect(
      upsertClubTopic({ key: "k", labelPl: "K", labelEn: "K", sortOrder: 0, isActive: true }),
    ).rejects.toThrow("not admin");
    await expect(setClubTopicActive("t", true)).rejects.toThrow("not admin");
    await expect(deleteClubTopic("t")).rejects.toThrow("not admin");
  });
});

// ---------------------------------------------------------------------------
// Obszary tematyczne - czyste reguły
// ---------------------------------------------------------------------------

describe("topicLabel - kolejność źródeł etykiety", () => {
  const catalog = [
    { key: "energy", label_pl: "Energia i klimat", label_en: "Energy and climate", sort_order: 1 },
  ];

  it("katalog organizacji wygrywa z listą awaryjną", async () => {
    expect(topicLabel("energy", "pl", catalog)).toBe("Energia i klimat");
    expect(topicLabel("energy", "en", catalog)).toBe("Energy and climate");
  });

  it("obszar opisany TYLKO po polsku nie daje pustej plakietki po angielsku", () => {
    const half = [{ key: "own", label_pl: "Własny obszar", label_en: "", sort_order: 1 }];

    // To był realny defekt: obszar dodany z panelu i opisany po jednemu
    // renderował drugiemu językowi pustą plakietkę obok tematu.
    expect(topicLabel("own", "en", half)).toBe("Własny obszar");
  });

  it("pusty klucz daje pustą etykietę, nie napis awaryjny", () => {
    expect(topicLabel("", "pl")).toBe("");
    expect(topicLabel("   ", "pl")).toBe("");
  });

  it("klucz spoza taksonomii nie znika z UI - wraca przez areaLabel", () => {
    expect(topicLabel("nieznany_obszar", "pl")).not.toBe("");
  });

  it("klucz jest przycinany przed dopasowaniem", () => {
    expect(topicLabel("  energy  ", "pl", catalog)).toBe("Energia i klimat");
  });
});

describe("normalizeTopicValue", () => {
  it("sentinele selecta i pustka znaczą BRAK obszaru", () => {
    for (const value of ["", "   ", CLUB_TOPIC_NONE, CLUB_TOPIC_ALL, null, undefined]) {
      expect(normalizeTopicValue(value)).toBeNull();
    }
  });

  it("realny klucz przechodzi przycięty", () => {
    expect(normalizeTopicValue("  energy ")).toBe("energy");
  });
});

describe("optionsWithCurrent", () => {
  const catalog = [
    { key: "b", label_pl: "B", label_en: "B", sort_order: 2 },
    { key: "a", label_pl: "A", label_en: "A", sort_order: 1 },
  ];

  it("bez wybranego obszaru oddaje sam posortowany katalog", () => {
    expect(optionsWithCurrent(catalog, null, "pl").map((o) => o.key)).toEqual(["a", "b"]);
  });

  it("obszar WYŁĄCZONY przez redakcję wraca do listy jako ostatni", () => {
    const options = optionsWithCurrent(catalog, "wylaczony", "pl");

    // Bez tego edycja klubu po cichu skasowałaby przypisanie przy pierwszym
    // zapisie - użytkownik nie zobaczyłby, że coś stracił.
    expect(options.map((o) => o.key)).toEqual(["a", "b", "wylaczony"]);
    expect(options.at(-1)?.sort_order).toBe(9999);
  });

  it("obszar obecny w katalogu nie jest dublowany", () => {
    expect(optionsWithCurrent(catalog, "a", "pl").map((o) => o.key)).toEqual(["a", "b"]);
  });

  it("sentinel jako wartość bieżąca nie dokłada opcji-widma", () => {
    expect(optionsWithCurrent(catalog, CLUB_TOPIC_NONE, "pl").map((o) => o.key)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("slugifyTopicKey / isValidTopicKey", () => {
  it("polskie znaki schodzą na łacinkę, spacje na podkreślenia", () => {
    expect(slugifyTopicKey("Energia i klimat")).toBe("energia_i_klimat");
    expect(slugifyTopicKey("Zdrowie i żywność")).toBe("zdrowie_i_zywnosc");
  });

  it("litera ł jest obsłużona osobną mapą - NFD jej nie rozkłada", () => {
    // `normalize("NFD")` nie rozbija „ł" na literę + znak diakrytyczny, więc
    // bez własnej mapy znak wypadał całkowicie („łańcuch" -> „acuch").
    expect(slugifyTopicKey("łańcuch dostaw")).toBe("lancuch_dostaw");
  });

  it("klucz zaczynający się od cyfry dostaje prefiks t_", () => {
    expect(slugifyTopicKey("2030 cele")).toBe("t_2030_cele");
  });

  it("znaki brzegowe nie zostawiają podkreśleń na końcach", () => {
    expect(slugifyTopicKey("  ---energia---  ")).toBe("energia");
  });

  it("długość jest ucięta do limitu kolumny", () => {
    expect(slugifyTopicKey("a".repeat(80)).length).toBeLessThanOrEqual(49);
  });

  it("wynik slugify ZAWSZE przechodzi walidację bazy", () => {
    for (const input of ["Energia i klimat", "2030 cele", "łańcuch dostaw", "a".repeat(80)]) {
      expect(isValidTopicKey(slugifyTopicKey(input))).toBe(true);
    }
  });

  it("isValidTopicKey odrzuca to, czego nie przyjmie CHECK w bazie", () => {
    for (const bad of ["", "A", "1abc", "ab-cd", "z", "Energia", "a".repeat(50)]) {
      expect(isValidTopicKey(bad)).toBe(false);
    }
    expect(isValidTopicKey("ab")).toBe(true);
  });
});

describe("sortTopics", () => {
  it("nie mutuje wejścia", () => {
    const input = [
      { key: "b", label_pl: "B", label_en: "B", sort_order: 2 },
      { key: "a", label_pl: "A", label_en: "A", sort_order: 1 },
    ];
    const before = input.map((o) => o.key);

    sortTopics(input);

    expect(input.map((o) => o.key)).toEqual(before);
  });
});

describe("policyAreas - warstwa zgodności", () => {
  it("isClubTopic odrzuca pustkę i białe znaki", () => {
    expect(isClubTopic(null)).toBe(false);
    expect(isClubTopic(undefined)).toBe(false);
    expect(isClubTopic("   ")).toBe(false);
    expect(isClubTopic("energy")).toBe(true);
  });

  it("normalizeClubTopic zachowuje się jak normalizeTopicValue", () => {
    expect(normalizeClubTopic("  energy ")).toBe("energy");
    expect(normalizeClubTopic(CLUB_TOPIC_NONE)).toBeNull();
    expect(normalizeClubTopic(null)).toBeNull();
  });

  it("clubTopicLabel deleguje do katalogu, a nie do własnej listy", () => {
    const catalog = [{ key: "energy", label_pl: "Energia", label_en: "Energy", sort_order: 1 }];

    // Ten plik NIE trzyma już własnej taksonomii - obszar dodany w panelu
    // musi być znany całej aplikacji, nie połowie.
    expect(clubTopicLabel("energy", "pl", undefined, catalog)).toBe("Energia");
  });

  it("CLUB_TOPICS to lista awaryjna, a nie źródło prawdy - ale nie jest pusta", () => {
    expect(CLUB_TOPICS.length).toBeGreaterThan(0);
    expect(CLUB_TOPICS.every((key) => isValidTopicKey(key))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Specjalizacje
// ---------------------------------------------------------------------------

describe("fetchPublicClubSpecializations", () => {
  it("liczniki i porządek przychodzą jako liczby", async () => {
    clubRpc.setData("club_specializations_public", [
      {
        slug: "energetyka",
        key: "energy",
        label_pl: "Energetyka",
        label_en: "Energy",
        lead_pl: "Lead PL",
        lead_en: "Lead EN",
        desc_pl: "Opis",
        desc_en: "Description",
        icon: "zap",
        sort_order: "2",
        club_count: "7",
      },
    ]);

    const [row] = await fetchPublicClubSpecializations();

    expect(row).toMatchObject({ slug: "energetyka", sort_order: 2, club_count: 7 });
  });

  it("null daje pustą listę", async () => {
    clubRpc.setData("club_specializations_public", null);
    expect(await fetchPublicClubSpecializations()).toEqual([]);
  });
});

describe("fetchClubsBySpecialization", () => {
  it("domyślna strona to 60 pozycji, suma z wiersza", async () => {
    clubRpc.setData("club_list_by_specialization", [clubListRow({ total_count: 19 })]);

    const page = await fetchClubsBySpecialization("energetyka");

    expect(page.total).toBe(19);
    expect(clubRpc.lastCall("club_list_by_specialization")?.args).toEqual({
      p_slug: "energetyka",
      p_limit: 60,
      p_offset: 0,
    });
  });

  it("pusta strona daje sumę zero", async () => {
    clubRpc.setData("club_list_by_specialization", null);
    expect(await fetchClubsBySpecialization("x")).toEqual({ rows: [], total: 0 });
  });
});

describe("panel specjalizacji", () => {
  it("upsert mapuje camelCase na snake_case i dopełnia puste opisy", async () => {
    clubRpc.setData("admin_club_specialization_upsert", "spec-1");

    await upsertClubSpecialization({
      slug: "energetyka",
      labelPl: "Energetyka",
      labelEn: "Energy",
      icon: "zap",
      sortOrder: 1,
      isActive: true,
    });

    expect(clubRpc.lastCall("admin_club_specialization_upsert")?.arg("p_payload")).toEqual({
      id: null,
      // Brak `key` dziedziczy `slug` - kolumna jest NOT NULL, a formularz
      // panelu nie pyta o nią osobno.
      key: "energetyka",
      slug: "energetyka",
      label_pl: "Energetyka",
      label_en: "Energy",
      lead_pl: "",
      lead_en: "",
      desc_pl: "",
      desc_en: "",
      icon: "zap",
      sort_order: 1,
      is_active: true,
    });
  });

  it("jawny key nie jest nadpisywany slugiem", async () => {
    clubRpc.setData("admin_club_specialization_upsert", "spec-1");

    await upsertClubSpecialization({
      slug: "energetyka-i-klimat",
      key: "energy",
      labelPl: "E",
      labelEn: "E",
      icon: "zap",
      sortOrder: 1,
      isActive: true,
    });

    const payload = clubRpc.lastCall("admin_club_specialization_upsert")?.arg("p_payload");
    expect(payload).toMatchObject({ key: "energy", slug: "energetyka-i-klimat" });
  });

  it("wyłączenie i skasowanie: brak błędu znaczy sukces", async () => {
    clubRpc.setData("admin_club_specialization_set_active", null);
    clubRpc.setData("admin_club_specialization_delete", null);

    expect(await setClubSpecializationActive("spec-1", false)).toBe(true);
    expect(await deleteClubSpecialization("spec-1")).toBe(true);
  });

  it("lista panelu: null daje pustą listę", async () => {
    clubRpc.setData("admin_club_specializations_list", null);
    expect(await fetchAdminClubSpecializations()).toEqual([]);
  });

  it("wszystkie funkcje rzucają przy odmowie", async () => {
    const cases: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["club_specializations_public", () => fetchPublicClubSpecializations()],
      ["club_list_by_specialization", () => fetchClubsBySpecialization("s")],
      ["admin_club_specializations_list", () => fetchAdminClubSpecializations()],
      [
        "admin_club_specialization_upsert",
        () =>
          upsertClubSpecialization({
            slug: "s",
            labelPl: "L",
            labelEn: "L",
            icon: "i",
            sortOrder: 0,
            isActive: true,
          }),
      ],
      ["admin_club_specialization_set_active", () => setClubSpecializationActive("s", true)],
      ["admin_club_specialization_delete", () => deleteClubSpecialization("s")],
    ];
    for (const [rpcName, run] of cases) {
      clubRpc.setError(rpcName, `odmowa ${rpcName}`, "42501");
      await expect(run()).rejects.toThrow(`odmowa ${rpcName}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Publiczny odczyt klubu
// ---------------------------------------------------------------------------

describe("fetchClubBySlug", () => {
  it("oddaje kartę klubu po slugu", async () => {
    clubRpc.setData("club_view", [clubViewRow()]);

    const club = await fetchClubBySlug("klub-energetyczny");

    expect(club?.id).toBe(CLUB_IDS.club);
    expect(clubRpc.lastCall("club_view")?.arg("p_slug")).toBe("klub-energetyczny");
  });

  it("brak wiersza to null - interfejs pokazuje 404, nie 403", async () => {
    clubRpc.setData("club_view", []);
    expect(await fetchClubBySlug("nieistniejacy")).toBeNull();

    clubRpc.setData("club_view", null);
    expect(await fetchClubBySlug("nieistniejacy")).toBeNull();
  });

  it("rzuca przy odmowie bazy (to nie to samo, co brak klubu)", async () => {
    clubRpc.setError("club_view", "db down");
    await expect(fetchClubBySlug("x")).rejects.toThrow("db down");
  });

  it("api.ts re-eksportuje DOKŁADNIE tę funkcję (jeden chunk dla loadera trasy)", async () => {
    const [publicMod, apiMod] = await Promise.all([
      import("@/lib/clubs/publicClub"),
      import("@/lib/clubs/api"),
    ]);

    // Wydzielenie z api.ts było decyzją o rozmiarze bundla (loader trasy jest
    // EAGER). Re-eksport musi wskazywać tę samą funkcję, inaczej mielibyśmy
    // dwie kopie warstwy danych zamiast jednej.
    expect(apiMod.fetchClubBySlug).toBe(publicMod.fetchClubBySlug);
  });
});
