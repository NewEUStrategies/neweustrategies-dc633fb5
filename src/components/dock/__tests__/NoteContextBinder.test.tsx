// WIĄZANIE NOTATKI Z MATERIAŁEM - jedyny nadawca kontekstu dla notatnika w doku.
//
// CO TO DOWODZI. `NoteContextBinder` nic nie renderuje, więc żaden test widoku
// go nie widzi, a jedyny importer (`PostLayoutRenderer`) dowodzi własnych
// spraw i przy okazji wykonuje tylko szczęśliwą ścieżkę tego efektu. Zmierzone
// przed tym plikiem: instrukcje i wiersze 50%, funkcje 66,66%, GAŁĘZIE 16,66% -
// czyli komponent, który decyduje, do czego przypnie się notatka użytkownika,
// nie miał dowodu na ANI JEDNĄ ze swoich decyzji.
//
// Trzy decyzje, i wszystkie trzy mają skutek widoczny dla człowieka:
//   1. BEZ IDENTYFIKATORA NIE PUBLIKUJEMY NIC. Materiał bez `entityId` (szkic,
//      podgląd, widok bez rekordu) nie może podmienić kontekstu ustawionego
//      przez poprzedni materiał - inaczej notatka przypina się do nie tego.
//   2. ADRES DOMYŚLNY BIERZE SIĘ Z OKNA. Bez `url` notatka ma prowadzić z
//      powrotem tam, gdzie użytkownik ją pisał - razem z zapytaniem, bo to ono
//      niesie stronę listy albo zakładkę.
//   3. SPRZĄTANIE JEST ADRESOWANE. `clearNoteContext(entityId)` czyści TYLKO
//      własny wpis. Gdyby czyściło bezwarunkowo, przejście między materiałami
//      (odmontowanie starego PO zamontowaniu nowego) kasowałoby kontekst
//      świeżo ustawiony przez nowy - i notatnik traciłby przypięcie w chwili,
//      w której użytkownik właśnie zaczyna pisać.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NoteContextBinder } from "../NoteContextBinder";
import { clearNoteContext, getNoteContext } from "@/lib/dock/noteContext";

const WPIS = "11111111-2222-4333-8444-555555555555";
const INNY_WPIS = "99999999-8888-4777-8666-555555555555";

beforeEach(() => {
  clearNoteContext();
  window.history.replaceState(null, "", "/analiza/rozszerzenie-ue?strona=2");
});

afterEach(() => {
  cleanup();
  clearNoteContext();
});

describe("NoteContextBinder", () => {
  it("publikuje kontekst oglądanego materiału i nic nie renderuje", () => {
    const { container } = render(
      <NoteContextBinder entityType="post" entityId={WPIS} title="Rozszerzenie UE" />,
    );

    expect(container.innerHTML).toBe("");
    expect(getNoteContext()).toEqual({
      entityType: "post",
      entityId: WPIS,
      title: "Rozszerzenie UE",
      url: "/analiza/rozszerzenie-ue?strona=2",
    });
  });

  it("adres domyślny niesie ZAPYTANIE, nie samą ścieżkę", () => {
    // Zapytanie trzyma stronę listy albo wybraną zakładkę - bez niego link
    // z notatki wraca na inny widok niż ten, przy którym powstała.
    window.history.replaceState(null, "", "/raporty?strona=7&tab=zrodla");
    render(<NoteContextBinder entityType="page" entityId={WPIS} title="Raporty" />);

    expect(getNoteContext()?.url).toBe("/raporty?strona=7&tab=zrodla");
  });

  it("jawny `url` wygrywa z adresem okna", () => {
    render(
      <NoteContextBinder
        entityType="event"
        entityId={WPIS}
        title="Kongres"
        url="/wydarzenia/kongres-2099"
      />,
    );

    expect(getNoteContext()?.url).toBe("/wydarzenia/kongres-2099");
  });

  it("BEZ identyfikatora nie publikuje NICZEGO", () => {
    render(<NoteContextBinder entityType="post" entityId={null} title="Szkic bez rekordu" />);

    expect(getNoteContext()).toBeNull();
  });

  it("BEZ identyfikatora nie podmienia kontekstu ustawionego wcześniej", () => {
    // To jest skutek dla człowieka: gdyby podmieniał, notatka pisana przy
    // materiale A przypięłaby się do niczego, bo obok wyrenderował się widok
    // bez rekordu.
    render(<NoteContextBinder entityType="post" entityId={WPIS} title="Rozszerzenie UE" />);
    render(<NoteContextBinder entityType="page" entityId={undefined} title="Podgląd" />);

    expect(getNoteContext()?.entityId).toBe(WPIS);
  });

  it("odmontowanie czyści WŁASNY wpis", () => {
    const widok = render(
      <NoteContextBinder entityType="post" entityId={WPIS} title="Rozszerzenie UE" />,
    );
    expect(getNoteContext()?.entityId).toBe(WPIS);

    widok.unmount();

    expect(getNoteContext()).toBeNull();
  });

  it("odmontowanie NIE czyści kontekstu innego materiału", () => {
    // Przejście między materiałami odmontowuje stary binder PO zamontowaniu
    // nowego. Sprzątanie bezwarunkowe kasowałoby tu świeże przypięcie -
    // notatnik gubiłby materiał dokładnie wtedy, gdy użytkownik zaczyna pisać.
    const stary = render(
      <NoteContextBinder entityType="post" entityId={WPIS} title="Rozszerzenie UE" />,
    );
    render(<NoteContextBinder entityType="post" entityId={INNY_WPIS} title="Bałkany" />);
    expect(getNoteContext()?.entityId).toBe(INNY_WPIS);

    stary.unmount();

    expect(getNoteContext()?.entityId).toBe(INNY_WPIS);
  });

  it("zmiana tytułu przy tym samym materiale odświeża kontekst", () => {
    const widok = render(
      <NoteContextBinder entityType="post" entityId={WPIS} title="Tytuł roboczy" />,
    );

    widok.rerender(<NoteContextBinder entityType="post" entityId={WPIS} title="Tytuł końcowy" />);

    expect(getNoteContext()?.title).toBe("Tytuł końcowy");
    expect(getNoteContext()?.entityId).toBe(WPIS);
  });
});
