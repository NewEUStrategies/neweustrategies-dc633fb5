// Reguly wiersza prelegenta - czyste funkcje, ktore rozstrzygaja dwie rzeczy
// widoczne dla czytelnika strony wydarzenia: TOZSAMOSC POZYCJI LISTY i to, czy
// karta jest KLIKALNA.
//
// PO CO OSOBNY TEST OBOK BRAMKI ZACHOWANIA. Bramka
// `src/components/events/__tests__/eventSpeakerWithoutAccount.gate.test.tsx`
// mierzy to, co widzi czytelnik - i to ona jest dowodem glownym. Ale kolizja
// klucza Reacta nie jest w drzewie WIDOCZNA (React rysuje oba wpisy i tylko
// ostrzega), a tablica prawdy predykatu klikalnosci ma osiem wejsc, ktorych
// przez render nie da sie przejsc tanio. Te dwa pytania sa wiec sprawdzane
// wprost, bez montowania czegokolwiek.
import { describe, expect, it } from "vitest";

import { speakerHasProfileToShow, speakerRowKey } from "@/lib/builder/speakerRow";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";

function row(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    speaker_profile_id: null,
    user_id: "",
    person_id: null,
    slug: null,
    display_name: null,
    avatar_url: null,
    job_title: null,
    company: null,
    headline_pl: null,
    headline_en: null,
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: false,
    sort_order: 0,
    ...overrides,
  };
}

describe("speakerRowKey - jeden klucz dla obu rodzajow wiersza", () => {
  it("dwie osoby BEZ KONTA maja rozne klucze", () => {
    // Klucz oparty na `user_id` dawalby tu dwa razy pusty napis.
    const a = speakerRowKey(row({ speaker_profile_id: "sp-1", person_id: "pe-1" }));
    const b = speakerRowKey(row({ speaker_profile_id: "sp-2", person_id: "pe-2" }));
    expect(a).not.toBe(b);
    expect(a).not.toBe("");
    expect(b).not.toBe("");
  });

  it("wiersz legacy bez wpisu rejestru bierze klucz z konta", () => {
    // `event_speakers` nie ma profilu scenicznego, wiec `speaker_profile_id`
    // przychodzi NULL - a karta i tak musi miec tozsamosc.
    expect(speakerRowKey(row({ speaker_profile_id: null, user_id: "u-1" }))).toBe("u-1");
  });

  it("kartoteka jest ostatnia deska ratunku, nie pierwsza", () => {
    // Kolejnosc ma znaczenie: wpis rejestru jest stabilny wzgledem tego, ktora
    // osobe redaktor podmienil pod tym samym wystapieniem.
    expect(speakerRowKey(row({ speaker_profile_id: "sp-1", person_id: "pe-1" }))).toBe("sp-1");
    expect(speakerRowKey(row({ speaker_profile_id: null, person_id: "pe-1" }))).toBe("pe-1");
  });

  it("wiersz katalogu (bez nowych kolumn) nadal ma klucz", () => {
    // Projekcja `get_public_speakers` nie oddaje ani wpisu rejestru, ani
    // kartoteki - obie wartosci sa wtedy `undefined`, nie `null`.
    const catalog: PublicSpeakerRow = { ...row({ user_id: "u-9" }) };
    delete catalog.speaker_profile_id;
    delete catalog.person_id;
    expect(speakerRowKey(catalog)).toBe("u-9");
  });
});

describe("speakerHasProfileToShow - klikalna jest karta, ktora ma co otworzyc", () => {
  it("osoba Z KONTEM zawsze - dialog dociaga profil i wystapienia", () => {
    expect(speakerHasProfileToShow(row({ user_id: "u-1" }))).toBe(true);
  });

  it("osoba BEZ KONTA i bez niczego ponad karte - NIE", () => {
    expect(
      speakerHasProfileToShow(
        row({ person_id: "pe-1", display_name: "Maria Sucha", job_title: "Rzeczniczka" }),
      ),
    ).toBe(false);
  });

  it.each([
    ["biogram polski", { bio_pl: "Prowadzi zespol." }],
    ["biogram angielski", { bio_en: "Leads the team." }],
    ["tematy polskie", { topics_pl: ["energetyka"] }],
    ["tematy angielskie", { topics_en: ["energy"] }],
    ["jezyki", { languages: ["pl"] }],
    ["liczba wystapien", { talks_count: 3 }],
    ["ocena", { rating: 4.5 }],
    ["liczba opinii", { reviews_count: 2 }],
  ])("osoba BEZ KONTA z faktem ponad karte - TAK (%s)", (_label, extra) => {
    expect(speakerHasProfileToShow(row({ person_id: "pe-1", ...extra }))).toBe(true);
  });

  it("biogram z samych bialych znakow to BRAK biogramu", () => {
    // Ten sam blad, ktory recznie pisany lancuch `||` popelnial przy roli:
    // napis ze spacji czytal sie jako wypelniony, wiec karta obiecywala okno
    // z biogramem, a okno bylo puste.
    expect(speakerHasProfileToShow(row({ person_id: "pe-1", bio_pl: "   " }))).toBe(false);
  });
});
