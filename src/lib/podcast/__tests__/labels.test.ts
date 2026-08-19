// Etykiety podcastu - wybór języka i zapasowe brzmienia.
//
// DLACZEGO OSOBNY PLIK OBOK `types.test.ts`. Tamten plik testuje parsery jsonb
// i czas trwania; cztery funkcje ETYKIET (`podcastTitle`, `showTitle`,
// `showDescription`, `personRoleLabel`) nie miały do 18.08.2026 ani jednego
// wywołania, mimo że to one decydują, CO widzi czytelnik na karcie odcinka.
//
// Reguła jest wszędzie ta sama i jest regułą PRODUKTOWĄ, nie techniczną:
// brak tłumaczenia nie może dać pustego miejsca na stronie. Anglojęzyczny
// czytelnik ma zobaczyć polski tytuł zamiast niczego - bo tytuł w obcym języku
// niesie informację, a pusty nagłówek nie niesie żadnej.
import { describe, expect, it } from "vitest";
import { personRoleLabel, podcastTitle, showDescription, showTitle } from "@/lib/podcast/types";

describe("podcastTitle", () => {
  it("wybiera tytuł w języku strony", () => {
    const episode = { title_pl: "Odcinek pierwszy", title_en: "Episode one" };
    expect(podcastTitle(episode, "pl")).toBe("Odcinek pierwszy");
    expect(podcastTitle(episode, "en")).toBe("Episode one");
  });

  it("brak tłumaczenia angielskiego pokazuje polskie brzmienie", () => {
    // Pusty nagłówek na liście odcinków wygląda jak awaria katalogu.
    expect(podcastTitle({ title_pl: "Odcinek pierwszy", title_en: "" }, "en")).toBe(
      "Odcinek pierwszy",
    );
  });

  it("brak brzmienia polskiego pokazuje angielskie", () => {
    expect(podcastTitle({ title_pl: "", title_en: "Episode one" }, "pl")).toBe("Episode one");
  });

  it("oba puste dają pusty napis, nie `undefined`", () => {
    // `undefined` w JSX renderuje się jako nic, ale w `meta`/JSON-LD wychodzi
    // jako literalne „undefined" - stąd jawny pusty napis na końcu łańcucha.
    expect(podcastTitle({ title_pl: "", title_en: "" }, "pl")).toBe("");
  });
});

describe("showTitle", () => {
  it("wybiera tytuł programu w języku strony", () => {
    const show = { title_pl: "Rozmowy o Europie", title_en: "Europe talks" };
    expect(showTitle(show, "pl")).toBe("Rozmowy o Europie");
    expect(showTitle(show, "en")).toBe("Europe talks");
  });

  it("schodzi na drugi język w OBIE strony", () => {
    expect(showTitle({ title_pl: "Rozmowy o Europie", title_en: "" }, "en")).toBe(
      "Rozmowy o Europie",
    );
    expect(showTitle({ title_pl: "", title_en: "Europe talks" }, "pl")).toBe("Europe talks");
  });

  it("oba puste dają pusty napis", () => {
    expect(showTitle({ title_pl: "", title_en: "" }, "en")).toBe("");
  });
});

describe("showDescription", () => {
  it("wybiera opis w języku strony", () => {
    const show = { description_pl: "Cotygodniowy przegląd", description_en: "Weekly review" };
    expect(showDescription(show, "pl")).toBe("Cotygodniowy przegląd");
    expect(showDescription(show, "en")).toBe("Weekly review");
  });

  it("brak opisu angielskiego pokazuje polski", () => {
    expect(
      showDescription({ description_pl: "Cotygodniowy przegląd", description_en: "" }, "en"),
    ).toBe("Cotygodniowy przegląd");
  });

  it("brak opisu POLSKIEGO daje pusto, mimo że angielski istnieje", () => {
    // ASYMETRIA WOBEC `showTitle` - i jest to zachowanie FAKTYCZNE, nie
    // zamierzone przez ten test. Łańcuch opisu kończy się na
    // `|| s.description_pl`, bez trzeciego członu `|| s.description_en`, więc
    // polska strona programu opisanego wyłącznie po angielsku zostaje BEZ
    // opisu, choć tytuł w tej samej sytuacji spadłby na angielski.
    //
    // Przypinamy to asercją zamiast po cichu naprawiać: zmiana dotyczy tekstu
    // widocznego dla czytelnika i w metadanych programu (opis kanału trafia
    // też do feedu), więc jest decyzją redakcyjną, nie porządkową. Opisane
    // w dokumencie wdrożenia jako dług do rozstrzygnięcia.
    expect(showDescription({ description_pl: "", description_en: "Weekly review" }, "pl")).toBe("");
  });

  it("oba puste dają pusty napis", () => {
    expect(showDescription({ description_pl: "", description_en: "" }, "en")).toBe("");
  });
});

describe("personRoleLabel", () => {
  it("rozróżnia prowadzącego i gościa po polsku", () => {
    expect(personRoleLabel("host", "pl")).toBe("Prowadzący");
    expect(personRoleLabel("guest", "pl")).toBe("Gość");
  });

  it("rozróżnia prowadzącego i gościa po angielsku", () => {
    expect(personRoleLabel("host", "en")).toBe("Host");
    expect(personRoleLabel("guest", "en")).toBe("Guest");
  });

  it("obie role mają brzmienie w obu językach - żadna nie zostaje po angielsku", () => {
    // Ta funkcja NIE przechodzi przez i18next (własne napisy w module), więc
    // nie pilnuje jej bramka parytetu PL/EN. Ten test jest tu jej zamiennikiem.
    for (const role of ["host", "guest"] as const) {
      expect(personRoleLabel(role, "pl")).not.toBe(personRoleLabel(role, "en"));
      expect(personRoleLabel(role, "pl").length).toBeGreaterThan(0);
      expect(personRoleLabel(role, "en").length).toBeGreaterThan(0);
    }
  });
});
