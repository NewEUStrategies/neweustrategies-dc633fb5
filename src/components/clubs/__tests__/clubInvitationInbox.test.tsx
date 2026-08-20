// Skrzynka zaproszeń do klubów (`ClubInvitationInbox`).
//
// CO TEN PLIK DOWODZI.
// (1) ODPOWIEDŹ MA DWA ZNAKI, NIE JEDEN. Przyjęcie i odrzucenie wołają ten sam
//     `onRespond`, ale z RÓŻNYM drugim argumentem - i to jest jedyna rzecz,
//     która odróżnia wejście do klubu od zamknięcia zaproszenia na zawsze.
//     Test asertuje PARĘ (id, accept) dla obu dróg, bo pomyłka w drugim
//     argumencie jest niewidoczna w przeglądzie kodu i nieodwracalna dla
//     zapraszanego.
// (2) ODRZUCENIE PYTA, PRZYJĘCIE NIE. Kliknięcie odrzucenia NIE wysyła
//     odpowiedzi - otwiera potwierdzenie, a odpowiedź idzie dopiero
//     z potwierdzenia. Anulowanie zamyka je BEZ odpowiedzi. Regresja w tę
//     stronę kosztuje członkostwo w klubie, do którego nie ma drugiej drogi.
// (3) `pendingId` BLOKUJE SWÓJ WIERSZ, A SPINNER STOI TYLKO W NIM. Wspólna
//     flaga zapalała kółko we wszystkich wierszach naraz (patrz komentarz przy
//     propsie) - przy trzech zaproszeniach kliknięcie jednego wyglądało jak
//     przetwarzanie trzech. Dlatego test ma trzy wiersze, nie jeden: dowodzimy
//     jednocześnie, że przyciski są zablokowane WSZĘDZIE (druga odpowiedź
//     w locie to wyścig na serwerze) i że kółko świeci się w JEDNYM.
// (4) PUSTA LISTA NIE RYSUJE NAGŁÓWKA. Sekcja z licznikiem "0" i pustą listą
//     jest gorsza niż jej brak: zajmuje pierwszy ekran huba obietnicą, której
//     nie ma czym spełnić.
// (5) TREŚĆ WIERSZA JEST WARUNKOWA: nazwa klubu z JĘZYKA INTERFEJSU, dopisek
//     z wiadomością zapraszającego tylko wtedy, gdy coś w niej jest (pusty
//     ciąg nie może dokleić samego myślnika), termin ważności tylko wtedy,
//     gdy zaproszenie go ma.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `pickLocalized` - polityka języka ma własny test na czystej funkcji.
//     Tutaj dowodzimy WYŁĄCZNIE, że skrzynka jej używa (nazwa klubu jedzie
//     przez nią, nie przez `club_name_pl` na sztywno).
// (b) `formatDateShort` - format daty zależy od ICU, nie od produktu. Asercja
//     idzie na KLUCZ i18n z parametrem, a nie na napis z `Intl`.
// (c) Radixowego `AlertDialog` - to biblioteka i nie otwiera się pod happy-dom
//     bez pełnego API wskaźnika. W miejsce dialogu stoi atrapa sterowana
//     propsem `open`, bo przedmiotem dowodu jest POTWIERDZENIE (treść ma
//     istnieć dopiero po otwarciu), a nie warstwa nakładki.
// (d) Warstwy danych zaproszeń (`respondToClubInvitation`, unieważnienia
//     kluczy) - skrzynka dostaje `onRespond` propsem i nie wie o RPC.
//
// DWIE GAŁĘZIE ŚWIADOMIE NIEDOBITE - i to nie jest luka w testach.
// - `inv.message !== null` i `inv.expires_at !== null`: `ClubMyInvitationRow`
//   to `RowOf<Fn["club_my_invitations"]["Returns"]>` BEZ korekty nullowalności,
//   więc oba pola są w typie `string`. Podanie `null` wymagałoby rzutowania,
//   którego reguły repozytorium zabraniają. Pustą wiadomość pokrywa `""`
//   (drugi członek koniunkcji), a obrona przed `null` zostaje jako obrona.
// - `if (declining !== null)` w akcji potwierdzenia: przy zamkniętym dialogu
//   przycisk potwierdzenia nie jest wyrenderowany, więc kliknięcie z pustym
//   stanem nie ma jak nastąpić. To podwójna obrona nad stanem, który sam
//   zeruje się w tej samej funkcji.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Atrapa potwierdzenia: `open` steruje widocznością treści, `AlertDialogCancel`
// zamyka je przez `onOpenChange(false)` - dokładnie tak, jak robi to Radix.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ open: boolean; close: () => void }>({
    open: false,
    close: () => undefined,
  });
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={{ open: open === true, close: () => onOpenChange?.(false) }}>
        <div data-testid="potwierdzenie" data-open={String(open === true)}>
          {children}
        </div>
      </Ctx.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return ctx.open ? <div data-testid="potwierdzenie-tresc">{children}</div> : null;
    },
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => {
      const ctx = React.useContext(Ctx);
      return (
        <button type="button" data-testid="potwierdzenie-anuluj" onClick={ctx.close}>
          {children}
        </button>
      );
    },
    AlertDialogAction: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <button type="button" data-testid="potwierdzenie-tak" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import { ClubInvitationInbox } from "@/components/clubs/organisms/ClubInvitationInbox";
import { myInvitationRow, NET_IDS, netIsoDays } from "@/test/clubs/networkScreenFixtures";

const respond = vi.fn();

beforeEach(() => {
  cleanup();
  respond.mockReset();
});

/** Wiersz zaproszenia po nazwie klubu - lista ma po jednym na klub. */
function row(name: string): HTMLElement {
  const item = screen.getByText(name).closest("li");
  if (item === null) throw new Error(`Brak wiersza zaproszenia dla ${name}`);
  return item;
}

describe("ClubInvitationInbox - pusta skrzynka", () => {
  it("nie rysuje sekcji, gdy nie ma ani jednego zaproszenia", () => {
    const { container } = render(
      <ClubInvitationInbox invitations={[]} pendingId={null} onRespond={respond} />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("club.invitations")).not.toBeInTheDocument();
  });
});

describe("ClubInvitationInbox - dane pełne", () => {
  it("pokazuje licznik, nazwę klubu w języku interfejsu, zapraszającego z wiadomością i termin", () => {
    render(
      <ClubInvitationInbox
        invitations={[myInvitationRow({ expires_at: netIsoDays(7) })]}
        pendingId={null}
        onRespond={respond}
      />,
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("club.invitations");
    expect(heading).toHaveTextContent("1");
    expect(screen.getByText("Klub energetyczny")).toBeInTheDocument();
    // Klucz z parametrem plus dopisek wiadomości w tym samym akapicie.
    expect(screen.getByText(/club\.invitedBy\(name=Jan Kowalski\)/)).toHaveTextContent(
      "Dołącz, przyda się twoja wiedza o bilansowaniu.",
    );
    expect(screen.getByText(/club\.hub\.inviteExpires/)).toBeInTheDocument();
  });

  it("przyjęcie wysyła (id, true) i nie otwiera potwierdzenia", () => {
    render(
      <ClubInvitationInbox
        invitations={[myInvitationRow()]}
        pendingId={null}
        onRespond={respond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "club.acceptInvitation" }));

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(NET_IDS.invitation, true);
    expect(screen.getByTestId("potwierdzenie")).toHaveAttribute("data-open", "false");
  });

  it("odrzucenie najpierw pyta - odpowiedź (id, false) idzie dopiero z potwierdzenia", () => {
    render(
      <ClubInvitationInbox
        invitations={[myInvitationRow()]}
        pendingId={null}
        onRespond={respond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "club.declineInvitation" }));
    expect(respond).not.toHaveBeenCalled();

    const dialog = screen.getByTestId("potwierdzenie-tresc");
    expect(dialog).toHaveTextContent("club.hub.declineTitle");
    // Pytanie nazywa klub, o którym mowa - inaczej przy trzech zaproszeniach
    // potwierdzenie dotyczy nie wiadomo którego.
    expect(dialog).toHaveTextContent("club.hub.declineBody(club=Klub energetyczny)");

    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(NET_IDS.invitation, false);
    // Po odpowiedzi potwierdzenie się zamyka - stan wraca do pustego.
    expect(screen.getByTestId("potwierdzenie")).toHaveAttribute("data-open", "false");
  });

  it("anulowanie zamyka potwierdzenie bez wysłania odpowiedzi", () => {
    render(
      <ClubInvitationInbox
        invitations={[myInvitationRow()]}
        pendingId={null}
        onRespond={respond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "club.declineInvitation" }));
    expect(screen.getByTestId("potwierdzenie")).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByTestId("potwierdzenie-anuluj"));

    expect(screen.getByTestId("potwierdzenie")).toHaveAttribute("data-open", "false");
    expect(screen.queryByTestId("potwierdzenie-tresc")).not.toBeInTheDocument();
    expect(respond).not.toHaveBeenCalled();
  });
});

describe("ClubInvitationInbox - dane częściowe", () => {
  it("pusta wiadomość nie dokleja myślnika do wiersza zapraszającego", () => {
    render(
      <ClubInvitationInbox
        invitations={[myInvitationRow({ message: "   " })]}
        pendingId={null}
        onRespond={respond}
      />,
    );

    const line = screen.getByText(/club\.invitedBy\(name=Jan Kowalski\)/);
    expect(line).toHaveTextContent("club.invitedBy(name=Jan Kowalski)");
    expect(line.textContent).not.toContain("-");
  });

  it("nazwa klubu spada na drugi język, gdy wersja polska jest pusta", () => {
    render(
      <ClubInvitationInbox
        invitations={[myInvitationRow({ club_name_pl: "" })]}
        pendingId={null}
        onRespond={respond}
      />,
    );

    expect(screen.getByText("Energy club")).toBeInTheDocument();
  });
});

describe("ClubInvitationInbox - wiersz w toku", () => {
  const trzy = [
    myInvitationRow({ id: "invitation-1", club_name_pl: "Klub pierwszy" }),
    myInvitationRow({ id: "invitation-2", club_name_pl: "Klub drugi" }),
    myInvitationRow({ id: "invitation-3", club_name_pl: "Klub trzeci" }),
  ];

  it("blokuje przyciski we wszystkich wierszach, ale kółko zapala tylko w swoim", () => {
    render(<ClubInvitationInbox invitations={trzy} pendingId="invitation-2" onRespond={respond} />);

    for (const name of ["Klub pierwszy", "Klub drugi", "Klub trzeci"]) {
      for (const button of within(row(name)).getAllByRole("button")) {
        expect(button).toBeDisabled();
      }
    }

    const wTokuAccept = within(row("Klub drugi")).getByRole("button", {
      name: "club.acceptInvitation",
    });
    expect(wTokuAccept.querySelector(".animate-spin")).not.toBeNull();

    for (const name of ["Klub pierwszy", "Klub trzeci"]) {
      const accept = within(row(name)).getByRole("button", { name: "club.acceptInvitation" });
      expect(accept.querySelector(".animate-spin")).toBeNull();
    }
  });

  it("bez wiersza w toku żaden przycisk nie jest zablokowany", () => {
    render(<ClubInvitationInbox invitations={trzy} pendingId={null} onRespond={respond} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeEnabled();
    }
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("3");
  });

  it("potwierdzenie dotyczy klubu z KLIKNIĘTEGO wiersza, nie pierwszego z listy", () => {
    render(<ClubInvitationInbox invitations={trzy} pendingId={null} onRespond={respond} />);

    fireEvent.click(
      within(row("Klub trzeci")).getByRole("button", { name: "club.declineInvitation" }),
    );
    expect(screen.getByTestId("potwierdzenie-tresc")).toHaveTextContent(
      "club.hub.declineBody(club=Klub trzeci)",
    );

    fireEvent.click(screen.getByTestId("potwierdzenie-tak"));
    expect(respond).toHaveBeenCalledWith("invitation-3", false);
  });
});
