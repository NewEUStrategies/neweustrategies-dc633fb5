// Regulaminy i zgody wydarzenia - lista, pod ktora uczestnik SIE PODPISUJE.
//
// Ten plik istniał w repozytorium jako zero pokrycia, a jest to jedyny ekran,
// na ktorym powstaje wpis w `event_term_acceptances`. Cztery rzeczy, ktore po
// zepsuciu koncza sie akceptacja bez pokrycia w dokumencie:
//
// 1. WERSJA STOI PRZY ETYKIECIE. `event_term_acceptances` zapisuje `version`,
//    wiec organizator wykazuje zgode NA KONKRETNE BRZMIENIE. Gdyby wersja
//    zniknela z ekranu, zapis w bazie mowilby o dokumencie, ktorego uczestnik
//    nigdy nie widzial.
// 2. GWIAZDKA ODROZNIA OBOWIAZKOWE OD DOBROWOLNEGO. Zgoda obowiazkowa blokuje
//    wyslanie (`terms_required` w `event_register`), wiec czlowiek musi wiedziec,
//    ktorego pola nie da sie ominac - inaczej klika „wyslij" w kolko.
// 3. ODZNACZENIE MUSI DOCHODZIC DO SZKICU. Zaznaczenie bez mozliwosci cofniecia
//    to zgoda wymuszona; `onToggle(id, false)` jest tu tak samo wazne jak `true`.
// 4. DOKUMENT POD ADRESEM OTWIERA SIE W NOWEJ KARCIE, z `noreferrer noopener` -
//    to podstrona organizatora, a nie nasza, i nie moze dostac uchwytu do okna
//    formularza z danymi uczestnika.
//
// ATRAPUJEMY WYLACZNIE GRANICE: i18n (parytetu PL/EN pilnuje osobna bramka
// slownikow). Checkbox jedzie prawdziwy, bo to on decyduje o roli `checkbox`
// i o tym, czy etykieta w ogole opisuje kontrolke.
//
// RODO: wszystkie regulaminy i adresy sa syntetyczne (example.com).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { render } from "@testing-library/react";

import type { RegistrationFormTerm } from "@/lib/events/registrationFormSurface";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { RegistrationTermsList } =
  await import("@/components/events/registration/RegistrationTermsList");

function term(over: Partial<RegistrationFormTerm> = {}): RegistrationFormTerm {
  return {
    id: "term-rules",
    key: "rules",
    labelPl: "Regulamin uczestnictwa",
    labelEn: "Participation rules",
    bodyPl: "Uczestnik zobowiazuje sie do przestrzegania porzadku obrad.",
    bodyEn: "The attendee agrees to follow the order of proceedings.",
    externalUrl: null,
    isRequired: true,
    version: 3,
    ...over,
  };
}

function renderList(
  terms: RegistrationFormTerm[],
  over: { accepted?: string[]; lang?: "pl" | "en"; error?: string | null } = {},
) {
  const onToggle = vi.fn<(termId: string, next: boolean) => void>();
  const view = render(
    <RegistrationTermsList
      terms={terms}
      accepted={over.accepted ?? []}
      lang={over.lang ?? "pl"}
      error={over.error ?? null}
      onToggle={onToggle}
    />,
  );
  return { ...view, onToggle };
}

describe("RegistrationTermsList - czego uczestnik dowiaduje sie przed podpisem", () => {
  it("pokazuje WERSJE dokumentu, bo to ona ląduje w `event_term_acceptances`", () => {
    renderList([term({ version: 7 })]);

    expect(screen.getByText("eventRegistration.labels.version(version=7)")).toBeInTheDocument();
  });

  it("obowiazkowa zgoda jest oznaczona, dobrowolna nie - inaczej nie wiadomo, co blokuje wyslanie", () => {
    renderList([
      term({ id: "t-must", key: "must", labelPl: "Regulamin", isRequired: true }),
      term({ id: "t-may", key: "may", labelPl: "Newsletter", isRequired: false }),
    ]);

    expect(screen.getByRole("checkbox", { name: "Regulamin *" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Newsletter" })).toBeInTheDocument();
  });

  it("tresc krotkiego regulaminu stoi na ekranie, a nie tylko jego tytul", () => {
    renderList([term()]);

    expect(
      screen.getByText("Uczestnik zobowiazuje sie do przestrzegania porzadku obrad."),
    ).toBeInTheDocument();
  });

  it("regulamin bez tresci wlasnej nie rysuje pustego akapitu", () => {
    const { container } = renderList([
      term({ bodyPl: "", bodyEn: "", externalUrl: null, version: 3 }),
    ]);

    // Zostaje wylacznie wiersz z wersja - pusty akapit pod etykieta wygladalby
    // jak dokument, ktorego tresc sie nie doczytala. Sama LICZBA akapitow tego
    // nie dowodzi: przezylby ja rownie dobrze pusty akapit tresci przy zgubionej
    // wersji, a wtedy uczestnik podpisuje sie pod brzmieniem, ktorego nie widzi.
    const paragraphs = [...container.querySelectorAll("p")];
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("eventRegistration.labels.version(version=3)");
  });
});

describe("RegistrationTermsList - dokument pod adresem zewnetrznym", () => {
  it("otwiera sie w nowej karcie i nie oddaje uchwytu do formularza z danymi", () => {
    renderList([term({ externalUrl: "https://example.com/regulamin.pdf" })]);

    const link = screen.getByRole("link", { name: /eventRegistration.labels.readTerms/ });
    expect(link).toHaveAttribute("href", "https://example.com/regulamin.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    // `noreferrer noopener` nie jest ozdoba: bez tego dokument organizatora
    // dostaje `window.opener` do karty, w ktorej stoi wypelniony formularz.
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("regulamin bez adresu nie dostaje odnosnika prowadzacego donikad", () => {
    renderList([term({ externalUrl: null })]);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("RegistrationTermsList - akceptacja i jej cofniecie", () => {
  it("zaznaczenie melduje wywolujacemu identyfikator zgody, a nie jej klucz", () => {
    // Do `event_term_acceptances` jedzie ID wiersza `event_terms`; klucz jest
    // tylko etykieta techniczna i pomylka miedzy nimi zapisuje akceptacje
    // dokumentu, ktorego nie ma.
    const { onToggle } = renderList([term({ id: "term-rules", key: "rules" })]);

    fireEvent.click(screen.getByRole("checkbox", { name: /Regulamin uczestnictwa/ }));

    expect(onToggle).toHaveBeenCalledWith("term-rules", true);
  });

  it("zgode raz zaznaczona da sie cofnac - inaczej byloby to oswiadczenie wymuszone", () => {
    const { onToggle } = renderList([term()], { accepted: ["term-rules"] });

    const box = screen.getByRole("checkbox", { name: /Regulamin uczestnictwa/ });
    expect(box).toBeChecked();
    fireEvent.click(box);

    expect(onToggle).toHaveBeenCalledWith("term-rules", false);
  });

  it("zaznaczenie jednej zgody nie zaznacza pozostalych", () => {
    renderList(
      [
        term({ id: "t-1", key: "rules", labelPl: "Regulamin" }),
        term({ id: "t-2", key: "photo", labelPl: "Wizerunek", isRequired: false }),
      ],
      { accepted: ["t-1"] },
    );

    expect(screen.getByRole("checkbox", { name: "Regulamin *" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Wizerunek" })).not.toBeChecked();
  });

  it("brak zgod obowiazkowych ma zdanie pod lista, a nie ciche odrzucenie przy wysylce", () => {
    // Bez tego uczestnik dostaje `terms_required` dopiero z bazy - komunikat,
    // ktory nie mowi, ktore pole zaznaczyc.
    renderList([term()], { error: "Zaznacz zgody obowiazkowe." });

    expect(screen.getByText("Zaznacz zgody obowiazkowe.")).toBeInTheDocument();
  });

  it("bez bledu nie ma czerwonego zdania - komunikat pojawia sie z powodu, nie na stale", () => {
    renderList([term()], { error: null });

    expect(screen.queryByText("Zaznacz zgody obowiazkowe.")).not.toBeInTheDocument();
  });
});

describe("RegistrationTermsList - wersja jezykowa dokumentu", () => {
  it("po angielsku czyta etykiete EN, po polsku PL", () => {
    const { unmount } = renderList([term()], { lang: "en" });
    expect(screen.getByRole("checkbox", { name: "Participation rules *" })).toBeInTheDocument();
    unmount();

    renderList([term()], { lang: "pl" });
    expect(screen.getByRole("checkbox", { name: "Regulamin uczestnictwa *" })).toBeInTheDocument();
  });

  it("brak etykiety w jezyku widza spada do klucza - dokument zostaje NAZWANY", () => {
    // Bezimienna zgoda to pole wyboru bez tresci: nie da sie jej ani przeczytac,
    // ani opisac w zgloszeniu do organizatora.
    renderList([term({ labelEn: "", key: "rules" })], { lang: "en" });

    expect(screen.getByRole("checkbox", { name: "rules *" })).toBeInTheDocument();
  });

  it("brak tlumaczenia tresci pokazuje wersje zapasowa, a nie ukrywa CALY dokument", () => {
    // Pusta tresc w jezyku widza nie moze znaczyc „bez akapitu": uczestnik
    // ogladajacy strone po angielsku widzialby wtedy pole wyboru z gwiazdka,
    // numer wersji i NIC WIECEJ - ani zdania regulaminu, ani odnosnika
    // (`externalUrl` tez bywa pusty) - a `event_term_acceptances` zapisaloby
    // to jako pelnoprawna akceptacje wersji 3.
    const { container } = renderList([term({ bodyEn: "", externalUrl: null })], { lang: "en" });

    const body = screen.getByText("Uczestnik zobowiazuje sie do przestrzegania porzadku obrad.");
    expect(body).toBeInTheDocument();
    // Zdanie jest po polsku na angielskiej stronie, wiec czytnik ekranu ma to
    // wiedziec - inaczej przeczyta polski tekst angielska wymowa.
    expect(body).toHaveAttribute("lang", "pl");
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("na polskiej stronie wersja zapasowa idzie w druga strone - z tresci EN", () => {
    // Ta sama regula, lustrzanie: dokument dopisany wylacznie po angielsku ma
    // byc czytelny dla uczestnika ogladajacego formularz po polsku.
    renderList([term({ bodyPl: "", externalUrl: null })], { lang: "pl" });

    const body = screen.getByText("The attendee agrees to follow the order of proceedings.");
    expect(body).toBeInTheDocument();
    expect(body).toHaveAttribute("lang", "en");
  });
});

describe("RegistrationTermsList - dostepnosc", () => {
  it("nie ma naruszen dostepnosci", async () => {
    const { container } = renderList([
      term({ externalUrl: "https://example.com/regulamin.pdf" }),
      term({ id: "t-2", key: "photo", labelPl: "Wizerunek", isRequired: false }),
    ]);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
