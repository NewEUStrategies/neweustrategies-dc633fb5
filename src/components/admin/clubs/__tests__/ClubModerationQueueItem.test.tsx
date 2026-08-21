// Molekuła: JEDNA pozycja kolejki premoderacji.
//
// CO TO DOWODZI. Karta pozycji kolejki jest miejscem, w którym moderator
// podejmuje decyzję o cudzej wypowiedzi - i to, co widzi, jest regułą, nie
// układem:
//
//   1. WPIS ANONIMOWY NIE POKAZUJE NAZWISKA. Pokazuje plakietkę anonimowości;
//      nazwisko wychodzi wyłącznie osobną, logowaną akcją ujawnienia.
//   2. PRZYCISK UJAWNIENIA ISTNIEJE TYLKO PRZY WPISIE ANONIMOWYM - przy
//      podpisanym nie ma czego ujawniać, a martwy przycisk uczy klikania.
//   3. KAŻDY Z PIĘCIU PRZYCISKÓW oddaje WŁASNE zdarzenie. `onDelete` jest
//      zdarzeniem „moderator chce usunąć”, a nie usunięciem: o potwierdzeniu
//      decyduje organizm.
//   4. TRWAJĄCA MUTACJA wyłącza trzy akcje kolejki, ale NIE redakcję: redakcja
//      otwiera formularz, nie wysyła niczego.
//   5. CYTAT TREŚCI JEST OBECNY W CAŁOŚCI w znaczniku (obcięcie jest klasą
//      `line-clamp-4`, nie ucięciem napisu) - decyzja na podstawie pierwszych
//      pięciu słów to nie moderacja.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdza rozbicia wsadu ani progu powodu
// ujawnienia (`moderationRules.test.ts`), nie woła RPC (molekuła nie zna
// klubu), nie testuje `Checkbox` z `components/ui`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));

import { ClubModerationQueueItem } from "@/components/admin/clubs/molecules/ClubModerationQueueItem";
import { moderationItem } from "@/test/clubs/fixtures";
import type { AdminClubModerationItem } from "@/lib/clubs/types";

/** Sześć zdarzeń, które molekuła ma oddać - każde osobno, bez zbiorczej mapy. */
function spySet() {
  return {
    onToggle: vi.fn<() => void>(),
    onApprove: vi.fn<() => void>(),
    onHide: vi.fn<() => void>(),
    onDelete: vi.fn<() => void>(),
    onEdit: vi.fn<() => void>(),
    onReveal: vi.fn<() => void>(),
  };
}

function renderItem(
  overrides: Partial<AdminClubModerationItem> = {},
  props: { selected?: boolean; pending?: boolean } = {},
) {
  const spies = spySet();
  render(
    <ul>
      <ClubModerationQueueItem
        item={moderationItem(overrides)}
        selected={props.selected ?? false}
        pending={props.pending ?? false}
        language="pl"
        onToggle={spies.onToggle}
        onApprove={spies.onApprove}
        onHide={spies.onHide}
        onDelete={spies.onDelete}
        onEdit={spies.onEdit}
        onReveal={spies.onReveal}
      />
    </ul>,
  );
  return spies;
}

function button(key: string): HTMLElement {
  const found = screen
    .getAllByRole("button")
    .find((element) => (element.textContent ?? "").includes(key));
  if (found === undefined) throw new Error(`brak przycisku dla klucza ${key}`);
  return found;
}

describe("pozycja kolejki - co widać", () => {
  it("wpis podpisany pokazuje autora, typ celu, tytuł i CAŁY cytat treści", () => {
    renderItem({
      target_type: "reply",
      author_name: "Anna Nowak",
      title: "Zgłoszona odpowiedź",
      body: "Pierwsze zdanie. Drugie zdanie. Trzecie zdanie.",
    });

    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.getByText("adminClubs.moderation.target.reply")).toBeTruthy();
    expect(screen.getByText("Zgłoszona odpowiedź")).toBeTruthy();
    const quote = screen.getByText("Pierwsze zdanie. Drugie zdanie. Trzecie zdanie.");
    expect(quote.className).toContain("line-clamp-4");
  });

  it("wpis anonimowy NIE pokazuje nazwiska, pokazuje plakietkę", () => {
    renderItem({ is_anonymous: true, author_name: "Anna Nowak" });

    expect(screen.queryByText("Anna Nowak")).toBeNull();
    expect(screen.getByText("adminClubs.moderation.anonymous")).toBeTruthy();
  });

  it("przycisk ujawnienia stoi WYŁĄCZNIE przy wpisie anonimowym", () => {
    const signed = renderItem({ is_anonymous: false });
    expect(
      screen
        .queryAllByRole("button")
        .filter((b) => (b.textContent ?? "").includes("moderation.reveal")),
    ).toHaveLength(0);
    expect(signed.onReveal).not.toHaveBeenCalled();
  });

  it("data wpisu jest sformatowana, a nie pokazana surowym ISO", () => {
    renderItem({ created_at: "2026-08-18T10:00:00.000Z" });

    expect(screen.queryByText("2026-08-18T10:00:00.000Z")).toBeNull();
  });
});

describe("pozycja kolejki - zdarzenia", () => {
  it("każdy przycisk oddaje WŁASNE zdarzenie", () => {
    const spies = renderItem({ is_anonymous: true });

    fireEvent.click(button("adminClubs.moderation.approve"));
    expect(spies.onApprove).toHaveBeenCalledTimes(1);

    fireEvent.click(button("adminClubs.moderation.hide"));
    expect(spies.onHide).toHaveBeenCalledTimes(1);

    fireEvent.click(button("adminClubs.moderation.delete"));
    expect(spies.onDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(button("adminClubs.moderation.edit"));
    expect(spies.onEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(button("adminClubs.moderation.reveal"));
    expect(spies.onReveal).toHaveBeenCalledTimes(1);
  });

  it("pole zaznaczenia odbija stan i oddaje przełączenie", () => {
    const spies = renderItem({ title: "Zgłoszony temat" }, { selected: true });

    const checkbox = screen.getByRole("checkbox", { name: "Zgłoszony temat" });
    expect(checkbox.getAttribute("data-state")).toBe("checked");

    fireEvent.click(checkbox);
    expect(spies.onToggle).toHaveBeenCalledTimes(1);
  });

  it("niezaznaczona pozycja ma pole puste", () => {
    renderItem({ title: "Zgłoszony temat" }, { selected: false });

    expect(
      screen.getByRole("checkbox", { name: "Zgłoszony temat" }).getAttribute("data-state"),
    ).toBe("unchecked");
  });

  it("trwająca mutacja wyłącza trzy akcje kolejki, ale NIE redakcję", () => {
    const spies = renderItem({}, { pending: true });

    expect(button("adminClubs.moderation.approve").hasAttribute("disabled")).toBe(true);
    expect(button("adminClubs.moderation.hide").hasAttribute("disabled")).toBe(true);
    expect(button("adminClubs.moderation.delete").hasAttribute("disabled")).toBe(true);

    fireEvent.click(button("adminClubs.moderation.edit"));
    expect(spies.onEdit).toHaveBeenCalledTimes(1);
  });
});
