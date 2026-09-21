// Wzmianka jako wizytówka - `MentionTag`, `MentionAvatar`, `MentionPersonCard`,
// `MentionOrgCard`.
//
// CO TEN PLIK DOWODZI.
// (1) ETYKIETĄ JEST CZŁOWIEK, NIE UCHWYT. Gdy katalog zna slug, w linii tekstu
//     stoi nazwa z profilu; gdy nie zna - uczytelniony slug. W ŻADNYM stanie nie
//     pojawia się `@`. To jedyne miejsce, w którym ten kontrakt jest widoczny.
// (2) BRAK ZDJĘCIA SCHODZI INACZEJ W KAŻDYM WARIANCIE AWATARA. W biegu tekstu
//     wchodzi IKONA, bo inicjały tuż obok pełnego nazwiska czytają się jak
//     literówka („AAnna Nowak") - także dla czytnika zrzucającego tekst strony.
//     W karcie dymka jest miejsce, więc wchodzą inicjały.
// (3) FIRMA NIE ZOSTAWIA PO SOBIE ŚLADU. Bez firmy nie ma pustego `<span>` ani
//     separatora-sieroty; `showCompany={false}` zdejmuje ją mimo danych w
//     profilu (bylina ma własny tag firmy i nie chce jej dwa razy).
// (4) OSOBA I ORGANIZACJA TO DWA RÓŻNE CELE. Osoba niesie `data-mention` i
//     prowadzi do `/author/<slug>`; organizacja niesie `data-mention-org` i
//     prowadzi do `/organization/<slug>`. Obie wzmianki wyglądają w treści tak
//     samo, więc zlanie tych gałęzi daje link w nicość, który wygląda poprawnie.
// (5) WERYFIKACJA JEST OGŁOSZONA CZYTNIKOWI, nie tylko kolorem ikony.
// (6) PUSTE POLA NIE ZOSTAWIAJĄ PUSTYCH AKAPITÓW - brak biogramu i brak linii
//     tożsamości mają ZNIKAĆ, a nie renderować się jako pusty `line-clamp`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) SKŁADANIA TREŚCI z segmentów (`MentionText`, `ClubInlineText`) - tam
//     sprawdzamy, że wzmianka W OGÓLE trafia do tego komponentu i z jakimi
//     etykietami; tu sprawdzamy sam komponent.
// (b) `slugToDisplayName`, `identityLine`, `buildDirectory` - warstwa czysta ma
//     własną suitę `src/lib/mentions/__tests__/directory.test.ts`.
// (c) WARSTWY DANYCH `useMentionProfile` (klucz cache, mapowanie wiersza) - tu
//     jest atrapą; testujemy WIDOK stanu, nie sposób jego pobrania.
// (d) BIBLIOTEK: pozycjonowania i opóźnień Radiksa - dymek otwieramy fokusem
//     (dostępna droga klawiaturą) i czekamy `waitFor`, bez sterowania zegarem.
// (e) TŁUMACZEŃ. Etykiety wchodzą PROPSEM, więc komponent nie woła `t()` -
//     asercje idą na wartościach podanych przez test.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { MentionOrg, MentionPerson } from "@/lib/mentions/directory";
import type { MentionProfilePreview } from "@/lib/mentions/useMentionProfile";

const state = vi.hoisted(() => ({
  profile: { data: null as MentionProfilePreview | null, isPending: false },
  profileCalls: [] as Array<{ slug: string | null; lang: string; enabled: boolean }>,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/mentions/useMentionProfile", () => ({
  useMentionProfile: (slug: string | null, lang: string, enabled: boolean) => {
    state.profileCalls.push({ slug, lang, enabled });
    return state.profile;
  },
}));

import {
  MentionAvatar,
  MentionOrgCard,
  MentionPersonCard,
  MentionTag,
  type MentionTagLabels,
} from "@/components/mentions/MentionTag";

/** Etykiety są rozpoznawalne i ROZŁĄCZNE - test widzi, która weszła. */
const LABELS: MentionTagLabels = {
  noProfile: "etykieta.noProfile",
  viewProfile: "etykieta.viewProfile",
  verified: "etykieta.verified",
  viewOrg: "etykieta.viewOrg",
};

function person(over: Partial<MentionPerson> = {}): MentionPerson {
  return {
    kind: "person",
    slug: "anna-nowak",
    name: "Anna Nowak",
    avatarUrl: null,
    jobTitle: null,
    company: null,
    bio: null,
    verified: false,
    ...over,
  };
}

function org(over: Partial<MentionOrg> = {}): MentionOrg {
  return {
    kind: "org",
    slug: "acme",
    id: "org-1",
    name: "ACME Polska",
    logoUrl: null,
    description: null,
    ...over,
  };
}

function tagFor(slug: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-mention="${slug}"]`);
  if (found === null) throw new Error(`test: brak wzmianki o slugu "${slug}"`);
  return found;
}

function orgTagFor(slug: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-mention-org="${slug}"]`);
  if (found === null) throw new Error(`test: brak wzmianki organizacji "${slug}"`);
  return found;
}

/** Otwiera dymek DROGĄ KLAWIATURY (fokus), bez sterowania zegarem. */
async function openCard(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.focusIn(trigger);
  return await waitFor(() => screen.getByTestId("mention-preview"));
}

beforeEach(() => {
  state.profile = { data: null, isPending: false };
  state.profileCalls = [];
});

// ---------------------------------------------------------------------------
// Etykieta w biegu tekstu
// ---------------------------------------------------------------------------

describe("MentionTag - etykieta", () => {
  it("bierze nazwę z katalogu, gdy slug jest rozwiązany", () => {
    render(<MentionTag slug="anna-nowak" entity={person()} lang="pl" labels={LABELS} />);

    expect(tagFor("anna-nowak").textContent).toBe("Anna Nowak");
  });

  it("bez katalogu uczytelnia slug - i nadal BEZ małpy", () => {
    // Regresja, którą to łapie: stan zastępczy wracający do `@slug`. Nick jest
    // identyfikatorem technicznym; czytelnik ma widzieć człowieka.
    const { container } = render(
      <MentionTag slug="anna-nowak" entity={null} lang="pl" labels={LABELS} />,
    );

    expect(tagFor("anna-nowak").textContent).toBe("Anna Nowak");
    expect(container.textContent).not.toContain("@");
  });

  it("`className` DOKŁADA klasę wywołującego, nie podmienia własnych", () => {
    render(
      <MentionTag
        slug="anna-nowak"
        entity={person()}
        lang="pl"
        labels={LABELS}
        className="text-xs"
      />,
    );
    const link = tagFor("anna-nowak");

    expect(link.classList.contains("text-xs")).toBe(true);
    expect(link.classList.contains("font-medium")).toBe(true);
    expect(link.className).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// Awatar: dwa warianty, dwa sposoby na brak zdjęcia
// ---------------------------------------------------------------------------

describe("MentionAvatar", () => {
  it("wariant inline bez zdjęcia daje IKONĘ, nie inicjały", () => {
    const { container } = render(<MentionAvatar name="Anna Nowak" avatarUrl={null} />);
    const slot = container.querySelector("[data-mention-avatar]");

    expect(slot).not.toBeNull();
    expect(slot?.querySelector("svg")).not.toBeNull();
    expect(slot?.textContent).toBe("");
    expect(container.querySelector("img")).toBeNull();
  });

  it("wariant karty bez zdjęcia daje INICJAŁY wersalikami", () => {
    const { container } = render(
      <MentionAvatar name="anna nowak" avatarUrl={null} variant="card" />,
    );

    expect(container.querySelector("[data-mention-avatar]")?.textContent).toBe("AN");
    expect(container.querySelector("img")).toBeNull();
  });

  it("ze zdjęciem daje leniwy obrazek bez opisu (nazwa stoi obok)", () => {
    const { container } = render(
      <MentionAvatar name="Anna Nowak" avatarUrl="https://cdn.example.com/a.jpg" />,
    );
    const image = container.querySelector("img");

    expect(image).toHaveAttribute("src", "https://cdn.example.com/a.jpg");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("data-mention-avatar", "");
  });

  it("awatar wzmianki jest dekoracją - czytnik go NIE ogłasza", () => {
    const { container } = render(<MentionAvatar name="Anna Nowak" avatarUrl={null} />);

    expect(container.querySelector("[data-mention-avatar]")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("MentionTag - awatar w linii tekstu", () => {
  it("osoba ze zdjęciem pokazuje obrazek przed nazwą", () => {
    render(
      <MentionTag
        slug="anna-nowak"
        entity={person({ avatarUrl: "https://cdn.example.com/a.jpg" })}
        lang="pl"
        labels={LABELS}
      />,
    );
    const image = tagFor("anna-nowak").querySelector("img");

    expect(image).toHaveAttribute("src", "https://cdn.example.com/a.jpg");
  });

  it("osoba bez zdjęcia pokazuje ikonę, nie inicjały obok nazwiska", () => {
    render(<MentionTag slug="anna-nowak" entity={person()} lang="pl" labels={LABELS} />);
    const link = tagFor("anna-nowak");

    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("[data-mention-avatar] svg")).not.toBeNull();
    // Cała widoczna treść to sama nazwa - inicjały by ją zdublowały.
    expect(link.textContent).toBe("Anna Nowak");
  });
});

// ---------------------------------------------------------------------------
// Firma w linii tekstu
// ---------------------------------------------------------------------------

describe("MentionTag - firma", () => {
  it("dokłada firmę do etykiety, gdy profil ją ma", () => {
    render(
      <MentionTag
        slug="anna-nowak"
        entity={person({ company: "ACME" })}
        lang="pl"
        labels={LABELS}
      />,
    );

    expect(tagFor("anna-nowak").textContent).toBe("Anna Nowak· ACME");
  });

  it("bez firmy nie zostawia separatora-sieroty ani pustego elementu", () => {
    // Regresja, którą to łapie: separator wyrenderowany poza warunkiem -
    // wzmianka kończy się wtedy wiszącą kropką („Anna Nowak ·").
    const { rerender } = render(
      <MentionTag
        slug="anna-nowak"
        entity={person({ company: "ACME" })}
        lang="pl"
        labels={LABELS}
      />,
    );
    const withCompany = tagFor("anna-nowak").querySelectorAll("span").length;

    rerender(<MentionTag slug="anna-nowak" entity={person()} lang="pl" labels={LABELS} />);
    const link = tagFor("anna-nowak");

    expect(link.textContent).toBe("Anna Nowak");
    expect(link.textContent).not.toContain("·");
    // Element firmy ZNIKA w całości - nie zostaje po nim pusty `span`.
    expect(link.querySelectorAll("span")).toHaveLength(withCompany - 1);
  });

  it("`showCompany={false}` zdejmuje firmę mimo danych w profilu", () => {
    // Bylina ma własny tag firmy (z dymkiem marki) - dublowanie jej w etykiecie
    // wzmianki dałoby „Anna Nowak · ACME · ACME".
    render(
      <MentionTag
        slug="anna-nowak"
        entity={person({ company: "ACME" })}
        lang="pl"
        labels={LABELS}
        showCompany={false}
      />,
    );

    expect(tagFor("anna-nowak").textContent).toBe("Anna Nowak");
  });

  it("organizacja nie dostaje firmy - to ona JEST firmą", () => {
    render(<MentionTag slug="acme" entity={org()} lang="pl" labels={LABELS} />);

    expect(orgTagFor("acme").textContent).toBe("ACME Polska");
  });
});

// ---------------------------------------------------------------------------
// Osoba kontra organizacja: dwa cele, dwa atrybuty, dwie karty
// ---------------------------------------------------------------------------

describe("MentionTag - osoba kontra organizacja", () => {
  it("osoba prowadzi do profilu autora i niesie `data-mention`", () => {
    render(<MentionTag slug="anna-nowak" entity={person()} lang="pl" labels={LABELS} />);
    const link = tagFor("anna-nowak");

    expect(link).toHaveAttribute("href", "/author/anna-nowak");
    expect(link).not.toHaveAttribute("data-mention-org");
  });

  it("nierozwiązany slug traktujemy jak osobę - profil bywa poza zasięgiem RLS", () => {
    render(<MentionTag slug="anna-nowak" entity={null} lang="pl" labels={LABELS} />);

    expect(tagFor("anna-nowak")).toHaveAttribute("href", "/author/anna-nowak");
  });

  it("organizacja niesie `data-mention-org` i prowadzi na stronę organizacji", () => {
    // Organizacja NIE jest autorem - `/author/acme` byłoby 404 przy wzmiance,
    // która w treści wygląda dokładnie tak samo jak wzmianka człowieka.
    render(<MentionTag slug="acme" entity={org()} lang="pl" labels={LABELS} />);
    const link = orgTagFor("acme");

    expect(link).toHaveAttribute("href", "/organization/acme");
    expect(link).not.toHaveAttribute("data-mention");
    expect(link.querySelector("[data-mention-avatar]")).not.toBeNull();
  });

  it("dymek organizacji pokazuje KARTĘ ORGANIZACJI, nie kartę osoby", async () => {
    render(
      <MentionTag
        slug="acme"
        entity={org({ description: "Operator sieci." })}
        lang="pl"
        labels={LABELS}
      />,
    );
    const card = await openCard(orgTagFor("acme"));

    expect(within(card).getByText("ACME Polska")).toBeInTheDocument();
    expect(within(card).getByText("Operator sieci.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: LABELS.viewOrg })).toHaveAttribute(
      "href",
      "/organization/acme",
    );
    expect(within(card).queryByText(LABELS.viewProfile)).toBeNull();
    // Katalog ma już wszystko - dymek organizacji NIE dociąga profilu osoby.
    expect(state.profileCalls).toEqual([]);
  });

  it("dymek osoby z katalogu też nie dociąga profilu", async () => {
    render(<MentionTag slug="anna-nowak" entity={person()} lang="pl" labels={LABELS} />);
    const card = await openCard(tagFor("anna-nowak"));

    expect(within(card).getByText("Anna Nowak")).toBeInTheDocument();
    expect(state.profileCalls).toEqual([]);
  });

  it("dymek nierozwiązanej wzmianki dociąga profil DOPIERO po otwarciu", async () => {
    render(<MentionTag slug="anna-nowak" entity={null} lang="en" labels={LABELS} />);

    expect(state.profileCalls).toEqual([]);

    const card = await openCard(tagFor("anna-nowak"));
    expect(state.profileCalls).toContainEqual({ slug: "anna-nowak", lang: "en", enabled: true });
    // Brak danych po zapytaniu mówi to wprost, a nie zostawia pustego pudełka.
    expect(within(card).getByText(LABELS.noProfile)).toBeInTheDocument();
  });

  it("dymek w trakcie ładowania pokazuje szkielety, a nie komunikat o braku", async () => {
    state.profile = { data: null, isPending: true };
    render(<MentionTag slug="anna-nowak" entity={null} lang="pl" labels={LABELS} />);
    const card = await openCard(tagFor("anna-nowak"));

    expect(card.querySelectorAll(".animate-pulse")).toHaveLength(3);
    expect(card.textContent).not.toContain(LABELS.noProfile);
  });

  it("`testId` zmienia identyfikator dymka - powierzchnie mają własne", async () => {
    render(
      <MentionTag
        slug="anna-nowak"
        entity={person()}
        lang="pl"
        labels={LABELS}
        testId="comment-mention-preview"
      />,
    );
    fireEvent.focusIn(tagFor("anna-nowak"));

    await waitFor(() => expect(screen.getByTestId("comment-mention-preview")).toBeInTheDocument());
    expect(screen.queryByTestId("mention-preview")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Karta osoby
// ---------------------------------------------------------------------------

describe("MentionPersonCard", () => {
  it("odznaka weryfikacji ma etykietę dostępności, nie tylko kolor", () => {
    render(<MentionPersonCard person={person({ verified: true })} labels={LABELS} />);

    expect(screen.getByLabelText(LABELS.verified)).toBeInTheDocument();
  });

  it("brak weryfikacji NIE rysuje odznaki", () => {
    render(<MentionPersonCard person={person({ verified: false })} labels={LABELS} />);

    expect(screen.queryByLabelText(LABELS.verified)).toBeNull();
  });

  it.each([
    {
      jobTitle: "Dyrektor",
      company: "ACME",
      expected: "Dyrektor · ACME",
      opis: "stanowisko i firma",
    },
    { jobTitle: "Dyrektor", company: null, expected: "Dyrektor", opis: "samo stanowisko" },
    { jobTitle: null, company: "ACME", expected: "ACME", opis: "sama firma" },
  ])("linia tożsamości: $opis -> $expected", ({ jobTitle, company, expected }) => {
    render(<MentionPersonCard person={person({ jobTitle, company })} labels={LABELS} />);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("bez stanowiska i firmy nie ma pustej linii tożsamości", () => {
    const { container } = render(<MentionPersonCard person={person()} labels={LABELS} />);

    // Sama nazwa. Drugi akapit znaczyłby pusty wiersz pod nazwiskiem.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("biogram, gdy jest, wchodzi jako osobny akapit", () => {
    const { container } = render(
      <MentionPersonCard
        person={person({ jobTitle: "Dyrektor", bio: "Pracuje nad korytarzem." })}
        labels={LABELS}
      />,
    );

    expect(screen.getByText("Pracuje nad korytarzem.")).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(3);
  });

  it.each([
    ["null", null],
    ["pusty napis", ""],
  ])("brak biogramu (%s) nie zostawia pustego akapitu", (_opis, bio) => {
    const { container } = render(
      <MentionPersonCard person={person({ jobTitle: "Dyrektor", bio })} labels={LABELS} />,
    );

    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("prowadzi do profilu osoby, a nie do sluga z linii tekstu", () => {
    render(<MentionPersonCard person={person({ slug: "anna-nowak" })} labels={LABELS} />);

    expect(screen.getByRole("link", { name: LABELS.viewProfile })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
  });
});

// ---------------------------------------------------------------------------
// Karta organizacji
// ---------------------------------------------------------------------------

describe("MentionOrgCard", () => {
  it("z logo pokazuje obrazek zamiast ikony zastępczej", () => {
    const { container } = render(
      <MentionOrgCard org={org({ logoUrl: "https://cdn.example.com/acme.png" })} labels={LABELS} />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example.com/acme.png",
    );
  });

  it("bez logo pokazuje ikonę, nie pustą ramkę", () => {
    const { container } = render(<MentionOrgCard org={org({ logoUrl: null })} labels={LABELS} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("bez opisu nie zostawia pustego akapitu", () => {
    const { container } = render(
      <MentionOrgCard org={org({ description: null })} labels={LABELS} />,
    );

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
