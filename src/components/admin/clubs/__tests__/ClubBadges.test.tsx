// Atomy znaczników panelu klubów: KAŻDA wartość KAŻDEGO enuma dostaje ton.
//
// CO TO DOWODZI. Kolor tych znaczników jest nośnikiem znaczenia, a nie
// dekoracją (patrz nagłówek `ClubBadges.tsx`): czerwony = odcięte,
// bursztynowy = czeka na decyzję człowieka. Administrator skanuje tabelę
// wzrokiem PRZED przeczytaniem etykiet, więc znacznik z pustym tonem albo
// z tonem „nie tym" kłamie o stanie klubu w sposób, którego nie widać
// w recenzji kodu - `Record<ClubStatus, Tone>` nie pilnuje, żeby `frozen`
// był czerwony, tylko żeby COŚ tam było.
//
// Dlatego test jedzie tabelą przez pełne słowniki (`CLUB_STATUSES`,
// `CLUB_GROUP_STATUSES`, `CLUB_VISIBILITIES`, `CLUB_MEMBER_STATUSES`,
// `CLUB_MEMBER_ROLES`) i asertuje KLUCZ i18n oraz KLASĘ TONU - nigdy polskiego
// napisu, bo ten zmienia pierwsza poprawka literówki w słowniku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Nie testuje wartości poza zbiorem enuma -
// do znacznika ona nie dochodzi: wywołujący zawężają `string` z RPC słownikiem
// (`asStatus`/`asVisibility` w `ClubsTable.tsx`, `narrow()` w `types.ts`) i to
// TAM leży dowód degradacji, w testach tabeli i trasy. Tu wartość spoza zbioru
// wymagałaby rzutowania, którego reguły repozytorium zabraniają. (2) Nie
// testuje samego `Badge` z `components/ui` - to biblioteka. (3) Nie sprawdza
// istnienia kluczy w słownikach - robi to `adminClubsI18nLoading.gate.test.ts`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import {
  ClubGroupStatusBadge,
  ClubMemberStatusBadge,
  ClubRoleBadge,
  ClubStatusBadge,
  ClubVisibilityBadge,
} from "@/components/admin/clubs/atoms/ClubBadges";
import {
  CLUB_GROUP_STATUSES,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
} from "@/lib/clubs/types";

/**
 * Fragmenty klas rozpoznające ton. Celowo NIE cała klasa: pilnujemy
 * ZNACZENIA (czerwony/bursztynowy/zielony/niebieski/szary), a nie dokładnego
 * zestawu utilsów Tailwinda, który wolno przeformatować.
 */
const TONE_MARK = {
  neutral: "bg-muted",
  positive: "bg-emerald-500/10",
  attention: "bg-amber-500/10",
  danger: "bg-destructive/10",
  info: "bg-primary/10",
} as const;

type ToneName = keyof typeof TONE_MARK;

/** Element znacznika o danej treści (klucz i18n) - `Badge` renderuje `<div>`. */
function badgeWithKey(key: string): HTMLElement {
  return screen.getByText(key);
}

/** Ton odczytany z klasy - dokładnie jeden ton musi pasować. */
function toneOf(element: HTMLElement): ToneName[] {
  const className = element.className;
  return (Object.keys(TONE_MARK) as ToneName[]).filter((tone) =>
    className.includes(TONE_MARK[tone]),
  );
}

/** Wspólna asercja: klucz i18n + dokładnie jeden ton + ten oczekiwany. */
function expectBadge(key: string, tone: ToneName): void {
  const element = badgeWithKey(key);
  expect(toneOf(element), `znacznik ${key} musi mieć DOKŁADNIE jeden ton`).toEqual([tone]);
}

describe("ClubStatusBadge", () => {
  const EXPECTED: Record<(typeof CLUB_STATUSES)[number], ToneName> = {
    draft: "attention",
    active: "positive",
    archived: "neutral",
  };

  it.each(CLUB_STATUSES)("status klubu %s renderuje klucz i18n i swój ton", (status) => {
    render(<ClubStatusBadge status={status} />);
    expectBadge(`club.status.${status}`, EXPECTED[status]);
  });

  it("wersja robocza woła o decyzję, opublikowany nie - to różne tony", () => {
    // Regresja, którą to łapie: sklejenie obu stanów w jeden ton szary
    // sprawia, że lista klubów przestaje pokazywać, co jest niewidoczne
    // publicznie.
    render(
      <>
        <ClubStatusBadge status="draft" />
        <ClubStatusBadge status="active" />
      </>,
    );
    expect(toneOf(badgeWithKey("club.status.draft"))).not.toEqual(
      toneOf(badgeWithKey("club.status.active")),
    );
  });
});

describe("ClubGroupStatusBadge", () => {
  const EXPECTED: Record<(typeof CLUB_GROUP_STATUSES)[number], ToneName> = {
    draft: "attention",
    scheduled: "info",
    active: "positive",
    frozen: "danger",
    archived: "neutral",
  };

  it.each(CLUB_GROUP_STATUSES)("status działu %s renderuje klucz i18n i swój ton", (status) => {
    render(<ClubGroupStatusBadge status={status} />);
    expectBadge(`club.groupStatus.${status}`, EXPECTED[status]);
  });

  it("zamrożony dział jest CZERWONY, zarchiwizowany szary - odcięcie vs historia", () => {
    render(
      <>
        <ClubGroupStatusBadge status="frozen" />
        <ClubGroupStatusBadge status="archived" />
      </>,
    );
    expect(toneOf(badgeWithKey("club.groupStatus.frozen"))).toEqual(["danger"]);
    expect(toneOf(badgeWithKey("club.groupStatus.archived"))).toEqual(["neutral"]);
  });
});

describe("ClubVisibilityBadge", () => {
  const EXPECTED: Record<(typeof CLUB_VISIBILITIES)[number], ToneName> = {
    public: "info",
    members: "neutral",
    private: "attention",
    secret: "danger",
  };

  it.each(CLUB_VISIBILITIES)("widoczność %s renderuje klucz i18n i swój ton", (visibility) => {
    render(<ClubVisibilityBadge visibility={visibility} />);
    expectBadge(`club.visibility.${visibility}`, EXPECTED[visibility]);
  });

  it("`secret` NIE jest szary - to informacja o ryzyku, nie o domyślności", () => {
    // Nagłówek komponentu opisuje to jako regułę: treść klubu tajnego jest
    // niewidoczna nawet dla zalogowanych, więc znacznik nie może wyglądać
    // jak „ustawienie standardowe".
    render(<ClubVisibilityBadge visibility="secret" />);
    expect(toneOf(badgeWithKey("club.visibility.secret"))).toEqual(["danger"]);
  });
});

describe("ClubMemberStatusBadge", () => {
  const EXPECTED: Record<(typeof CLUB_MEMBER_STATUSES)[number], ToneName> = {
    active: "positive",
    pending: "attention",
    invited: "info",
    banned: "danger",
    left: "neutral",
  };

  it.each(CLUB_MEMBER_STATUSES)("status członka %s renderuje klucz i18n i swój ton", (status) => {
    render(<ClubMemberStatusBadge status={status} />);
    expectBadge(`club.memberStatus.${status}`, EXPECTED[status]);
  });

  it("`pending` i `banned` mają RÓŻNE tony - czeka na decyzję vs odcięty", () => {
    render(
      <>
        <ClubMemberStatusBadge status="pending" />
        <ClubMemberStatusBadge status="banned" />
      </>,
    );
    expect(toneOf(badgeWithKey("club.memberStatus.pending"))).toEqual(["attention"]);
    expect(toneOf(badgeWithKey("club.memberStatus.banned"))).toEqual(["danger"]);
  });
});

describe("ClubRoleBadge", () => {
  const EXPECTED: Record<(typeof CLUB_MEMBER_ROLES)[number], ToneName> = {
    lead: "info",
    moderator: "info",
    member: "neutral",
    observer: "neutral",
  };

  it.each(CLUB_MEMBER_ROLES)("rola %s renderuje klucz i18n i swój ton", (role) => {
    render(<ClubRoleBadge role={role} />);
    expectBadge(`club.role.${role}`, EXPECTED[role]);
  });

  it("role z władzą są wyróżnione, role bez - nie", () => {
    render(
      <>
        <ClubRoleBadge role="lead" />
        <ClubRoleBadge role="member" />
      </>,
    );
    expect(toneOf(badgeWithKey("club.role.lead"))).toEqual(["info"]);
    expect(toneOf(badgeWithKey("club.role.member"))).toEqual(["neutral"]);
  });
});

describe("wspólny szkielet znacznika", () => {
  it("każdy znacznik jest wariantem `outline` i nie łamie się w pół słowa", () => {
    // `whitespace-nowrap` to nie ozdoba: „oczekuje zatwierdzenia" złamane
    // w wąskiej kolumnie tabeli rozjeżdża wysokość wiersza w całej liście.
    render(<ClubStatusBadge status="active" />);
    const element = badgeWithKey("club.status.active");
    expect(element.className).toContain("whitespace-nowrap");
    expect(element.className).toContain("font-medium");
  });
});
