// Zakładka „Dostęp" edytora klubu - SKLEJENIE droplistów z żywym podglądem.
//
// CO TEN PLIK DOWODZI.
//   1. KAŻDA DROPLISTA EMITUJE SWÓJ KLUCZ ŁATKI. Sześć pól, sześć kluczy,
//      wszystkie są napisami - więc przeklejony blok z `whoCanPost` w miejscu
//      `moderationMode` przechodzi przez kompilator i przez recenzję, a psuje
//      realne uprawnienia klubu. Wykrywa to wyłącznie wywołanie KAŻDEGO pola.
//   2. PODGLĄD JEST WOŁANY, a nie tylko zadeklarowany: pięć zdań stoi
//      w kolejności pól i bierze się z TYCH SAMYCH kluczy i18n, co podpowiedzi
//      pod droplistami (ten sam klucz widnieje w dokumencie dwa razy).
//   3. OSTRZEŻENIA POJAWIAJĄ SIĘ NA KOMBINACJACH, nie na pojedynczych polach -
//      i to jest miejsce, w którym powstają kluby publiczne, które miały być
//      zamknięte. Bezpieczna kombinacja NIE pokazuje karty ostrzeżeń.
//   4. PRÓG PLANU NIE ZAPISUJE SIĘ BEZ ZMIANY, a przy randze spoza słownika
//      wybór widocznej pozycji zapisuje się jako realna zmiana.
//   5. `disabled` odcina WSZYSTKIE sześć droplistów.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguł zdania i ostrzeżeń
// (`lib/clubs/__tests__/accessSentence.test.ts`), słownika etykiet i warunku
// emisji progu (`adminClubAccessPreview.test.ts`), odwzorowania ranga -> plan
// (`planTiers.test.ts`) ani zachowania samej droplisty jako komponentu
// (`ClubEnumSelect`). Radix `Select` jest podmieniony na natywny `<select>`,
// bo pod happy-dom nie ma pełnego API wskaźnika.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { ClubAccessTab } from "@/components/admin/clubs/organisms/ClubAccessTab";
import type { ClubAccessDraftValues } from "@/lib/clubs/adminClubEditor";

const DRAFT: ClubAccessDraftValues = {
  visibility: "members",
  joinPolicy: "request",
  minTierRank: 20,
  attributionMode: "attributed",
  whoCanPost: "moderators",
  moderationMode: "trusted",
};

const onChange = vi.fn();

function panel(overrides: Partial<ClubAccessDraftValues> = {}, disabled?: boolean) {
  return render(
    <ClubAccessTab draft={{ ...DRAFT, ...overrides }} onChange={onChange} disabled={disabled} />,
  );
}

/**
 * Droplista identyfikowana po WARTOŚCI jednej ze swoich opcji - to jedyna
 * cecha, która odróżnia sześć droplistów o tym samym wyglądzie, a przy tym
 * jest tą samą cechą, którą sprawdza baza (CHECK na kolumnie).
 */
function selectWith(optionValue: string): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll("select")).find((select) =>
    Array.from(select.options).some((option) => option.value === optionValue),
  );
  if (found === undefined) throw new Error(`test: brak droplisty z opcją ${optionValue}`);
  return found;
}

function pick(optionValue: string, next: string): void {
  fireEvent.change(selectWith(optionValue), { target: { value: next } });
}

/** Zdania podglądu, w kolejności dokumentu (bez pozycji ostrzeżeń). */
function sentences(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "")
    .filter((text) => !text.startsWith("adminClubs.accessWarning."));
}

function warnings(): string[] {
  return screen
    .queryAllByRole("listitem")
    .map((item) => item.textContent ?? "")
    .filter((text) => text.startsWith("adminClubs.accessWarning."));
}

beforeEach(() => {
  cleanup();
  onChange.mockReset();
});

describe("ClubAccessTab - sześć pól, sześć kluczy łatki", () => {
  it("każde pole ma etykietę wiązaną z kontrolką po `id`", () => {
    panel();
    const bindings: [string, string][] = [
      ["adminClubs.fields.visibility", "club-visibility"],
      ["adminClubs.fields.joinPolicy", "club-join-policy"],
      ["adminClubs.fields.minTier", "club-min-tier"],
      ["adminClubs.fields.attributionMode", "club-attribution"],
      ["adminClubs.fields.whoCanPost", "club-who-can-post"],
      ["adminClubs.fields.moderationMode", "club-moderation"],
    ];
    for (const [labelKey, id] of bindings) {
      expect(screen.getByText(labelKey).getAttribute("for")).toBe(id);
    }
  });

  it("każda droplista wystawia CAŁY swój słownik - nie podzbiór", () => {
    panel();
    expect(selectWith("secret").options).toHaveLength(4);
    expect(selectWith("open").options).toHaveLength(3);
    expect(selectWith("presidents_circle").options).toHaveLength(8);
    expect(selectWith("chatham").options).toHaveLength(3);
    expect(selectWith("staff_only").options).toHaveLength(3);
    expect(selectWith("pre").options).toHaveLength(3);
  });

  it.each([
    ["secret", "public", { visibility: "public" }],
    ["open", "invite", { joinPolicy: "invite" }],
    ["chatham", "chatham", { attributionMode: "chatham" }],
    ["staff_only", "staff_only", { whoCanPost: "staff_only" }],
    ["pre", "pre", { moderationMode: "pre" }],
  ])("wybór %s -> %s emituje łatkę z własnym kluczem", (probe, next, expected) => {
    panel();
    pick(probe, next);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it("wartość wyświetlana każdej droplisty pochodzi z wersji roboczej", () => {
    panel({ visibility: "private", joinPolicy: "invite", moderationMode: "post" });
    expect(selectWith("secret").value).toBe("private");
    expect(selectWith("open").value).toBe("invite");
    expect(selectWith("pre").value).toBe("post");
  });
});

describe("ClubAccessTab - próg planu", () => {
  it("pokazuje plan odpowiadający zapisanej randze", () => {
    panel({ minTierRank: 25 });
    expect(selectWith("presidents_circle").value).toBe("vip");
  });

  it("wybór innego planu emituje jego RANGĘ, nie nazwę", () => {
    panel({ minTierRank: 20 });
    pick("presidents_circle", "partner");
    expect(onChange).toHaveBeenCalledWith({ minTierRank: 40 });
  });

  it("wybór planu, który już jest zapisany, NIE emituje niczego", () => {
    panel({ minTierRank: 20 });
    pick("presidents_circle", "pro");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przy randze spoza słownika wybór widocznej pozycji zapisuje realny próg", () => {
    // Ranga 35 (ręczny grant) wyświetla się jako `corporate` = 30. Wybór tej
    // pozycji wygląda jak brak zmiany, a jest obniżeniem progu - i właśnie
    // dlatego MUSI dojechać do zapisu, żeby stan zgadzał się z widokiem.
    panel({ minTierRank: 35 });
    expect(selectWith("presidents_circle").value).toBe("corporate");
    pick("presidents_circle", "corporate");
    expect(onChange).toHaveBeenCalledWith({ minTierRank: 30 });
  });
});

describe("ClubAccessTab - żywy podgląd zdania", () => {
  it("składa PIĘĆ zdań w kolejności pól formularza", () => {
    panel({ minTierRank: 0 });
    expect(sentences()).toEqual([
      "club.visibilityHint.members",
      "club.joinPolicy.request",
      "adminClubs.accessPreviewNoTier",
      "club.whoCanPost.moderators",
      "club.attributionHint.attributed",
    ]);
  });

  it("próg planu zamienia zdanie „bez wymagań” na zdanie o planie", () => {
    panel({ minTierRank: 25 });
    expect(sentences()[2]).toBe("club.planTierHint.vip");
    expect(sentences()).not.toContain("adminClubs.accessPreviewNoTier");
  });

  it("zmiana wersji roboczej rusza zdaniem w TEJ SAMEJ pozycji", () => {
    const { unmount } = panel({ visibility: "public" });
    expect(sentences()[0]).toBe("club.visibilityHint.public");
    unmount();
    panel({ visibility: "secret" });
    expect(sentences()[0]).toBe("club.visibilityHint.secret");
  });

  it("zdanie i podpowiedź pod polem to TEN SAM klucz - jedno źródło opisu", () => {
    panel();
    // Raz pod droplistą, raz w podglądzie. Rozjazd tych dwóch miejsc daje
    // panel, w którym pole mówi jedno, a podgląd drugie.
    expect(screen.getAllByText("club.visibilityHint.members")).toHaveLength(2);
    expect(screen.getAllByText("club.attributionHint.attributed")).toHaveLength(2);
    expect(screen.getAllByText("club.planTierHint.pro")).toHaveLength(2);
  });

  it("podgląd ma tytuł i znak wizualny na każdej pozycji", () => {
    panel();
    expect(screen.getByText("adminClubs.accessPreviewTitle")).not.toBeNull();
    const bullets = document.querySelectorAll("li > span[aria-hidden='true']");
    expect(bullets).toHaveLength(5);
  });
});

describe("ClubAccessTab - ostrzeżenia o kombinacjach", () => {
  it("bezpieczna kombinacja NIE pokazuje karty ostrzeżeń", () => {
    panel();
    expect(screen.queryByText("adminClubs.accessWarning.title")).toBeNull();
    expect(warnings()).toEqual([]);
  });

  it("klub publiczny z otwartym wejściem jest ostrzeżony", () => {
    panel({ visibility: "public", joinPolicy: "open" });
    expect(screen.getByText("adminClubs.accessWarning.title")).not.toBeNull();
    expect(warnings()).toEqual(["adminClubs.accessWarning.public_open"]);
  });

  it("klub ukryty z otwartym wejściem jest sprzeczny i też ostrzega", () => {
    panel({ visibility: "secret", joinPolicy: "open" });
    expect(warnings()).toEqual(["adminClubs.accessWarning.secret_public_entry"]);
  });

  it("Chatham House w klubie publicznym ostrzega osobno", () => {
    panel({ visibility: "public", joinPolicy: "request", attributionMode: "chatham" });
    expect(warnings()).toEqual(["adminClubs.accessWarning.chatham_public"]);
  });

  it("dwie pomyłki naraz dają DWIE pozycje, nie jedną", () => {
    panel({ visibility: "public", joinPolicy: "open", attributionMode: "chatham" });
    expect(warnings()).toEqual([
      "adminClubs.accessWarning.public_open",
      "adminClubs.accessWarning.chatham_public",
    ]);
  });
});

describe("ClubAccessTab - stan zablokowany", () => {
  it("`disabled` odcina wszystkie sześć droplistów", () => {
    panel({}, true);
    const selects = Array.from(document.querySelectorAll("select"));
    expect(selects).toHaveLength(6);
    for (const select of selects) expect(select.disabled).toBe(true);
  });

  it("bez `disabled` żadna droplista nie udaje zablokowanej", () => {
    panel();
    for (const select of Array.from(document.querySelectorAll("select"))) {
      expect(select.disabled).toBe(false);
    }
  });
});
