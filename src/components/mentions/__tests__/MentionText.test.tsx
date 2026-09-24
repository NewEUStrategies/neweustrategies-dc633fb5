// Treść komentarza z @wzmiankami - `MentionText`.
//
// CO TEN PLIK DOWODZI.
// (1) NICKU NIE MA W TREŚCI. Wzmianka `@alice` renderuje się jako uczytelniona
//     nazwa („Alice"), a nie jako `@alice`. To jest CAŁA zmiana kontraktu:
//     małpa z uchwytem nie mówi czytelnikowi nic o tym, kogo wspomniano.
//     Regresja jest cicha - powrót do `raw` wygląda w przeglądarce „normalnie".
// (2) PRZED NAZWĄ STOI AWATAR. Element z `data-mention-avatar` jest PIERWSZYM
//     dzieckiem wyzwalacza; bez niego wzmianka zlewa się z resztą zdania.
// (3) CEL I KLUCZ ZOSTAJĄ TECHNICZNE. Link prowadzi do `/people/<slug>`, a slug
//     w `data-mention` jest małymi literami - spójnie z `process_mentions`,
//     które po tej samej postaci rozsyła powiadomienia.
// (4) TREŚĆ POZOSTAJE TEKSTEM. Budujemy węzły React, więc wrogi wpis nie
//     wstrzykuje znaczników, a adres e-mail nie staje się wzmianką.
// (5) DYMEK NALEŻY DO TEJ POWIERZCHNI: `data-testid="comment-mention-preview"`
//     i etykiety z przestrzeni `mentions.*`. Kluby mają własne id i własne
//     klucze - sklejenie ich wciągnęłoby overlay jednej powierzchni do drugiej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) REGUŁ PARSERA (granice wzmianki, `raw`, odtwarzalność wejścia) - to
//     `src/lib/mentions/__tests__/parse.test.ts`. Tu wchodzą tylko wejścia
//     prowadzące do RÓŻNYCH węzłów React.
// (b) WYGLĄDU WZMIANKI (awatar inline vs karta, firma, organizacja, odznaka) -
//     to `MentionTag.test.tsx`; tutaj sprawdzamy tylko, że `MentionText` w ogóle
//     oddaje sterowanie `MentionTag` i podaje mu etykiety swojej przestrzeni.
// (c) WARSTWY DANYCH `useMentionProfile` (klucz cache, `staleTime`, mapowanie
//     wiersza) - tu jest atrapą, bo testujemy WIDOK stanu, nie pobranie.
// (d) `slugToDisplayName` - ma własne przypadki w `directory.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { MentionProfilePreview } from "@/lib/mentions/useMentionProfile";
import type { MentionEntity } from "@/lib/mentions/directory";

/** Stan atrap: język UI i to, co „zwraca" leniwy dymek. */
const state = vi.hoisted(() => ({
  lang: "pl",
  profile: { data: null as MentionProfilePreview | null, isPending: false },
  profileCalls: [] as Array<{ slug: string | null; lang: string; enabled: boolean }>,
  /** Co „zna" katalog powierzchni - `null` znaczy brak dostawcy. */
  entity: null as MentionEntity | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => state.lang),
);
// <Link> czyta kontekst routera - w teście prezentacyjnym podmieniamy go na
// zwykłą kotwicę (współdzielony stub), żeby nie stawiać RouterProvidera.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/i18n-mentions", () => ({ ensureI18n: () => undefined }));
vi.mock("@/components/mentions/MentionDirectory", () => ({
  useMentionEntity: () => state.entity,
}));
vi.mock("@/lib/mentions/useMentionProfile", () => ({
  useMentionProfile: (slug: string | null, lang: string, enabled: boolean) => {
    state.profileCalls.push({ slug, lang, enabled });
    return state.profile;
  },
}));

import { MentionText } from "@/components/mentions/MentionText";

beforeEach(() => {
  state.lang = "pl";
  state.profile = { data: null, isPending: false };
  state.profileCalls = [];
  state.entity = null;
});

/** Wyzwalacz wzmianki o danym slugu - jedyny stabilny uchwyt w drzewie. */
function mentionFor(slug: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`a[data-mention="${slug}"]`);
  if (found === null) throw new Error(`test: brak wzmianki o slugu "${slug}"`);
  return found;
}

/** Otwiera dymek DROGĄ KLAWIATURY (fokus), bez sterowania zegarem. */
async function openCard(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.focusIn(trigger);
  return await waitFor(() => screen.getByTestId("comment-mention-preview"));
}

describe("MentionText - tekst wokół wzmianek", () => {
  it("zwykły tekst zostaje tekstem - zero linków", () => {
    const { container } = render(<MentionText body="just a normal comment" />);

    expect(container.textContent).toBe("just a normal comment");
    expect(container.querySelector("a")).toBeNull();
  });

  it("pusta treść nie renderuje nic", () => {
    const { container } = render(<MentionText body="" />);

    expect(container.textContent).toBe("");
  });

  it("adres e-mail NIE staje się wzmianką", () => {
    const { container } = render(<MentionText body="reach me at user@example.com ok" />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("reach me at user@example.com ok");
  });

  it("wrogie wejście zostaje tekstem - zero wstrzykniętego znacznika", () => {
    const { container } = render(<MentionText body={"<img src=x onerror=alert(1)> @bob"} />);

    // Jedyny `img` w drzewie mógłby pochodzić z awatara - tu awatara nie ma
    // (profil nierozwiązany), więc brak `img` dowodzi braku wstrzyknięcia.
    expect(container.querySelector("img")).toBeNull();
    expect(mentionFor("bob")).toBeInTheDocument();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("MentionText - wzmianka bez nicku", () => {
  it("etykietą jest uczytelniony slug, a nie `@slug`", () => {
    const { container } = render(<MentionText body="thanks @Alice for this" />);
    const link = mentionFor("alice");

    expect(link.textContent).toBe("Alice");
    // Regresja, którą to łapie: powrót do `raw` z parsera. Małpy nie ma
    // NIGDZIE w treści - ani w etykiecie, ani wokół niej.
    expect(container.textContent).toBe("thanks Alice for this");
    expect(container.textContent).not.toContain("@");
  });

  it("wielowyrazowy slug rozkłada się na słowa z wielkich liter", () => {
    render(<MentionText body="cc @anna-nowak" />);

    expect(mentionFor("anna-nowak").textContent).toBe("Anna Nowak");
  });

  it("niesie kanoniczny slug i prowadzi do profilu autora", () => {
    render(<MentionText body="thanks @Alice for this" />);
    const link = mentionFor("alice");

    // Widoczna etykieta ma wielką literę, klucz notyfikacji - małą.
    expect(link).toHaveAttribute("data-mention", "alice");
    expect(link).toHaveAttribute("href", "/people/alice");
  });

  it("przed nazwą stoi awatar (pierwsze dziecko wyzwalacza)", () => {
    render(<MentionText body="thanks @alice" />);
    const chip = mentionFor("alice").firstElementChild;
    const avatar = chip?.firstElementChild;

    expect(avatar).not.toBeNull();
    expect(avatar).toHaveAttribute("data-mention-avatar", "");
  });

  it("kilka wzmianek daje kilka osobnych linków, w kolejności wystąpienia", () => {
    const { container } = render(<MentionText body="cc @jan and @anna-k" />);
    const links = Array.from(container.querySelectorAll("a[data-mention]"));

    expect(links.map((l) => l.getAttribute("data-mention"))).toEqual(["jan", "anna-k"]);
    expect(links.map((l) => l.textContent)).toEqual(["Jan", "Anna K"]);
  });

  it("`mentionClassName` DOKŁADA klasę wywołującego, nie podmienia własnych", () => {
    render(<MentionText body="cc @alice" mentionClassName="text-xs" />);
    const link = mentionFor("alice");

    expect(link.classList.contains("text-xs")).toBe(true);
    expect(link.classList.contains("text-primary")).toBe(true);
  });
});

describe("MentionText - dymek powierzchni komentarzy", () => {
  it("NIE pyta o profil przed otwarciem dymka", async () => {
    // Treść dymka mieszka w portalu Radiksa, więc przed otwarciem hook nie
    // zostaje nawet wywołany. Regresja, którą to łapie: wyniesienie zapytania
    // do wyzwalacza - wtedy komentarz z dwudziestoma wzmiankami robi dwadzieścia
    // wyjść do bazy przy pierwszym malowaniu.
    render(<MentionText body="cc @alice i @jan" />);

    expect(state.profileCalls).toEqual([]);

    await openCard(mentionFor("alice"));
    expect(state.profileCalls.map((call) => call.slug)).toEqual(["alice"]);
  });

  it("ma własne `data-testid` i etykiety z przestrzeni `mentions.*`", async () => {
    render(<MentionText body="cc @alice" />);
    const card = await openCard(mentionFor("alice"));

    // Nierozwiązany profil mówi to wprost - kluczem tej powierzchni, nie klubu.
    expect(within(card).getByText("mentions.noProfile")).toBeInTheDocument();
  });

  it("rozwiązany profil pokazuje nazwę i odnośnik `mentions.viewProfile`", async () => {
    state.profile = {
      data: {
        kind: "person",
        id: "person-1",
        slug: "alice",
        name: "Alice Kowalska",
        avatarUrl: null,
        logoUrl: null,
        jobTitle: null,
        company: null,
        website: null,
        bio: null,
        verified: false,
      },
      isPending: false,
    };
    render(<MentionText body="cc @alice" />);
    const card = await openCard(mentionFor("alice"));

    expect(within(card).getByText("Alice Kowalska")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "mentions.viewProfile" })).toHaveAttribute(
      "href",
      "/people/alice",
    );
  });

  it.each([
    ["pl", "pl"],
    ["en", "en"],
    ["en-GB", "en"],
    ["de", "pl"],
  ])("język UI %s dociąga biogram w wersji %s", async (uiLanguage, expected) => {
    // Biogram ma dwie kolumny (`bio_pl`/`bio_en`) - zły język to cudzy tekst
    // w dymku, a nie brak tekstu, więc nikt tego nie zgłosi jako błąd.
    state.lang = uiLanguage;
    render(<MentionText body="cc @alice" />);
    await openCard(mentionFor("alice"));

    const enabled = state.profileCalls.filter((call) => call.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.every((call) => call.lang === expected)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wzmianka firmy: ten sam zapis w treści, inny cel
// ---------------------------------------------------------------------------

describe("MentionText - wzmianka firmy", () => {
  const ACME: MentionEntity = {
    kind: "org",
    slug: "org-123e4567-e89b-12d3-a456-426614174000",
    id: "123e4567-e89b-12d3-a456-426614174000",
    name: "ACME Polska",
    logoUrl: null,
    description: "Energetyka",
    website: null,
  };

  it("firma NIE jest autorem - prowadzi na profil organizacji, nie do /author", () => {
    state.entity = ACME;

    const { container } = render(
      <MentionText body="cc @org-123e4567-e89b-12d3-a456-426614174000" />,
    );

    // Cel osoby byłby tu 404: slug firmy nie istnieje w przestrzeni profili.
    expect(
      container.querySelector('a[data-mention="org-123e4567-e89b-12d3-a456-426614174000"]'),
    ).toBeNull();
    const link = container.querySelector<HTMLElement>("a[data-mention-org]");
    expect(link?.getAttribute("data-mention-org")).toBe("org-123e4567-e89b-12d3-a456-426614174000");
    expect(link?.getAttribute("href")).toBe(
      "/organization/org-123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("etykietą jest NAZWA firmy, nigdy identyfikator ze sluga", () => {
    state.entity = ACME;

    const { container } = render(
      <MentionText body="cc @org-123e4567-e89b-12d3-a456-426614174000" />,
    );

    expect(container.textContent).toContain("ACME Polska");
    expect(container.textContent).not.toContain("org-123e4567");
    expect(container.textContent).not.toContain("@");
  });
});
