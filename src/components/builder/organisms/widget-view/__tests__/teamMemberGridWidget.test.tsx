// TeamMemberGridWidget: siatka opisanych osób + okno pełnej kartoteki.
//
// Kontrakty przypinane tutaj:
//  * treść -> karta (nagłówek sekcji, plakietka, imię, rola, skrót biogramu),
//  * klik -> okno z rolą w NES, afiliacją, projektami, kontaktem i social media,
//  * NAPISY OKNA JADĄ ZA JĘZYKIEM TREŚCI, nie za językiem panelu (`{ lng }`),
//  * sanityzacja URL-i social (`javascript:` odpada) i biogramu HTML,
//  * osoba bez imienia nie renderuje się wcale,
//  * `editable` (kanwa buildera) nie otwiera okna,
//  * `openPopup: false` NIE zostawia przycisku bez akcji,
//  * zaokrąglenie 6 px jedzie jedną zmienną na wszystkie powierzchnie,
//  * SSR: serwer rysuje prawdziwe `<img>` twarzy, a hydratacja nie zgłasza
//    rozjazdu ANI KANAŁEM `onRecoverableError` (struktura), ANI ostrzeżeniem
//    w konsoli (atrybuty) - z sondą, która dowodzi, że drugi kanał działa.
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import "@/test/i18nReal";

import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { realT } from "@/test/i18nReal";
import { TeamMemberGridWidget } from "../TeamMemberGridWidget";
import { teamGridInitials, teamGridMembers, teamGridProjects } from "@/lib/builder/teamGrid";
import "@/lib/i18n-team-grid";

// BrandIcon sięga po bibliotekę ikon przez Supabase - thenable stub wystarczy,
// żeby zapytanie zwróciło pusto i ikony spadły na Lucide.
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in", "is", "order", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({ data: [], error: null }).then(onF);
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = () =>
    Promise.resolve({ data: null, error: null });
  return { supabase: chain };
});

let nextId = 0;
function node(content: WidgetContent): WidgetNode {
  return { id: `tmg-${nextId++}`, kind: "widget", type: "team-member-grid", content };
}

const ANNA = {
  id: "m-anna",
  avatar: "https://cdn.example.org/anna.jpg",
  name: "Anna Kowalska",
  role_pl: "Dyrektorka programu",
  role_en: "Programme director",
  department_pl: "Zarząd",
  department_en: "Board",
  bio_pl: "Dwadzieścia lat w dyplomacji europejskiej.",
  bio_en: "Twenty years in European diplomacy.",
  fullBio_pl: "<p>Pełny <strong>biogram</strong> Anny.</p>",
  affiliation_pl: "Uniwersytet Warszawski",
  affiliation_en: "University of Warsaw",
  projects_pl: "Bałkany, Energia,  ",
  projects_en: "Balkans, Energy",
  email: "anna@example.org",
  phone: "+48 600 000 000",
  profileHref: "/author/anna-kowalska",
  linkedin: "https://linkedin.com/in/anna",
  website: "https://example.org",
  // Sanityzacja: ten adres NIE ma prawa zostać ikoną.
  x: "javascript:alert(1)",
};

const MAREK = {
  id: "m-marek",
  name: "Marek Nowak",
  role_en: "Senior fellow",
};

const FULL: WidgetContent = {
  badge_pl: "POZNAJ ZESPÓŁ",
  badge_en: "MEET THE TEAM",
  heading_pl: "Ludzie New European Strategies",
  heading_en: "The people behind New European Strategies",
  intro_pl: "Zespół analityczny i doradczy.",
  intro_en: "Analysts and advisers.",
  columns: 3,
  radius: 6,
  members: [ANNA, MAREK, { id: "m-blank", name: "   " }],
};

function paint(content: WidgetContent, lang: "pl" | "en" = "pl", editable = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeamMemberGridWidget node={node(content)} lang={lang} editable={editable} />
    </QueryClientProvider>,
  );
}

describe("TeamMemberGridWidget - siatka", () => {
  it("rysuje nagłówek sekcji i kafelek każdej opisanej osoby", () => {
    paint(FULL);
    expect(screen.getByText("POZNAJ ZESPÓŁ")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ludzie New European Strategies" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Zespół analityczny i doradczy.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anna Kowalska" })).toBeInTheDocument();
    expect(screen.getByText("Zarząd")).toBeInTheDocument();
    expect(screen.getByText("Dyrektorka programu")).toBeInTheDocument();
    expect(screen.getByText("Dwadzieścia lat w dyplomacji europejskiej.")).toBeInTheDocument();
  });

  it("pomija osobę bez imienia - to ona jest dostępną etykietą kafelka", () => {
    const { container } = paint(FULL);
    expect(container.querySelectorAll("[data-team-grid-member]")).toHaveLength(2);
    expect(container.querySelector('[data-team-grid-member="m-blank"]')).toBeNull();
  });

  it("zaokrąglenie jedzie JEDNĄ zmienną - 6 px domyślnie, ustawienie nadpisuje", () => {
    const { container } = paint(FULL);
    const root = container.querySelector(".cms-team-grid") as HTMLElement;
    expect(root.style.getPropertyValue("--tg-radius")).toBe("6px");

    const custom = paint({ ...FULL, radius: 16 });
    const customRoot = custom.container.querySelector(".cms-team-grid") as HTMLElement;
    expect(customRoot.style.getPropertyValue("--tg-radius")).toBe("16px");
  });

  it("zdjęcie osoby jest prawdziwym <img>, a brak zdjęcia daje inicjały", () => {
    const { container } = paint(FULL);
    const anna = container.querySelector('[data-team-grid-member="m-anna"]');
    expect(anna?.querySelector("img")).toBeTruthy();
    const marek = container.querySelector('[data-team-grid-member="m-marek"]');
    expect(marek?.querySelector("img")).toBeNull();
    expect(marek?.textContent).toContain("MN");
  });

  it("pusta lista: strona publiczna nie rysuje nic, kanwa pokazuje podpowiedź", () => {
    const { container } = paint({ ...FULL, members: [] });
    expect(container.querySelector(".cms-team-grid")).toBeNull();

    const canvas = paint({ ...FULL, members: [] }, "pl", true);
    expect(canvas.container.querySelector("[data-team-grid-empty]")).toBeTruthy();
    expect(screen.getByText(realT("pl")("teamGrid.empty"))).toBeInTheDocument();
  });
});

describe("TeamMemberGridWidget - okno pełnej kartoteki", () => {
  it("klik otwiera okno z rolą, afiliacją, projektami, kontaktem i social media", () => {
    paint(FULL);
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    const t = realT("pl");
    expect(screen.getByText(t("teamGrid.dialog.role"))).toBeInTheDocument();
    expect(screen.getByText(t("teamGrid.dialog.affiliation"))).toBeInTheDocument();
    expect(screen.getByText(t("teamGrid.dialog.projects"))).toBeInTheDocument();
    expect(screen.getByText(t("teamGrid.dialog.contact"))).toBeInTheDocument();
    expect(screen.getByText(t("teamGrid.dialog.social"))).toBeInTheDocument();

    expect(screen.getByText("Uniwersytet Warszawski")).toBeInTheDocument();
    // Przynależność projektowa -> plakietki, puste wpisy po przecinku odpadają.
    expect(screen.getByText("Bałkany")).toBeInTheDocument();
    expect(screen.getByText("Energia")).toBeInTheDocument();

    expect(screen.getByText("anna@example.org").closest("a")).toHaveAttribute(
      "href",
      "mailto:anna@example.org",
    );
    expect(screen.getByText("+48 600 000 000").closest("a")).toHaveAttribute(
      "href",
      "tel:+48 600 000 000",
    );
    expect(screen.getByText(t("teamGrid.dialog.profileLink")).closest("a")).toHaveAttribute(
      "href",
      "/author/anna-kowalska",
    );
  });

  it("pełny biogram jedzie jako sanityzowany HTML", () => {
    paint(FULL);
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    // <strong> przeżywa sanityzację, więc biogram jest HTML-em, nie tekstem.
    expect(screen.getByText("biogram").tagName).toBe("STRONG");
  });

  it("bez pełnego biogramu okno pokazuje skrót z kafelka JAKO TEKST", () => {
    paint({ ...FULL, members: [{ ...ANNA, fullBio_pl: "", fullBio_en: "" }] });
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Dwadzieścia lat w dyplomacji europejskiej.");
    expect(dialog.querySelector("strong")).toBeNull();
  });

  it("odsiewa niebezpieczne adresy social, zostawia poprawne", () => {
    paint(FULL);
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute(
      "href",
      "https://linkedin.com/in/anna",
    );
    expect(screen.getByRole("link", { name: "Website" })).toBeInTheDocument();
    // `javascript:` nie ma prawa stać się ikoną.
    expect(screen.queryByRole("link", { name: "X" })).toBeNull();
  });

  it("napisy okna idą za językiem TREŚCI, nie za językiem interfejsu", () => {
    paint(FULL, "en");
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    const en = realT("en");
    expect(screen.getByText(en("teamGrid.dialog.affiliation"))).toBeInTheDocument();
    expect(screen.getByText(en("teamGrid.dialog.projects"))).toBeInTheDocument();
    // …a treść też: rola i afiliacja w wersji angielskiej.
    expect(screen.getAllByText("Programme director").length).toBeGreaterThan(0);
    expect(screen.getByText("University of Warsaw")).toBeInTheDocument();
  });

  it("treść wpisana tylko po angielsku pokazuje się także w widoku PL", () => {
    // MAREK ma wyłącznie `role_en` - łańcuch fallbacków ma go pokazać,
    // zamiast zostawić pustą linię.
    paint(FULL);
    expect(screen.getByText("Senior fellow")).toBeInTheDocument();
  });

  it("PUSTY bliźniak językowy nie zatrzymuje fallbacku - kształt, który zapisuje PANEL", () => {
    // REGRESJA (Codex, P2). Panel zakłada świeżą osobę z KOMPLETEM pustych
    // bliźniaków (`blankMember()`: role_pl: "", role_en: "" …), więc łańcuch
    // `??` zatrzymywał się na `role_pl === ""` i wersja EN nigdy nie dojeżdżała.
    // Poprzedni test tego NIE łapał, bo jego fixtura POMIJAŁA klucz `role_pl`,
    // czyli sprawdzała kształt, którego panel nigdy nie produkuje.
    paint({
      ...FULL,
      // Nagłówek sekcji ma ten sam defekt i tę samą naprawę.
      heading_pl: "",
      heading_en: "People of New European Strategies",
      members: [
        {
          id: "m-panel",
          name: "Ewa Panel",
          role_pl: "",
          role_en: "Policy analyst",
          department_pl: "",
          department_en: "Research",
          bio_pl: "",
          bio_en: "Writes on enlargement.",
          affiliation_pl: "",
          affiliation_en: "College of Europe",
          projects_pl: "",
          projects_en: "Enlargement",
        },
      ],
    });

    expect(screen.getByText("Policy analyst")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Writes on enlargement.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "People of New European Strategies" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ewa Panel" }));
    expect(screen.getByText("College of Europe")).toBeInTheDocument();
    expect(screen.getByText("Enlargement")).toBeInTheDocument();
  });

  it("wersja w języku widoku WYGRYWA nad drugim językiem, gdy obie są wypełnione", () => {
    // Kontrola dodatnia do testu wyżej: „pierwsza niepusta" nie może zamienić
    // się w „którakolwiek niepusta".
    paint(FULL, "pl");
    expect(screen.getAllByText("Dyrektorka programu").length).toBeGreaterThan(0);
    expect(screen.queryByText("Programme director")).toBeNull();
  });

  it("po zamknięciu Escape'em fokus wraca na kafelek, z którego okno wyszło", async () => {
    // REGRESJA (Codex, P2), dwie przyczyny naraz:
    //  1. `onOpenChange` zeruje `openIndex` ZANIM zadziała `onCloseAutoFocus`,
    //     więc handler czytający stan widział `null`;
    //  2. tablica refów z inline'owym `ref={(el) => …}` jest odpinana (wpis
    //     `null`) przy każdym renderze, bo callback ma inną tożsamość - w chwili
    //     `onCloseAutoFocus` wpis był pusty. Zmierzone, nie zgadnięte.
    // Oba omija zapamiętanie ELEMENTU w `onClick`. `preventDefault()` pada
    // dziś tylko wtedy, gdy jest co ogniskować, więc przy zgubionym kafelku
    // Radix robi swoje, zamiast nie robić nic.
    //
    // ASERCJA JEST ASYNCHRONICZNA CELOWO: Radix przywraca fokus w późniejszym
    // takcie, więc synchroniczne `expect` widziałoby jeszcze <body> i test
    // oblewałby POPRAWNY kod. To nie jest obejście - to zgodność z tym, kiedy
    // zachowanie naprawdę zachodzi.
    paint(FULL);
    const card = screen.getByRole("button", { name: "Anna Kowalska" });
    card.focus();
    fireEvent.click(card);
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it("tryb editable (kanwa) NIE otwiera okna - właściwości ustawia panel boczny", () => {
    paint(FULL, "pl", true);
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wyłączone okno nie zostawia przycisku bez akcji", () => {
    const { container } = paint({ ...FULL, openPopup: false });
    expect(screen.queryByRole("button", { name: "Anna Kowalska" })).toBeNull();
    expect(container.querySelector('[data-team-grid-member="m-anna"]')?.tagName).toBe("DIV");
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
  });
});

describe("TeamMemberGridWidget - SSR i hydratacja", () => {
  // JEDEN węzeł na obie strony. Świeży `node()` per render dałby inne `id`,
  // czyli różnicę atrybutu `data-team-grid-id` - i test mierzyłby własną
  // fixturę zamiast widgetu (React zgłasza to jako OSTRZEŻENIE w konsoli,
  // nie jako błąd naprawialny, więc przeszedłby niezauważony).
  const NODE = node(FULL);
  const view = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <TeamMemberGridWidget node={NODE} lang="pl" />
      </QueryClientProvider>
    );
  };

  it("serwer rysuje twarze i treść kafelków - bez czekania na przeglądarkę", () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain("Anna Kowalska");
    expect(html).toContain("Ludzie New European Strategies");
    expect(html).toContain("https://cdn.example.org/anna.jpg");
    // Okno montuje się dopiero po kliknięciu, więc nie ma go w dokumencie SSR.
    expect(html).not.toContain("Uniwersytet Warszawski");
  });

  it("hydratacja nie zgłasza rozjazdu (DOM serwera == pierwszy DOM klienta)", async () => {
    const host = window.document.createElement("div");
    host.innerHTML = renderToString(view());
    window.document.body.append(host);
    const before = host.innerHTML;

    // DWA KANAŁY, BO REACT ZGŁASZA ROZJAZD DWIEMA DROGAMI: różnica STRUKTURY
    // idzie do `onRecoverableError`, a różnica samego ATRYBUTU - wyłącznie
    // ostrzeżeniem w konsoli ("some attributes … didn't match"). Test, który
    // czyta tylko pierwszy kanał, przepuszcza całą drugą klasę.
    const errors: unknown[] = [];
    const consoleErrors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    });
    const root = hydrateRoot(host, view(), {
      onRecoverableError: (error) => errors.push(error),
    });
    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(errors).toEqual([]);
      expect(consoleErrors.filter((m) => /hydrat|didn't match/i.test(m))).toEqual([]);
      expect(host.innerHTML).toBe(before);
    } finally {
      spy.mockRestore();
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("sonda kanału konsoli: rozjazd atrybutu NAPRAWDĘ jest przez ten test widziany", async () => {
    // Bez tej sondy asercja wyżej mogłaby być pusta na zawsze (np. gdyby React
    // przestał wypisywać ostrzeżenie), a test świeciłby na zielono, nie mierząc
    // niczego. Tu ROBIMY rozjazd celowo - i wymagamy, żeby został zauważony.
    const host = window.document.createElement("div");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const serverNode = node(FULL);
    const clientNode = node(FULL);
    host.innerHTML = renderToString(
      <QueryClientProvider client={qc}>
        <TeamMemberGridWidget node={serverNode} lang="pl" />
      </QueryClientProvider>,
    );
    window.document.body.append(host);

    const consoleErrors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    });
    const root = hydrateRoot(
      host,
      <QueryClientProvider client={qc}>
        <TeamMemberGridWidget node={clientNode} lang="pl" />
      </QueryClientProvider>,
    );
    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(consoleErrors.filter((m) => /hydrat|didn't match/i.test(m)).length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });
});

describe("TeamMemberGridWidget - pomocnicze", () => {
  it("teamGridInitials bierze najwyżej dwie pierwsze litery", () => {
    expect(teamGridInitials("Anna Kowalska")).toBe("AK");
    expect(teamGridInitials("Jan Maria Rokita")).toBe("JM");
    expect(teamGridInitials("Cher")).toBe("C");
    expect(teamGridInitials("   ")).toBe("");
  });

  it("teamGridProjects tnie po przecinku i odsiewa puste", () => {
    expect(teamGridProjects("Bałkany, Energia,  ")).toEqual(["Bałkany", "Energia"]);
    expect(teamGridProjects("")).toEqual([]);
  });

  it("teamGridMembers ignoruje wpisy, które nie są obiektami", () => {
    const members = teamGridMembers(
      { members: ["nie-obiekt", null, ["tablica"], ANNA] } as unknown as WidgetContent,
      "pl",
    );
    expect(members).toHaveLength(1);
    expect(members[0]?.name).toBe("Anna Kowalska");
  });

  it("teamGridMembers zwraca pustą listę dla treści bez kolekcji", () => {
    expect(teamGridMembers({} as WidgetContent, "pl")).toEqual([]);
    expect(teamGridMembers({ members: "nie-tablica" } as unknown as WidgetContent, "pl")).toEqual(
      [],
    );
  });
});
