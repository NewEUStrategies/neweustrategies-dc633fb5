import { describe, expect, it } from "vitest";
import {
  normalizeClubText,
  rankClubs,
  scoreClubMatch,
  tokenizeClubQuery,
} from "@/lib/clubs/clubMatch";

const club = (over: Partial<Parameters<typeof scoreClubMatch>[0]> = {}) => ({
  slug: "bezpieczenstwo-europy",
  name_pl: "Bezpieczeństwo Europy Środkowo-Wschodniej",
  name_en: "Central and Eastern European Security",
  tagline_pl: "Wątki o odstraszaniu i odporności",
  tagline_en: "Threads on deterrence and resilience",
  policy_area: "geopolitics",
  ...over,
});

describe("clubMatch", () => {
  it("normalizuje diakrytyki i wielkość liter", () => {
    expect(normalizeClubText("Środkowo-Wschodniej  ŁÓDŹ")).toBe("srodkowo-wschodniej lodz");
  });

  it("tnie zapytanie na tokeny", () => {
    expect(tokenizeClubQuery("  bezp  europy-srodkowej ")).toEqual(["bezp", "europy", "srodkowej"]);
  });

  it("dopasowuje po części nazwy bez diakrytyków", () => {
    expect(scoreClubMatch(club(), tokenizeClubQuery("bezp"))).toBeGreaterThan(0);
    expect(scoreClubMatch(club(), tokenizeClubQuery("srodkowo"))).toBeGreaterThan(0);
  });

  it("wymaga trafienia KAŻDEGO tokenu", () => {
    expect(scoreClubMatch(club(), tokenizeClubQuery("bezp transport"))).toBe(0);
    expect(scoreClubMatch(club(), tokenizeClubQuery("bezp europy"))).toBeGreaterThan(0);
  });

  it("nie zależy od kolejności tokenów", () => {
    const a = scoreClubMatch(club(), tokenizeClubQuery("europy bezp"));
    const b = scoreClubMatch(club(), tokenizeClubQuery("bezp europy"));
    expect(a).toBe(b);
  });

  it("trafienie w nazwę waży więcej niż w opis", () => {
    const byName = scoreClubMatch(club(), tokenizeClubQuery("bezpieczenstwo"));
    const byTagline = scoreClubMatch(club(), tokenizeClubQuery("odpornosci"));
    expect(byName).toBeGreaterThan(byTagline);
  });

  it("sortuje wyniki według trafności", () => {
    const rows = [
      club({ slug: "energia", name_pl: "Energetyka i odporność", name_en: "Energy" }),
      club(),
    ];
    const ranked = rankClubs(rows, "energ");
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.slug).toBe("energia");

    const both = rankClubs([club(), rows[0]!], "odpornosc");
    expect(both.map((c) => c.slug)).toEqual(["energia", "bezpieczenstwo-europy"]);
  });

  it("puste zapytanie zwraca całą listę", () => {
    expect(rankClubs([club()], "   ")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// KLUB Z NIEPEŁNYMI DANYMI
//
// Katalog huba przychodzi wprost z `club_list`, a tam `tagline_pl`, `tagline_en`
// i `policy_area` są kolumnami NULLABLE - klub założony minutę temu ma w nich
// puste miejsce. Ranking nie ma prawa się na tym wywrócić ani, co gorsza,
// dopasować takiego klubu do PRZYPADKOWEJ frazy przez porównanie z pustym
// napisem (każdy napis „zawiera" pusty napis).
// ---------------------------------------------------------------------------

describe("clubMatch - klub bez opisu i bez obszaru", () => {
  const bare = club({
    slug: "nowy-klub",
    name_pl: "Nowy Klub",
    name_en: "New Club",
    tagline_pl: null,
    tagline_en: null,
    policy_area: null,
  });

  it("brak opisu i obszaru NIE dopasowuje klubu do dowolnej frazy", () => {
    // Gdyby brakujące pole schodziło do `undefined` zamiast do pustego napisu,
    // `String(undefined).includes(token)` albo wyjątek - w obu przypadkach
    // wynik byłby nie do obrony.
    expect(scoreClubMatch(bare, tokenizeClubQuery("odstraszanie"))).toBe(0);
  });

  it("klub bez opisu nadal jest znajdowany po nazwie", () => {
    expect(scoreClubMatch(bare, tokenizeClubQuery("nowy"))).toBeGreaterThan(0);
  });

  it("obszar podany etykietą wygrywa z surową kolumną `policy_area`", () => {
    // Widok podaje ETYKIETĘ obszaru w języku interfejsu; surowy slug bazy
    // („geopolitics") nie jest tym, czego użytkownik szuka po polsku.
    const withLabel = club({ tagline_pl: null, tagline_en: null, policy_area: "geopolitics" });
    expect(scoreClubMatch(withLabel, tokenizeClubQuery("geopolityka"), "Geopolityka")).toBe(2);
    expect(scoreClubMatch(withLabel, tokenizeClubQuery("geopolityka"))).toBe(0);
  });

  it("brak etykiety schodzi do `policy_area`, a brak obu - do pustego napisu", () => {
    const withArea = club({ tagline_pl: null, tagline_en: null, policy_area: "geopolitics" });
    expect(scoreClubMatch(withArea, tokenizeClubQuery("geopolitics"), null)).toBe(2);
    expect(scoreClubMatch(bare, tokenizeClubQuery("geopolitics"), null)).toBe(0);
  });

  it("zapytanie bez tokenów punktuje zero - nie „wszystko pasuje”", () => {
    // Wejście przez `scoreClubMatch` z pominięciem `rankClubs`: pusta lista
    // tokenów nie może znaczyć trafienia idealnego.
    expect(scoreClubMatch(club(), [])).toBe(0);
  });
});

describe("clubMatch - waga trafienia zależy od MIEJSCA w polu", () => {
  it("prefiks nazwy > początek słowa w nazwie > fragment w środku słowa", () => {
    const prefix = scoreClubMatch(club(), tokenizeClubQuery("bezpieczenstwo"));
    const wordStart = scoreClubMatch(club(), tokenizeClubQuery("europy"));
    // "zpiecz" siedzi w ŚRODKU pierwszego słowa - ani prefiks, ani początek
    // słowa. To najsłabsze trafienie w nazwę, ale nadal trafienie w nazwę.
    const inside = scoreClubMatch(club(), tokenizeClubQuery("zpiecz"));

    expect(prefix).toBe(10);
    expect(wordStart).toBe(7);
    expect(inside).toBe(4);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
  });

  it("trafienie w środek słowa nazwy nadal bije trafienie w opis", () => {
    const inside = scoreClubMatch(club(), tokenizeClubQuery("zpiecz"));
    const tagline = scoreClubMatch(club(), tokenizeClubQuery("odpornosci"));
    expect(inside).toBeGreaterThan(tagline);
  });

  it("slug jest polem ZAPASOWYM - liczy się dopiero, gdy nazwa nie trafia", () => {
    // Slug ma myślniki zamienione na spacje, więc "europy" trafia w niego
    // jako początek słowa - ale nazwa i tak jest silniejsza.
    const bySlug = scoreClubMatch(
      club({ name_pl: "Klub A", name_en: "Club A", tagline_pl: null, tagline_en: null }),
      tokenizeClubQuery("bezpieczenstwo"),
    );
    expect(bySlug).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// REMIS W RANKINGU
//
// Przy równej trafności o kolejności decyduje NAZWA - i to jest jedyne, co
// stoi między listą wyników a losowym przetasowaniem przy każdym renderze
// (`Array.prototype.sort` nie gwarantuje kolejności elementów równych sobie
// w każdej implementacji, a React renderuje tę listę po każdym klawiszu).
// ---------------------------------------------------------------------------

describe("clubMatch - remis rozstrzyga nazwa w JĘZYKU INTERFEJSU", () => {
  const energetyka = club({
    slug: "energetyka-jadrowa",
    name_pl: "Energetyka jądrowa",
    name_en: "Zero-carbon power",
    tagline_pl: null,
    tagline_en: null,
    policy_area: null,
  });
  const energia = club({
    slug: "energia-odnawialna",
    name_pl: "Energia odnawialna",
    name_en: "Alternative energy",
    tagline_pl: null,
    tagline_en: null,
    policy_area: null,
  });

  it("oba kluby punktują TAK SAMO - warunek ma sens tylko przy realnym remisie", () => {
    const tokens = tokenizeClubQuery("energ");
    expect(scoreClubMatch(energetyka, tokens)).toBe(scoreClubMatch(energia, tokens));
  });

  it("po polsku kolejność jest alfabetyczna i NIEZALEŻNA od kolejności wejścia", () => {
    expect(rankClubs([energetyka, energia], "energ").map((c) => c.slug)).toEqual([
      "energetyka-jadrowa",
      "energia-odnawialna",
    ]);
    expect(rankClubs([energia, energetyka], "energ").map((c) => c.slug)).toEqual([
      "energetyka-jadrowa",
      "energia-odnawialna",
    ]);
  });

  it("po angielsku ten sam remis daje ODWROTNĄ kolejność - bo nazwa jest inna", () => {
    // Dowód, że rozstrzygnięcie czyta nazwę w JĘZYKU INTERFEJSU, a nie zawsze
    // polską: gdyby czytało polską, obie kolejności byłyby identyczne.
    expect(rankClubs([energetyka, energia], "energ", { lang: "en" }).map((c) => c.slug)).toEqual([
      "energia-odnawialna",
      "energetyka-jadrowa",
    ]);
  });

  it("klub nazwany TYLKO po angielsku nie wskakuje na czoło z pustym kluczem", () => {
    // Regresja opisana w kodzie: `lang === "pl" ? name_pl : name_en` dawało
    // dla takiego klubu klucz PUSTY, a pusty napis sortuje się przed każdą
    // nazwą - klub bez ani jednego szukanego słowa w nazwie stawał na czele.
    const onlyEnglish = club({
      slug: "energy-council",
      name_pl: "",
      name_en: "Energy Council",
      tagline_pl: null,
      tagline_en: null,
      policy_area: null,
    });
    const ranked = rankClubs([onlyEnglish, energetyka], "energ", { lang: "pl" });
    expect(ranked.map((c) => c.slug)).toEqual(["energetyka-jadrowa", "energy-council"]);
  });

  it("etykieta obszaru jest liczona PER KLUB, nie raz dla całej listy", () => {
    const ranked = rankClubs([energetyka, energia], "atom", {
      topicLabel: (c) => (c.slug === "energetyka-jadrowa" ? "Atom" : null),
    });
    expect(ranked.map((c) => c.slug)).toEqual(["energetyka-jadrowa"]);
  });
});
