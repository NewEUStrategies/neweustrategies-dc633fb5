// Zakładka „Statystyki" edytora klubu - SKLEJENIE hooka, reguł i kafli.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY ZAPYTANIA, nie jeden. Zapytanie w locie daje szkielet
//      ogłoszony czytnikowi ekranu (`aria-busy`), awaria - JEDNO zdanie
//      zamiast dwunastu kafli z kreskami (kreski wyglądają jak dane zerowe,
//      a nie jak brak odczytu), dane - dwie sekcje.
//   2. KLUB BEZ RUCHU NIE WYWALA ZAKŁADKI. `admin_club_stats` oddaje `null`
//      dla klubu bez wiersza statystyk, a kafel pokazuje kreskę, nie `NaN`
//      ani gołe `undefined`.
//   3. DANE CZĘŚCIOWE gasną OSOBNO: brak mediany nie gasi odsetka.
//   4. TON KOLORU DOJEŻDŻA DO DOM-u. Próg jest regułą modułu, ale klasa
//      koloru powstaje w molekule kafla i tylko render pokazuje, że jedno
//      z drugim jest połączone.
//   5. ZAKŁADKA PYTA O SWÓJ KLUB - `clubId` z propsa jedzie do hooka.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tabeli przypadków odczytu metryk (zaokrąglenia,
// progi, „zero to dane", `NaN`) - to `lib/clubs/__tests__/adminClubStatsView.test.ts`
// na czystych funkcjach. Autorytetu RPC (`admin_club_stats` ma pgTAP) ani
// zachowania hooka (`clubHooks.test.tsx`). Asercje idą na KLUCZE i18n.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ClubStatsSource } from "@/lib/clubs/adminClubStatsView";

const h = vi.hoisted(() => ({
  data: null as unknown,
  isPending: false,
  isError: false,
  /** Identyfikatory, o które zakładka zapytała hooka. */
  calls: [] as (string | undefined)[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@/lib/clubs/useClubs", () => ({
  useAdminClubStats: (clubId: string | undefined) => {
    h.calls.push(clubId);
    return { data: h.data, isPending: h.isPending, isError: h.isError };
  },
}));

import { ClubStatsTab } from "@/components/admin/clubs/organisms/ClubStatsTab";

const CLUB_ID = "club-1";

function statsRow(overrides: Partial<ClubStatsSource> = {}): ClubStatsSource {
  return {
    member_count: 42,
    active_members_30d: 17,
    pending_members: 3,
    group_count: 5,
    thread_count: 120,
    reply_count: 640,
    threads_30d: 9,
    replies_30d: 51,
    unanswered_count: 7,
    unanswered_pct: 44.2,
    median_first_reply_hours: 6.25,
    leads_count: 2,
    moderators_count: 4,
    banned_count: 1,
    ...overrides,
  };
}

function panel() {
  return render(<ClubStatsTab clubId={CLUB_ID} />);
}

/** Kafel identyfikowany po kluczu etykiety: wartość, ton i podpowiedź. */
function tile(labelKey: string): { value: string; tone: string; hint: string | null } {
  const label = screen.getByText(labelKey);
  const content = label.parentElement?.parentElement;
  if (content === null || content === undefined)
    throw new Error(`test: kafel ${labelKey} bez treści`);
  const valueEl = content.children[1];
  const hintEl = content.children[2];
  return {
    value: valueEl?.textContent ?? "",
    tone: valueEl?.className ?? "",
    hint: hintEl?.textContent ?? null,
  };
}

beforeEach(() => {
  cleanup();
  h.data = null;
  h.isPending = false;
  h.isError = false;
  h.calls = [];
});

describe("ClubStatsTab - trzy stany zapytania", () => {
  it("zapytanie W LOCIE pokazuje szkielet ogłoszony czytnikowi ekranu", () => {
    h.isPending = true;
    const { container } = panel();

    const busy = container.querySelector("[aria-busy='true']");
    expect(busy).not.toBeNull();
    expect(busy?.querySelectorAll(".animate-pulse")).toHaveLength(8);
    // Ani jednej metryki: szkielet nie udaje danych.
    expect(screen.queryByText("adminClubs.stats.members")).toBeNull();
  });

  it("AWARIA pokazuje jedno zdanie, a nie dwanaście kafli z kreskami", () => {
    h.isError = true;
    panel();

    expect(screen.getByText("adminClubs.loadError")).not.toBeNull();
    expect(screen.queryByText("adminClubs.stats.healthTitle")).toBeNull();
    expect(screen.queryByText("adminClubs.stats.members")).toBeNull();
  });

  it("DANE pokazują dwie sekcje i dwanaście kafli", () => {
    h.data = statsRow();
    const { container } = panel();

    expect(screen.getByText("adminClubs.stats.healthTitle")).not.toBeNull();
    expect(screen.getByText("adminClubs.stats.healthHint")).not.toBeNull();
    expect(screen.getByText("adminClubs.stats.title")).not.toBeNull();
    expect(container.querySelectorAll(".text-2xl")).toHaveLength(12);
  });

  it("pyta hooka o SWÓJ klub - identyfikator nie może zginąć w propsach", () => {
    h.data = statsRow();
    panel();
    expect(h.calls).toContain(CLUB_ID);
  });
});

describe("ClubStatsTab - dane pełne", () => {
  beforeEach(() => {
    h.data = statsRow();
  });

  it("metryki zdrowia niosą wartość, jednostkę i licznik w podpowiedzi", () => {
    panel();

    expect(tile("adminClubs.stats.unanswered").value).toBe("44%");
    expect(tile("adminClubs.stats.unanswered").hint).toBe(
      "adminClubs.stats.unansweredHint(count=7)",
    );
    expect(tile("adminClubs.stats.firstReply").value).toBe("adminClubs.stats.hours(value=6.3)");
    expect(tile("adminClubs.stats.firstReply").hint).toBe("adminClubs.stats.firstReplyHint");
  });

  it("rytm klubu pokazuje okno 30 dni, a podpowiedź sumę CAŁKOWITĄ", () => {
    panel();

    expect(tile("adminClubs.stats.threads30d").value).toBe("9");
    expect(tile("adminClubs.stats.threads30d").hint).toBe(
      "adminClubs.stats.threads30dHint(count=120)",
    );
    expect(tile("adminClubs.stats.replies30d").value).toBe("51");
    expect(tile("adminClubs.stats.replies30d").hint).toBe(
      "adminClubs.stats.replies30dHint(count=640)",
    );
  });

  it("obsada klubu czyta osiem różnych kolumn", () => {
    panel();

    expect(tile("adminClubs.stats.members").value).toBe("42");
    expect(tile("adminClubs.stats.active30d").value).toBe("17");
    expect(tile("adminClubs.stats.pending").value).toBe("3");
    expect(tile("adminClubs.stats.groups").value).toBe("5");
    expect(tile("adminClubs.stats.threads").value).toBe("120");
    expect(tile("adminClubs.stats.leads").value).toBe("2");
    expect(tile("adminClubs.stats.moderators").value).toBe("4");
    expect(tile("adminClubs.stats.banned").value).toBe("1");
  });

  it("liczniki obsady są BEZ podpowiedzi - nie ma czego dopowiadać", () => {
    panel();
    expect(tile("adminClubs.stats.members").hint).toBeNull();
    expect(tile("adminClubs.stats.banned").hint).toBeNull();
  });
});

describe("ClubStatsTab - ton koloru dojeżdża do DOM-u", () => {
  it.each([
    [5, "text-emerald"],
    [25, "text-amber"],
    [55, "text-destructive"],
  ])("odsetek %i bez odpowiedzi maluje wartość klasą %s", (pct, expected) => {
    h.data = statsRow({ unanswered_pct: pct });
    panel();
    expect(tile("adminClubs.stats.unanswered").tone).toContain(expected);
  });

  it("mediana ponad trzy dni jest czerwona, a poniżej doby zielona", () => {
    h.data = statsRow({ median_first_reply_hours: 100 });
    panel();
    expect(tile("adminClubs.stats.firstReply").tone).toContain("text-destructive");

    cleanup();
    h.data = statsRow({ median_first_reply_hours: 2 });
    panel();
    expect(tile("adminClubs.stats.firstReply").tone).toContain("text-emerald");
  });

  it("obsada klubu NIE dostaje koloru - żadna z tych liczb nie jest zła", () => {
    h.data = statsRow();
    panel();
    const tone = tile("adminClubs.stats.pending").tone;
    expect(tone).not.toContain("text-destructive");
    expect(tone).not.toContain("text-amber");
    expect(tone).not.toContain("text-emerald");
  });
});

describe("ClubStatsTab - dane puste i częściowe", () => {
  it("klub bez wiersza statystyk pokazuje kreski, a nie `undefined` ani `NaN`", () => {
    h.data = null;
    const { container } = panel();

    const values = Array.from(container.querySelectorAll(".text-2xl")).map(
      (node) => node.textContent ?? "",
    );
    expect(values).toHaveLength(12);
    expect(new Set(values)).toEqual(new Set(["-"]));
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN");
  });

  it("pusty klub nadal opisuje podpowiedzi licznikiem zero", () => {
    h.data = null;
    panel();
    expect(tile("adminClubs.stats.unanswered").hint).toBe(
      "adminClubs.stats.unansweredHint(count=0)",
    );
  });

  it("brak POLA OPCJONALNEGO gasi tylko swój kafel", () => {
    h.data = statsRow({ median_first_reply_hours: null, unanswered_count: null });
    panel();

    expect(tile("adminClubs.stats.firstReply").value).toBe("-");
    // Kafel bez danych nie ma prawa świecić - ani na zielono, ani na czerwono.
    expect(tile("adminClubs.stats.firstReply").tone).not.toContain("text-emerald");
    expect(tile("adminClubs.stats.firstReply").tone).not.toContain("text-destructive");
    expect(tile("adminClubs.stats.unanswered").value).toBe("44%");
    expect(tile("adminClubs.stats.unanswered").hint).toBe(
      "adminClubs.stats.unansweredHint(count=0)",
    );
  });

  it("zerowe metryki pokazują zera i zieleń, a nie kreski", () => {
    h.data = statsRow({
      unanswered_pct: 0,
      median_first_reply_hours: 0,
      threads_30d: 0,
      member_count: 0,
    });
    panel();

    expect(tile("adminClubs.stats.unanswered").value).toBe("0%");
    expect(tile("adminClubs.stats.unanswered").tone).toContain("text-emerald");
    expect(tile("adminClubs.stats.firstReply").value).toBe("adminClubs.stats.hours(value=0.0)");
    expect(tile("adminClubs.stats.threads30d").value).toBe("0");
    expect(tile("adminClubs.stats.members").value).toBe("0");
  });
});
