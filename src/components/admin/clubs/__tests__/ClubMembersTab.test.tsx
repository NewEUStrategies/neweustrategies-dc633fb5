// Zakładka „Członkowie” - SKLEJENIE składu klubu z czterema mutacjami.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY LISTY MAJĄ TRZY WIDOKI: szkielet w locie, komunikat pustki
//      i tabela. Szkielet nie może wyglądać jak „brak członków” - administrator
//      dodaje wtedy osobę, która już jest w klubie.
//   2. DANE CZĘŚCIOWE (brak stanowiska, brak kadencji, brak firmy) renderują
//      się bez gołego `undefined` i bez pustego przycisku w kolumnie kadencji.
//   3. OBA ZAPYTANIA jadą z tym samym oknem strony i RÓŻNYMI filtrami: kolejka
//      próśb jest wołana osobno, więc nie znika po przełączeniu filtra.
//   4. LICZNIK KOLEJKI czyta `total_count` z wiersza, nie długość tablicy -
//      i mówi wprost, że strona została ucięta.
//   5. ZATWIERDZENIE PROŚBY ZACHOWUJE ROLĘ z wiersza (prośba z linku niosącego
//      rolę moderatora nie może po cichu zejść do `member`).
//   6. OPERACJE NIEODWRACALNE (usunięcie członka, odrzucenie prośby) NIE lecą
//      z kliknięcia - lecą z potwierdzenia. Dowodzimy obu stron: bez
//      potwierdzenia mutacja nie wychodzi, po potwierdzeniu wychodzi z
//      właściwym identyfikatorem i właściwym komunikatem.
//   7. OBA WARIANTY WIERSZA (tabela od `lg`, karta poniżej) wołają TE SAME
//      operacje - to jest cała racja bytu drugiego wariantu.
//   8. ZAZNACZENIE dotyczy widocznej strony, pasek masowy pokazuje się dopiero
//      po zaznaczeniu, a udana operacja masowa zaznaczenie ZDEJMUJE.
//   9. KAŻDA AWARIA MUTACJI kończy się komunikatem błędu i BRAKIEM
//      wyzerowania pola - inaczej administrator traci to, co wpisał.
//  10. BRAMKI PUSTKI działają także wtedy, gdy handler zostanie wywołany przy
//      zgaszonym przycisku (klawiatura, podwójne kliknięcie).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł składu - tabela przypadków jest
// w `lib/clubs/__tests__/adminMemberRoster.test.ts`; tutaj dowodzimy, że
// organizm je WOŁA i co robi z wynikiem. (2) Plakietki statusu -
// `ClubBadges.test.tsx`. (3) Wyszukiwarki osób (`MemberPicker`) - należy do
// panelu społeczności, tu jest atrapą oddającą `onChange`. (4) Mechaniki
// Radiksa: `Select`, `Checkbox` i `Dialog` nie działają pod happy-dom bez
// pełnego pointer API, więc mają natywne odpowiedniki.
//
// ATRAPA PRZYCISKU - RZECZ DO ZROZUMIENIA PRZED CZYTANIEM ASERCJI. Prawdziwy
// `Button` oddaje `disabled` natywnemu przyciskowi, a React nie woła wtedy
// handlera - czyli bramki wewnątrz handlerów byłyby NIESPRAWDZALNE, choć to
// one bronią przed podwójnym kliknięciem i wywołaniem z klawiatury. Atrapa
// trzyma więc stan zgaszenia w `aria-disabled` i handler PUSZCZA. Dlatego
// asercje „przycisk zgaszony” patrzą na `aria-disabled`, a nie na `disabled`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import type { ClubMembersPage } from "@/lib/clubs/api";
import type { ClubMemberRole, ClubMemberStatus } from "@/lib/clubs/types";
import type { AdminMemberUpsert } from "@/lib/clubs/adminMemberRoster";

/** Kształt argumentów `useClubMembers` - tylko to, co czyta atrapa. */
type ZapytanieSkladu = {
  clubId: string;
  status?: ClubMemberStatus | null;
  limit?: number;
  offset?: number;
};
type Wynik<T> = { onSuccess: (value: T) => void; onError: (error: unknown) => void };

const h = vi.hoisted(() => ({
  lista: undefined as ClubMembersPage | undefined,
  listaPending: false,
  listaError: false,
  kolejka: undefined as ClubMembersPage | undefined,
  zapytania: [] as ZapytanieSkladu[],
  upsertKlub: [] as string[],
  upsert: [] as AdminMemberUpsert[],
  upsertFails: false,
  upsertPending: false,
  usuniete: [] as string[],
  usuniecieFails: false,
  usunieciePending: false,
  masowe: [] as { userIds: string[]; role: ClubMemberRole }[],
  masoweZmienione: 2,
  masoweFails: false,
  masowePending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    className,
    type,
    ...reszta
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    className?: string;
    type?: "button" | "submit" | "reset";
    variant?: string;
    size?: string;
    "aria-label"?: string;
  }) => (
    <button
      type={type ?? "button"}
      className={className}
      aria-label={reszta["aria-label"]}
      aria-disabled={disabled === true}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));
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
      data-testid="select"
      value={value}
      disabled={disabled === true}
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
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    className,
    ...reszta
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    className?: string;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      className={className}
      aria-label={reszta["aria-label"]}
      checked={checked === true}
      onChange={() => onCheckedChange?.(checked !== true)}
    />
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) =>
    open === true ? (
      <div data-testid="dialog">
        <button type="button" data-testid="dialog-zamknij" onClick={() => onOpenChange?.(false)} />
        <button type="button" data-testid="dialog-otworz" onClick={() => onOpenChange?.(true)} />
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/admin/community/MemberPicker", () => ({
  MemberPicker: ({
    value,
    onChange,
    disabled,
    labels,
  }: {
    value: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    labels: { placeholder: string };
  }) => (
    <input
      data-testid="picker-czlonka"
      aria-label={labels.placeholder}
      value={value}
      disabled={disabled === true}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({
  ConfirmDialog: ({
    state,
    onOpenChange,
  }: {
    state: {
      title: string;
      description?: string;
      destructive?: boolean;
      onConfirm: () => void | Promise<void>;
    } | null;
    onOpenChange: (open: boolean) => void;
  }) =>
    state === null ? (
      <div data-testid="brak-potwierdzenia" />
    ) : (
      <div
        data-testid="potwierdzenie"
        data-tytul={state.title}
        data-opis={state.description ?? ""}
        data-destrukcyjne={String(state.destructive === true)}
      >
        <button
          type="button"
          data-testid="potwierdz"
          onClick={() => {
            void state.onConfirm();
          }}
        />
        <button
          type="button"
          data-testid="potwierdzenie-zamknij"
          onClick={() => onOpenChange(false)}
        />
        <button
          type="button"
          data-testid="potwierdzenie-otworz"
          onClick={() => onOpenChange(true)}
        />
      </div>
    ),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubMembers: (params: ZapytanieSkladu) => {
    h.zapytania.push(params);
    const kolejka = params.status === "pending";
    return {
      data: kolejka ? h.kolejka : h.lista,
      isPending: kolejka ? false : h.listaPending,
      isError: kolejka ? false : h.listaError,
    };
  },
  useUpsertClubMember: (clubId: string) => {
    h.upsertKlub.push(clubId);
    return {
      mutate: (payload: AdminMemberUpsert, wynik: Wynik<string>) => {
        h.upsert.push(payload);
        if (h.upsertFails) wynik.onError(new Error("clubs: nope"));
        else wynik.onSuccess("ok");
      },
      isPending: h.upsertPending,
    };
  },
  useRemoveClubMember: () => ({
    mutateAsync: (userId: string) => {
      h.usuniete.push(userId);
      return h.usuniecieFails ? Promise.reject(new Error("clubs: nope")) : Promise.resolve(true);
    },
    isPending: h.usunieciePending,
  }),
  useBulkSetClubMemberRole: () => ({
    mutate: (payload: { userIds: string[]; role: ClubMemberRole }, wynik: Wynik<number>) => {
      h.masowe.push(payload);
      if (h.masoweFails) wynik.onError(new Error("clubs: nope"));
      else wynik.onSuccess(h.masoweZmienione);
    },
    isPending: h.masowePending,
  }),
}));

import { ClubMembersTab } from "@/components/admin/clubs/organisms/ClubMembersTab";
import { CLUB_BASE_ISO, CLUB_IDS, clubMemberRow } from "@/test/clubs/fixtures";

/** Termin z przeszłości i z przyszłości NIEZALEŻNE od zegara systemowego -
 *  organizm czyta `Date.now()`, więc granice muszą leżeć daleko od dziś. */
const DAWNO = "2000-01-01T00:00:00.000Z";
const KIEDYS = "2100-01-01T00:00:00.000Z";

function strona(rows: ReturnType<typeof clubMemberRow>[], total = rows.length): ClubMembersPage {
  return { rows, total };
}

function dwieOsoby(): ReturnType<typeof clubMemberRow>[] {
  return [
    clubMemberRow({ user_id: "u1", display_name: "Anna Nowak", role: "moderator" }),
    clubMemberRow({ user_id: "u2", display_name: "Piotr Zych", role: "member", status: "pending" }),
  ];
}

function panel() {
  return render(<ClubMembersTab clubId={CLUB_IDS.club} />);
}

function selekty(): HTMLSelectElement[] {
  return screen
    .queryAllByTestId("select")
    .filter((el): el is HTMLSelectElement => el instanceof HTMLSelectElement);
}

function opcje(el: HTMLSelectElement): string[] {
  return [...el.querySelectorAll("option")].map((option) => option.value);
}

/** Droplista filtra statusu - jedyna z pozycją „wszystkie”. */
function filtrStatusu(): HTMLSelectElement {
  const found = selekty().find((el) => opcje(el).includes("__any__"));
  if (found === undefined) throw new Error("brak dropListy filtra statusu");
  return found;
}

/** Droplisty roli w kolejności DOM: pasek masowy (gdy jest), wiersze, karty. */
function droplistyRoli(): HTMLSelectElement[] {
  return selekty().filter((el) => !opcje(el).includes("__any__"));
}

/** Wiersze CIAŁA tabeli - bez nagłówka. */
function wiersze(): HTMLElement[] {
  return screen.queryAllByRole("row").slice(1);
}

/** Lista kart mobilnych - OSTATNIA lista na ekranie. */
function karty(): HTMLElement {
  const listy = screen.getAllByRole("list");
  return listy[listy.length - 1];
}

/** Lista kolejki próśb - PIERWSZA lista na ekranie, gdy kolejka jest. */
function kolejka(): HTMLElement {
  return screen.getAllByRole("list")[0];
}

function przycisk(nazwa: string): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

beforeEach(() => {
  h.lista = strona(dwieOsoby());
  h.listaPending = false;
  h.listaError = false;
  h.kolejka = undefined;
  h.zapytania = [];
  h.upsertKlub = [];
  h.upsert = [];
  h.upsertFails = false;
  h.upsertPending = false;
  h.usuniete = [];
  h.usuniecieFails = false;
  h.usunieciePending = false;
  h.masowe = [];
  h.masoweZmienione = 2;
  h.masoweFails = false;
  h.masowePending = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("trzy stany listy członków", () => {
  it("zapytanie W LOCIE pokazuje szkielet, nie komunikat pustki", () => {
    h.listaPending = true;
    h.lista = undefined;
    panel();

    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(screen.queryByText("adminClubs.members.empty")).toBeNull();
    expect(wiersze()).toHaveLength(0);
  });

  it("brak członków mówi to wprost i nie rysuje tabeli", () => {
    h.lista = strona([]);
    panel();

    expect(screen.getByText("adminClubs.members.empty")).toBeTruthy();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
  });

  it("lista rysuje KAŻDĄ osobę w obu wariantach - w tabeli i w karcie", () => {
    panel();

    expect(wiersze()).toHaveLength(2);
    expect(within(karty()).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByLabelText("Anna Nowak")).toHaveLength(2);
  });

  it("AWARIA zapytania schodzi na komunikat pustki - zakładka nie ma osobnego stanu błędu", () => {
    h.listaError = true;
    h.lista = undefined;
    panel();

    expect(screen.getByText("adminClubs.members.empty")).toBeTruthy();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("dane CZĘŚCIOWE: bez stanowiska i bez kadencji renderują się bez gołego undefined", () => {
    h.lista = strona([clubMemberRow({ job_title: "", role_expires_at: "", current_company: "" })]);
    const { container } = panel();

    expect(screen.getAllByText("adminClubs.members.tenureNone")).toHaveLength(2);
    expect(container.textContent).not.toContain("undefined");
  });

  it("kadencja WYGASŁA i kadencja CZYNNA mają różne opisy", () => {
    h.lista = strona([
      clubMemberRow({ user_id: "u1", display_name: "Wygasła", role_expires_at: DAWNO }),
      clubMemberRow({ user_id: "u2", display_name: "Czynna", role_expires_at: KIEDYS }),
    ]);
    panel();

    expect(screen.getAllByText("adminClubs.members.roleExpired")).toHaveLength(2);
    expect(screen.queryAllByText("adminClubs.members.tenureNone")).toHaveLength(0);
  });
});

describe("argumenty zapytań", () => {
  it("tabela i kolejka jadą z tym samym oknem strony i RÓŻNYMI filtrami", () => {
    panel();

    expect(h.zapytania).toContainEqual({
      clubId: CLUB_IDS.club,
      status: null,
      limit: 50,
      offset: 0,
    });
    expect(h.zapytania).toContainEqual({
      clubId: CLUB_IDS.club,
      status: "pending",
      limit: 50,
      offset: 0,
    });
  });

  it("zmiana filtra statusu jedzie do RPC, a powrót na „wszystkie” zdejmuje filtr", () => {
    panel();

    fireEvent.change(filtrStatusu(), { target: { value: "banned" } });
    expect(h.zapytania.some((zapytanie) => zapytanie.status === "banned")).toBe(true);

    h.zapytania = [];
    fireEvent.change(filtrStatusu(), { target: { value: "__any__" } });
    expect(h.zapytania.some((zapytanie) => zapytanie.status === null)).toBe(true);
  });

  it("droplista filtra oferuje „wszystkie” i CAŁY słownik statusów", () => {
    panel();

    expect(opcje(filtrStatusu())).toEqual([
      "__any__",
      "active",
      "pending",
      "invited",
      "banned",
      "left",
    ]);
  });
});

describe("kolejka próśb o dostęp", () => {
  it("bez próśb nie ma karty kolejki", () => {
    panel();

    expect(screen.queryByText("adminClubs.members.requestsTitle")).toBeNull();
  });

  it("licznik pokazuje total_count, a strona ucięta mówi o tym wprost", () => {
    h.kolejka = strona(
      [clubMemberRow({ user_id: "p1", display_name: "Ewa Prosi", role: "moderator" })],
      137,
    );
    panel();

    expect(screen.getByText("137")).toBeTruthy();
    // Zdanie o ucięciu stoi w TYM SAMYM akapicie co podpowiedź, więc dopasowanie
    // idzie wzorcem po treści elementu, a nie po pojedynczym węźle tekstowym.
    expect(screen.getByText(/requestsTruncated\(shown=1,total=137\)/)).toBeTruthy();
  });

  it("kolejka mieszcząca się na stronie NIE mówi o ucięciu", () => {
    h.kolejka = strona([clubMemberRow({ user_id: "p1" })]);
    panel();

    expect(screen.getByText("adminClubs.members.requestsHint")).toBeTruthy();
    expect(screen.queryByText(/requestsTruncated/)).toBeNull();
  });

  it("pozycja kolejki mówi ROLĘ i firmę, a bez firmy nie dokleja separatora", () => {
    h.kolejka = strona([
      clubMemberRow({ user_id: "p1", display_name: "Z firmą", role: "moderator" }),
      clubMemberRow({ user_id: "p2", display_name: "Bez firmy", current_company: "" }),
    ]);
    panel();

    expect(within(kolejka()).getByText("club.role.moderator · NES")).toBeTruthy();
    expect(within(kolejka()).getByText("club.role.member")).toBeTruthy();
  });

  it("zatwierdzenie prośby ZACHOWUJE rolę z wiersza", () => {
    h.kolejka = strona([
      clubMemberRow({ user_id: "p1", display_name: "Ewa", role: "moderator", status: "pending" }),
    ]);
    panel();

    fireEvent.click(within(kolejka()).getByRole("button", { name: /approve/ }));

    expect(h.upsert).toEqual([{ userId: "p1", role: "moderator", status: "active" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.members.approved");
  });

  it("AWARIA zatwierdzenia kończy się komunikatem błędu", () => {
    h.upsertFails = true;
    h.kolejka = strona([clubMemberRow({ user_id: "p1" })]);
    panel();

    fireEvent.click(within(kolejka()).getByRole("button", { name: /approve/ }));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odrzucenie prośby NIE leci bez potwierdzenia, a po nim leci z właściwym zdaniem", async () => {
    h.kolejka = strona([clubMemberRow({ user_id: "p1", display_name: "Ewa Prosi" })]);
    panel();

    fireEvent.click(within(kolejka()).getByRole("button", { name: /reject/ }));

    expect(h.usuniete).toEqual([]);
    const dialog = screen.getByTestId("potwierdzenie");
    expect(dialog.getAttribute("data-tytul")).toBe(
      "adminClubs.members.rejectConfirmTitle(name=Ewa Prosi)",
    );
    expect(dialog.getAttribute("data-opis")).toBe("adminClubs.members.rejectConfirmBody");
    expect(dialog.getAttribute("data-destrukcyjne")).toBe("true");

    fireEvent.click(screen.getByTestId("potwierdz"));

    expect(h.usuniete).toEqual(["p1"]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.members.rejected"));
  });
});

describe("dodanie członka", () => {
  it("bez wyboru osoby przycisk jest zgaszony, a handler NIE wysyła mutacji", () => {
    panel();

    expect(przycisk("adminClubs.members.add").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(przycisk("adminClubs.members.add"));
    expect(h.upsert).toEqual([]);
  });

  it("wybrana osoba jedzie jako zwykły członek i picker wraca do pustki", () => {
    panel();

    fireEvent.change(screen.getByTestId("picker-czlonka"), {
      target: { value: CLUB_IDS.member },
    });
    expect(przycisk("adminClubs.members.add").getAttribute("aria-disabled")).toBe("false");

    fireEvent.click(przycisk("adminClubs.members.add"));

    expect(h.upsert).toEqual([{ userId: CLUB_IDS.member, role: "member", status: "active" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.members.added");
    expect(screen.getByTestId("picker-czlonka")).toHaveValue("");
  });

  it("AWARIA dodania NIE czyści pickera - wybór jest tym, co można stracić", () => {
    h.upsertFails = true;
    panel();

    fireEvent.change(screen.getByTestId("picker-czlonka"), {
      target: { value: CLUB_IDS.member },
    });
    fireEvent.click(przycisk("adminClubs.members.add"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(screen.getByTestId("picker-czlonka")).toHaveValue(CLUB_IDS.member);
  });
});

describe("zmiana roli w wierszu", () => {
  it("droplista oferuje CAŁY słownik ról klubu", () => {
    panel();

    expect(opcje(droplistyRoli()[0])).toEqual(["lead", "moderator", "member", "observer"]);
  });

  it("zmiana roli w TABELI zachowuje status wiersza", () => {
    panel();

    fireEvent.change(droplistyRoli()[0], { target: { value: "observer" } });

    expect(h.upsert).toEqual([{ userId: "u1", role: "observer", status: "active" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.members.roleChanged");
  });

  it("zmiana roli w KARCIE mobilnej wysyła tę samą mutację", () => {
    panel();
    const droplisty = droplistyRoli();

    fireEvent.change(droplisty[droplisty.length - 1], { target: { value: "lead" } });

    expect(h.upsert).toEqual([{ userId: "u2", role: "lead", status: "pending" }]);
  });

  it("AWARIA zmiany roli kończy się komunikatem błędu", () => {
    h.upsertFails = true;
    panel();

    fireEvent.change(droplistyRoli()[0], { target: { value: "observer" } });

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("trwający zapis gasi droplisty roli i przycisk zatwierdzenia", () => {
    h.upsertPending = true;
    panel();

    expect(droplistyRoli().every((el) => el.disabled)).toBe(true);
    expect(
      screen
        .getAllByRole("button", { name: "adminClubs.members.approve" })[0]
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("przycisk zatwierdzenia stoi TYLKO przy prośbie", () => {
    panel();

    // Wiersz `pending` (u2) daje przycisk w tabeli i w karcie - razem dwa.
    expect(screen.getAllByRole("button", { name: "adminClubs.members.approve" })).toHaveLength(2);
  });

  it("zatwierdzenie z KARTY mobilnej wiezie ten sam ładunek co z tabeli", () => {
    panel();

    fireEvent.click(within(karty()).getByRole("button", { name: "adminClubs.members.approve" }));

    expect(h.upsert).toEqual([{ userId: "u2", role: "member", status: "active" }]);
  });

  it("kolumna kadencji w KARCIE mobilnej otwiera ten sam dialog", () => {
    panel();

    fireEvent.click(within(karty()).getAllByText("adminClubs.members.tenureNone")[0]);

    expect(within(screen.getByTestId("dialog")).getByText("Anna Nowak")).toBeTruthy();
  });

  it("zatwierdzenie z tabeli wiezie rolę wiersza i status aktywny", () => {
    panel();

    fireEvent.click(screen.getAllByRole("button", { name: "adminClubs.members.approve" })[0]);

    expect(h.upsert).toEqual([{ userId: "u2", role: "member", status: "active" }]);
  });
});

describe("usunięcie członka", () => {
  it("kosz w tabeli NIE usuwa bez potwierdzenia, a po nim usuwa właściwą osobę", async () => {
    panel();

    fireEvent.click(screen.getAllByRole("button", { name: "adminClubs.members.removed" })[0]);

    expect(h.usuniete).toEqual([]);
    expect(screen.getByTestId("potwierdzenie").getAttribute("data-tytul")).toBe(
      "adminClubs.members.removeConfirmTitle(name=Anna Nowak)",
    );

    fireEvent.click(screen.getByTestId("potwierdz"));

    expect(h.usuniete).toEqual(["u1"]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.members.removed"));
  });

  it("przycisk w KARCIE mobilnej prowadzi do tego samego potwierdzenia", () => {
    panel();

    fireEvent.click(within(karty()).getAllByRole("button", { name: "common.delete" })[0]);

    expect(screen.getByTestId("potwierdzenie").getAttribute("data-tytul")).toBe(
      "adminClubs.members.removeConfirmTitle(name=Anna Nowak)",
    );
  });

  it("AWARIA usunięcia kończy się komunikatem błędu", async () => {
    h.usuniecieFails = true;
    panel();

    fireEvent.click(screen.getAllByRole("button", { name: "adminClubs.members.removed" })[0]);
    fireEvent.click(screen.getByTestId("potwierdz"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed"));
  });

  it("zamknięcie dialogu zdejmuje stan potwierdzenia, a otwarcie go nie tworzy", () => {
    panel();

    fireEvent.click(screen.getAllByRole("button", { name: "adminClubs.members.removed" })[0]);
    fireEvent.click(screen.getByTestId("potwierdzenie-zamknij"));
    expect(screen.getByTestId("brak-potwierdzenia")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "adminClubs.members.removed" })[0]);
    fireEvent.click(screen.getByTestId("potwierdzenie-otworz"));
    expect(screen.getByTestId("potwierdzenie")).toBeTruthy();
  });

  it("trwające usuwanie gasi kosz", () => {
    h.usunieciePending = true;
    panel();

    expect(
      screen
        .getAllByRole("button", { name: "adminClubs.members.removed" })[0]
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});

describe("zaznaczenie i operacje masowe", () => {
  it("bez zaznaczenia nie ma paska masowego", () => {
    panel();

    expect(screen.queryByText(/bulkSelected/)).toBeNull();
  });

  it("zaznaczenie wiersza otwiera pasek i znaczy wiersz w tabeli", () => {
    panel();

    fireEvent.click(screen.getAllByLabelText("Anna Nowak")[0]);

    expect(screen.getByText("adminClubs.members.bulkSelected(count=1)")).toBeTruthy();
    expect(wiersze()[0].getAttribute("data-state")).toBe("selected");
  });

  it("„zaznacz wszystko” obejmuje widoczną stronę, a powtórne kliknięcie ją zwalnia", () => {
    panel();

    const wszystko = screen.getByLabelText("adminClubs.members.bulkSelectAll");
    fireEvent.click(wszystko);
    expect(screen.getByText("adminClubs.members.bulkSelected(count=2)")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("adminClubs.members.bulkSelectAll"));
    expect(screen.queryByText(/bulkSelected/)).toBeNull();
  });

  it("operacja masowa wiezie zaznaczone identyfikatory i ZDEJMUJE zaznaczenie", () => {
    h.masoweZmienione = 2;
    panel();

    fireEvent.click(screen.getByLabelText("adminClubs.members.bulkSelectAll"));
    fireEvent.change(droplistyRoli()[0], { target: { value: "observer" } });
    fireEvent.click(przycisk("adminClubs.members.bulkApply"));

    expect(h.masowe).toEqual([{ userIds: ["u1", "u2"], role: "observer" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.members.bulkDone(count=2)");
    expect(screen.queryByText(/bulkSelected/)).toBeNull();
  });

  it("AWARIA operacji masowej ZOSTAWIA zaznaczenie na ekranie", () => {
    h.masoweFails = true;
    panel();

    fireEvent.click(screen.getAllByLabelText("Anna Nowak")[0]);
    fireEvent.click(przycisk("adminClubs.members.bulkApply"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(screen.getByText("adminClubs.members.bulkSelected(count=1)")).toBeTruthy();
  });

  it("„wyczyść” zdejmuje zaznaczenie bez żadnej mutacji", () => {
    panel();

    fireEvent.click(screen.getAllByLabelText("Anna Nowak")[0]);
    fireEvent.click(przycisk("adminClubs.members.bulkClear"));

    expect(h.masowe).toEqual([]);
    expect(screen.queryByText(/bulkSelected/)).toBeNull();
  });

  it("zaznaczenie z karty mobilnej trafia do tego samego zbioru", () => {
    panel();

    fireEvent.click(screen.getAllByLabelText("Piotr Zych")[1]);

    expect(screen.getByText("adminClubs.members.bulkSelected(count=1)")).toBeTruthy();
  });

  it("trwająca operacja masowa gasi oba przyciski paska", () => {
    h.masowePending = true;
    panel();

    fireEvent.click(screen.getAllByLabelText("Anna Nowak")[0]);

    expect(przycisk("adminClubs.members.bulkApply").getAttribute("aria-disabled")).toBe("true");
    expect(przycisk("adminClubs.members.bulkClear").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("dialog kadencji", () => {
  it("kliknięcie kolumny kadencji otwiera dialog z bieżącym terminem", () => {
    h.lista = strona([
      clubMemberRow({ user_id: "u1", display_name: "Anna Nowak", role_expires_at: KIEDYS }),
    ]);
    panel();

    expect(screen.queryByTestId("dialog")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /roleExpired|tenureNone|2100/ })[0]);

    const dialog = screen.getByTestId("dialog");
    expect(within(dialog).getByText("adminClubs.members.tenureTitle")).toBeTruthy();
    expect(within(dialog).getByText("Anna Nowak")).toBeTruthy();
  });

  it("bez kadencji dialog mówi „bezterminowo” i gasi przycisk czyszczenia", () => {
    h.lista = strona([clubMemberRow({ user_id: "u1", role_expires_at: "" })]);
    panel();

    fireEvent.click(screen.getAllByText("adminClubs.members.tenureNone")[0]);

    const dialog = screen.getByTestId("dialog");
    expect(
      within(dialog)
        .getByRole("button", { name: "adminClubs.members.tenureClear" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("zapis bez daty NIE leci, a z datą jedzie jako znacznik ISO", () => {
    h.lista = strona([clubMemberRow({ user_id: "u1", role: "moderator", role_expires_at: "" })]);
    panel();

    fireEvent.click(screen.getAllByText("adminClubs.members.tenureNone")[0]);
    const dialog = screen.getByTestId("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));
    expect(h.upsert).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("adminClubs.members.tenureUntil"), {
      target: { value: "2027-01-31" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.save" }));

    expect(h.upsert).toEqual([
      {
        userId: "u1",
        role: "moderator",
        status: "active",
        roleExpiresAt: "2027-01-31T00:00:00.000Z",
        clearRoleExpiry: false,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.saved");
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("zdjęcie kadencji jedzie z JAWNĄ flagą czyszczenia", () => {
    h.lista = strona([clubMemberRow({ user_id: "u1", role_expires_at: KIEDYS })]);
    panel();

    fireEvent.click(screen.getAllByRole("button", { name: /2100|tenureNone/ })[0]);
    fireEvent.click(
      within(screen.getByTestId("dialog")).getByRole("button", {
        name: "adminClubs.members.tenureClear",
      }),
    );

    expect(h.upsert).toEqual([
      {
        userId: "u1",
        role: "member",
        status: "active",
        roleExpiresAt: null,
        clearRoleExpiry: true,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.members.tenureCleared");
  });

  it("AWARIA zapisu kadencji zostawia dialog otwarty", () => {
    h.upsertFails = true;
    h.lista = strona([clubMemberRow({ user_id: "u1", role_expires_at: KIEDYS })]);
    panel();

    fireEvent.click(screen.getAllByRole("button", { name: /2100|tenureNone/ })[0]);
    fireEvent.click(
      within(screen.getByTestId("dialog")).getByRole("button", {
        name: "adminClubs.members.tenureClear",
      }),
    );

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(screen.getByTestId("dialog")).toBeTruthy();
  });

  it("anulowanie i zamknięcie dialogu zwalniają wiersz, a otwarcie go nie zamyka", () => {
    h.lista = strona([clubMemberRow({ user_id: "u1", role_expires_at: "" })]);
    panel();

    fireEvent.click(screen.getAllByText("adminClubs.members.tenureNone")[0]);
    fireEvent.click(screen.getByTestId("dialog-otworz"));
    expect(screen.getByTestId("dialog")).toBeTruthy();

    fireEvent.click(
      within(screen.getByTestId("dialog")).getByRole("button", { name: "common.cancel" }),
    );
    expect(screen.queryByTestId("dialog")).toBeNull();

    fireEvent.click(screen.getAllByText("adminClubs.members.tenureNone")[0]);
    fireEvent.click(screen.getByTestId("dialog-zamknij"));
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("data przystąpienia i termin kadencji są formatowane językiem interfejsu", () => {
    h.lista = strona([
      clubMemberRow({ user_id: "u1", joined_at: CLUB_BASE_ISO, role_expires_at: KIEDYS }),
    ]);
    panel();

    expect(screen.getAllByText("18.08.2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.01.2100").length).toBeGreaterThan(0);
  });
});
