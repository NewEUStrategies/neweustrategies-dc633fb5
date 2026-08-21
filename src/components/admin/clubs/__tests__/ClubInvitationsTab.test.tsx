// Zakładka „Zaproszenia” - SKLEJENIE czterech paneli z pięcioma mutacjami.
//
// CO TEN PLIK DOWODZI.
//   1. DWIE ŚCIEŻKI WYSYŁKI to DWIE mutacje i DWA ładunki: osoba z platformy
//      niesie wiadomość, adres e-mail nie niesie jej wcale. Przełącznik
//      podmienia kontrolkę, nie tylko etykietę.
//   2. ROLA `lead` NIE JEST W OFERCIE. To reguła bazy
//      (`Exclude<ClubMemberRole, "lead">` w typie wejścia, RPC odrzuca role
//      podwyższone nadane masowo), więc droplista musi jej nie mieć - inaczej
//      panel proponuje wybór, który baza unieważni.
//   3. KOD ODMOWY Z BAZY jedzie przez `toClubInviteError` na klucz
//      `adminClubs.invitations.error.<kod>`, a wyjątek nierozpoznany na ogólny
//      komunikat zapisu. Użytkownik nigdy nie widzi tekstu z Postgresa.
//   4. LINK ZAPRASZAJĄCY: token widać RAZ (tuż po utworzeniu), limit użyć
//      wpisany jako „0” znaczy BEZ LIMITU, a kopiowanie mówi o skutku - także
//      gdy schowek odmówi.
//   5. UNIEWAŻNIENIE LINKU jest NIEODWRACALNE, więc nie leci z kliknięcia -
//      leci z potwierdzenia. Link już unieważniony nie ma czego unieważniać.
//   6. TRZY STANY OBU TABEL (w locie / pusto / dane) mają trzy widoki, a wiersz
//      częściowy (bez etykiety, bez limitu, bez terminu) nie pokazuje gołego
//      `undefined`.
//   7. HISTORIA składa klucze słownika dla WSZYSTKICH CZTERECH KANAŁÓW oraz dla
//      stanów dokładanych przez kanał e-mail (`sent`, `failed`).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł zaproszeń - tabela przypadków jest
// w `lib/clubs/__tests__/adminClubInvites.test.ts`. (2) Tablicy „komunikat bazy
// -> kod” - `inviteErrors.test.ts`; tutaj dowodzimy tylko, że zakładka tej
// mapy UŻYWA. (3) Kampanii segmentowej (`ClubSegmentCampaign`) - osobny
// organizm, tu jest atrapą-markerem sprawdzającą przekazany klub.
// (4) Mechaniki Radiksa - `Select` ma natywny odpowiednik.
//
// ATRAPA PRZYCISKU jak w `ClubMembersTab.test.tsx`: stan zgaszenia siedzi
// w `aria-disabled`, a handler PUSZCZA - inaczej bramki wewnątrz handlerów
// (obrona przed podwójnym kliknięciem) byłyby niesprawdzalne.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import type { AdminClubInvitationRow, AdminClubInviteLinkRow } from "@/lib/clubs/types";

type Wynik<T> = { onSuccess: (value: T) => void; onError: (error: unknown) => void };
type LadunekOsoba = { userId: string; role: string; message: string | null };
type LadunekEmail = { email: string; role: string };
type LadunekLinku = { label: string | null; role: string; maxUses: number | null };

const h = vi.hoisted(() => ({
  historia: undefined as AdminClubInvitationRow[] | undefined,
  historiaPending: false,
  linki: undefined as AdminClubInviteLinkRow[] | undefined,
  linkiPending: false,
  osoba: [] as LadunekOsoba[],
  osobaFails: null as unknown,
  osobaPending: false,
  email: [] as LadunekEmail[],
  emailFails: null as unknown,
  emailPending: false,
  utworzone: [] as LadunekLinku[],
  utworzenieFails: null as unknown,
  utworzeniePending: false,
  token: "token-nowy",
  uniewaznione: [] as string[],
  uniewaznienieFails: false,
  uniewaznieniePending: false,
  segmentKlub: [] as string[],
  schowek: vi.fn(() => Promise.resolve()),
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
      data-testid="picker-osoby"
      aria-label={labels.placeholder}
      value={value}
      disabled={disabled === true}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/components/admin/clubs/organisms/ClubSegmentCampaign", () => ({
  ClubSegmentCampaign: ({ clubId }: { clubId: string }) => {
    h.segmentKlub.push(clubId);
    return <div data-testid="kampania-segmentowa" data-klub={clubId} />;
  },
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
  useClubInvitations: () => ({ data: h.historia, isPending: h.historiaPending }),
  useClubInviteLinks: () => ({ data: h.linki, isPending: h.linkiPending }),
  useInviteClubMember: () => ({
    mutate: (payload: LadunekOsoba, wynik: Wynik<string>) => {
      h.osoba.push(payload);
      if (h.osobaFails === null) wynik.onSuccess("ok");
      else wynik.onError(h.osobaFails);
    },
    isPending: h.osobaPending,
  }),
  useInviteClubMemberByEmail: () => ({
    mutate: (payload: LadunekEmail, wynik: Wynik<string>) => {
      h.email.push(payload);
      if (h.emailFails === null) wynik.onSuccess("ok");
      else wynik.onError(h.emailFails);
    },
    isPending: h.emailPending,
  }),
  useCreateClubInviteLink: () => ({
    mutate: (payload: LadunekLinku, wynik: Wynik<{ id: string; token: string }>) => {
      h.utworzone.push(payload);
      if (h.utworzenieFails === null) wynik.onSuccess({ id: "link-nowy", token: h.token });
      else wynik.onError(h.utworzenieFails);
    },
    isPending: h.utworzeniePending,
  }),
  useRevokeClubInviteLink: () => ({
    mutateAsync: (linkId: string) => {
      h.uniewaznione.push(linkId);
      return h.uniewaznienieFails
        ? Promise.reject(new Error("clubs: nope"))
        : Promise.resolve(true);
    },
    isPending: h.uniewaznieniePending,
  }),
}));

import { ClubInvitationsTab } from "@/components/admin/clubs/organisms/ClubInvitationsTab";
import { CLUB_BASE_ISO, CLUB_IDS } from "@/test/clubs/fixtures";
import { adminClubInvitationRow, adminClubInviteLinkRow } from "@/test/clubs/clubRosterFixtures";

function panel() {
  return render(<ClubInvitationsTab clubId={CLUB_IDS.club} />);
}

function przycisk(nazwa: string): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

function droplistaRoli(): HTMLSelectElement {
  const found = screen
    .getAllByTestId("select")
    .find((el): el is HTMLSelectElement => el instanceof HTMLSelectElement);
  if (found === undefined) throw new Error("brak dropListy roli");
  return found;
}

function opcje(el: HTMLSelectElement): string[] {
  return [...el.querySelectorAll("option")].map((option) => option.value);
}

/** Wiersze ciała danej tabeli - pierwsza tabela to linki, druga to historia. */
function wierszeTabeli(indeks: number): HTMLElement[] {
  const tabele = screen.getAllByRole("table");
  return within(tabele[indeks]).getAllByRole("row").slice(1);
}

beforeEach(() => {
  h.historia = [];
  h.historiaPending = false;
  h.linki = [];
  h.linkiPending = false;
  h.osoba = [];
  h.osobaFails = null;
  h.osobaPending = false;
  h.email = [];
  h.emailFails = null;
  h.emailPending = false;
  h.utworzone = [];
  h.utworzenieFails = null;
  h.utworzeniePending = false;
  h.token = "token-nowy";
  h.uniewaznione = [];
  h.uniewaznienieFails = false;
  h.uniewaznieniePending = false;
  h.segmentKlub = [];
  h.schowek = vi.fn(() => Promise.resolve());
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText: h.schowek },
    configurable: true,
  });
});

describe("oferta ról", () => {
  it("droplista NIE oferuje roli prowadzącego", () => {
    panel();

    expect(opcje(droplistaRoli())).toEqual(["moderator", "member", "observer"]);
    expect(opcje(droplistaRoli())).not.toContain("lead");
  });
});

describe("wysyłka do osoby z platformy", () => {
  it("bez wybranej osoby przycisk jest zgaszony, a handler NIE wysyła", () => {
    panel();

    expect(przycisk("adminClubs.invitations.send").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.osoba).toEqual([]);
    expect(h.email).toEqual([]);
  });

  it("zaproszenie niesie rolę i PRZYCIĘTĄ wiadomość, a po wysłaniu pola wracają do pustki", () => {
    panel();

    fireEvent.change(screen.getByTestId("picker-osoby"), { target: { value: CLUB_IDS.member } });
    fireEvent.change(droplistaRoli(), { target: { value: "moderator" } });
    fireEvent.change(screen.getByLabelText("adminClubs.invitations.messageLabel"), {
      target: { value: "  Zapraszam na wrześniowy panel.  " },
    });
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.osoba).toEqual([
      {
        userId: CLUB_IDS.member,
        role: "moderator",
        message: "Zapraszam na wrześniowy panel.",
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.invitations.sent");
    expect(screen.getByTestId("picker-osoby")).toHaveValue("");
    expect(screen.getByLabelText("adminClubs.invitations.messageLabel")).toHaveValue("");
  });

  it("wiadomość ze spacji jedzie jako brak wiadomości", () => {
    panel();

    fireEvent.change(screen.getByTestId("picker-osoby"), { target: { value: CLUB_IDS.member } });
    fireEvent.change(screen.getByLabelText("adminClubs.invitations.messageLabel"), {
      target: { value: "   " },
    });
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.osoba[0].message).toBeNull();
  });

  it("ODMOWA BAZY zamienia się w klucz kodu, a nie w tekst wyjątku", () => {
    h.osobaFails = new Error("clubs: invite quota exceeded");
    panel();

    fireEvent.change(screen.getByTestId("picker-osoby"), { target: { value: CLUB_IDS.member } });
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.invitations.error.quota_exceeded");
  });

  it("odmowa NIEROZPOZNANA schodzi na ogólny komunikat zapisu", () => {
    h.osobaFails = new Error("connection reset");
    panel();

    fireEvent.change(screen.getByTestId("picker-osoby"), { target: { value: CLUB_IDS.member } });
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("rola podwyższona odrzucona przez bazę ma własny komunikat", () => {
    h.osobaFails = new Error("clubs: elevated role requires admin");
    panel();

    fireEvent.change(screen.getByTestId("picker-osoby"), { target: { value: CLUB_IDS.member } });
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.invitations.error.elevated_role");
  });

  it("trwająca wysyłka gasi kontrolki ścieżki osobowej", () => {
    h.osobaPending = true;
    panel();

    expect(screen.getByTestId("picker-osoby")).toBeDisabled();
    expect(droplistaRoli().disabled).toBe(true);
    expect(przycisk("adminClubs.invitations.send").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("wysyłka na adres e-mail", () => {
  it("przełącznik podmienia kontrolkę: picker znika, pole adresu wchodzi", () => {
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.modeEmail"));

    expect(screen.queryByTestId("picker-osoby")).toBeNull();
    expect(screen.getByLabelText("adminClubs.invitations.emailLabel")).toBeTruthy();
    // Wiadomość jedzie TYLKO ścieżką osobową - kanał e-mail idzie szablonem.
    expect(screen.queryByLabelText("adminClubs.invitations.messageLabel")).toBeNull();
  });

  it("adres ze spacji nie odblokowuje wysyłki, a przycięty jedzie do mutacji", () => {
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.modeEmail"));
    fireEvent.change(screen.getByLabelText("adminClubs.invitations.emailLabel"), {
      target: { value: "   " },
    });
    expect(przycisk("adminClubs.invitations.send").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(przycisk("adminClubs.invitations.send"));
    expect(h.email).toEqual([]);

    fireEvent.change(screen.getByLabelText("adminClubs.invitations.emailLabel"), {
      target: { value: " osoba@instytucja.eu " },
    });
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.email).toEqual([{ email: "osoba@instytucja.eu", role: "member" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.invitations.sent");
    expect(screen.getByLabelText("adminClubs.invitations.emailLabel")).toHaveValue("");
  });

  it("ODMOWA kanału e-mail też przechodzi przez kod, nie przez tekst", () => {
    h.emailFails = new Error("clubs: already a member");
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.modeEmail"));
    fireEvent.change(screen.getByLabelText("adminClubs.invitations.emailLabel"), {
      target: { value: "a@b.eu" },
    });
    fireEvent.click(przycisk("adminClubs.invitations.send"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.invitations.error.already_member");
  });

  it("powrót na ścieżkę osobową przywraca picker", () => {
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.modeEmail"));
    fireEvent.click(przycisk("adminClubs.invitations.modePerson"));

    expect(screen.getByTestId("picker-osoby")).toBeTruthy();
  });
});

describe("kampania segmentowa", () => {
  it("dostaje klub, w którym stoi zakładka", () => {
    panel();

    expect(screen.getByTestId("kampania-segmentowa").getAttribute("data-klub")).toBe(CLUB_IDS.club);
    expect(h.segmentKlub).toContain(CLUB_IDS.club);
  });
});

describe("linki zapraszające - trzy stany tabeli", () => {
  it("zapytanie W LOCIE pokazuje szkielet, nie komunikat pustki", () => {
    h.linkiPending = true;
    h.linki = undefined;
    panel();

    expect(screen.queryByText("adminClubs.invitations.noLinks")).toBeNull();
    expect(document.querySelectorAll("[aria-busy='true']").length).toBe(1);
  });

  it("brak linków mówi to wprost", () => {
    panel();

    expect(screen.getByText("adminClubs.invitations.noLinks")).toBeTruthy();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("dane CZĘŚCIOWE: bez etykiety, bez limitu i bez terminu nie dają gołego undefined", () => {
    h.linki = [adminClubInviteLinkRow({ label: "", max_uses: 0, expires_at: "" })];
    const { container } = panel();

    expect(screen.getByText("adminClubs.invitations.linkUnnamed")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
    expect(container.textContent).not.toContain("undefined");
  });

  it("link z limitem i terminem pokazuje jedno i drugie", () => {
    h.linki = [adminClubInviteLinkRow({ max_uses: 10, used_count: 4, expires_at: CLUB_BASE_ISO })];
    panel();

    expect(screen.getByText("4 / 10")).toBeTruthy();
    expect(screen.getByText("18.08.2026")).toBeTruthy();
  });

  it("link CZYNNY ma akcję unieważnienia, UNIEWAŻNIONY jej nie ma", () => {
    h.linki = [
      adminClubInviteLinkRow({ id: "l1", label: "Czynny" }),
      adminClubInviteLinkRow({ id: "l2", label: "Zamknięty", revoked_at: CLUB_BASE_ISO }),
    ];
    panel();

    expect(wierszeTabeli(0)).toHaveLength(2);
    expect(screen.getAllByText("adminClubs.invitations.activeLink")).toHaveLength(1);
    expect(screen.getAllByText("adminClubs.invitations.revoked")).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "adminClubs.invitations.revokeLink" }),
    ).toHaveLength(1);
  });
});

describe("tworzenie linku", () => {
  it("etykieta i limit jadą do mutacji, a po utworzeniu token widać RAZ", () => {
    panel();

    fireEvent.change(screen.getByLabelText("adminClubs.invitations.linkLabel"), {
      target: { value: "  Bruksela 09.2026  " },
    });
    fireEvent.change(screen.getByLabelText("adminClubs.invitations.linkMaxUses"), {
      target: { value: "25" },
    });
    fireEvent.click(przycisk("adminClubs.invitations.createLink"));

    expect(h.utworzone).toEqual([{ label: "Bruksela 09.2026", role: "member", maxUses: 25 }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.invitations.linkCreated");
    expect(screen.getByText(`${window.location.origin}/club/join/token-nowy`)).toBeTruthy();
    expect(screen.getByText("adminClubs.invitations.tokenOnceHint")).toBeTruthy();
    expect(screen.getByLabelText("adminClubs.invitations.linkLabel")).toHaveValue("");
    expect(screen.getByLabelText("adminClubs.invitations.linkMaxUses")).toHaveValue(null);
  });

  it("limit „0” znaczy BEZ LIMITU, nie link martwy przy utworzeniu", () => {
    panel();

    fireEvent.change(screen.getByLabelText("adminClubs.invitations.linkMaxUses"), {
      target: { value: "0" },
    });
    fireEvent.click(przycisk("adminClubs.invitations.createLink"));

    expect(h.utworzone).toEqual([{ label: null, role: "member", maxUses: null }]);
  });

  it("przed utworzeniem nie ma czego kopiować", () => {
    panel();

    expect(screen.queryByText("adminClubs.invitations.copy")).toBeNull();
  });

  it("ODMOWA utworzenia idzie przez kod odmowy", () => {
    h.utworzenieFails = new Error("clubs: tier too low");
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.createLink"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.invitations.error.tier_too_low");
    expect(screen.queryByText("adminClubs.invitations.tokenOnceHint")).toBeNull();
  });

  it("trwające tworzenie gasi oba pola i przycisk", () => {
    h.utworzeniePending = true;
    panel();

    expect(screen.getByLabelText("adminClubs.invitations.linkLabel")).toBeDisabled();
    expect(screen.getByLabelText("adminClubs.invitations.linkMaxUses")).toBeDisabled();
    expect(przycisk("adminClubs.invitations.createLink").getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("kopiowanie wkłada do schowka PEŁNY adres i mówi o skutku", async () => {
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.createLink"));
    fireEvent.click(przycisk("adminClubs.invitations.copy"));

    expect(h.schowek).toHaveBeenCalledWith(`${window.location.origin}/club/join/token-nowy`);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.invitations.linkCopied"),
    );
  });

  it("ODMOWA schowka też jest widoczna - cichy brak kopii jest gorszy", async () => {
    h.schowek = vi.fn(() => Promise.reject(new Error("brak zgody")));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: h.schowek },
      configurable: true,
    });
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.createLink"));
    fireEvent.click(przycisk("adminClubs.invitations.copy"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed"));
  });
});

describe("unieważnienie linku", () => {
  it("NIE leci bez potwierdzenia, a po nim leci z właściwym identyfikatorem", async () => {
    h.linki = [adminClubInviteLinkRow({ id: "l1" })];
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.revokeLink"));

    expect(h.uniewaznione).toEqual([]);
    const dialog = screen.getByTestId("potwierdzenie");
    expect(dialog.getAttribute("data-tytul")).toBe("adminClubs.invitations.revokeConfirmTitle");
    expect(dialog.getAttribute("data-opis")).toBe("adminClubs.invitations.revokeConfirmBody");
    expect(dialog.getAttribute("data-destrukcyjne")).toBe("true");

    fireEvent.click(screen.getByTestId("potwierdz"));

    expect(h.uniewaznione).toEqual(["l1"]);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.invitations.revoked"),
    );
  });

  it("AWARIA unieważnienia kończy się komunikatem błędu", async () => {
    h.uniewaznienieFails = true;
    h.linki = [adminClubInviteLinkRow({ id: "l1" })];
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.revokeLink"));
    fireEvent.click(screen.getByTestId("potwierdz"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed"));
  });

  it("zamknięcie dialogu zdejmuje stan potwierdzenia, a otwarcie go nie tworzy", () => {
    h.linki = [adminClubInviteLinkRow({ id: "l1" })];
    panel();

    fireEvent.click(przycisk("adminClubs.invitations.revokeLink"));
    fireEvent.click(screen.getByTestId("potwierdzenie-zamknij"));
    expect(screen.getByTestId("brak-potwierdzenia")).toBeTruthy();

    fireEvent.click(przycisk("adminClubs.invitations.revokeLink"));
    fireEvent.click(screen.getByTestId("potwierdzenie-otworz"));
    expect(screen.getByTestId("potwierdzenie")).toBeTruthy();
  });

  it("trwające unieważnianie gasi przycisk", () => {
    h.uniewaznieniePending = true;
    h.linki = [adminClubInviteLinkRow({ id: "l1" })];
    panel();

    expect(przycisk("adminClubs.invitations.revokeLink").getAttribute("aria-disabled")).toBe(
      "true",
    );
  });
});

describe("historia zaproszeń - trzy stany tabeli", () => {
  it("zapytanie W LOCIE pokazuje szkielet, nie komunikat pustki", () => {
    h.historiaPending = true;
    h.historia = undefined;
    panel();

    expect(screen.queryByText("adminClubs.invitations.noHistory")).toBeNull();
    expect(document.querySelectorAll("[aria-busy='true']").length).toBe(1);
  });

  it("brak historii mówi to wprost", () => {
    panel();

    expect(screen.getByText("adminClubs.invitations.noHistory")).toBeTruthy();
  });

  it("CZTERY KANAŁY składają cztery klucze nazwy kanału", () => {
    h.historia = [
      adminClubInvitationRow({ id: "i1", channel: "direct" }),
      adminClubInvitationRow({ id: "i2", channel: "email" }),
      adminClubInvitationRow({ id: "i3", channel: "link" }),
      adminClubInvitationRow({ id: "i4", channel: "segment" }),
    ];
    panel();

    expect(wierszeTabeli(0)).toHaveLength(4);
    for (const channel of ["direct", "email", "link", "segment"]) {
      expect(screen.getByText(`adminClubs.invitations.channelName.${channel}`)).toBeTruthy();
    }
  });

  it("statusy dokładane przez kanał e-mail mają własne klucze, a nie surowy napis", () => {
    h.historia = [
      adminClubInvitationRow({ id: "i1", status: "sent" }),
      adminClubInvitationRow({ id: "i2", status: "failed" }),
      adminClubInvitationRow({ id: "i3", status: "accepted", club_role: "observer" }),
    ];
    panel();

    expect(screen.getByText("adminClubs.invitations.statusName.sent")).toBeTruthy();
    expect(screen.getByText("adminClubs.invitations.statusName.failed")).toBeTruthy();
    expect(screen.getByText("adminClubs.invitations.statusName.accepted")).toBeTruthy();
    // Ta sama etykieta stoi też w dropliście roli, więc dopasowanie zawężamy
    // do tabeli historii.
    expect(within(screen.getAllByRole("table")[0]).getByText("club.role.observer")).toBeTruthy();
  });

  it("ten sam identyfikator w DWÓCH kanałach daje dwa wiersze, nie jeden", () => {
    h.historia = [
      adminClubInvitationRow({ id: "wspolny", channel: "direct", recipient: "Anna" }),
      adminClubInvitationRow({ id: "wspolny", channel: "email", recipient: "anna@b.eu" }),
    ];
    panel();

    expect(wierszeTabeli(0)).toHaveLength(2);
    expect(screen.getByText("Anna")).toBeTruthy();
    expect(screen.getByText("anna@b.eu")).toBeTruthy();
  });

  it("wpis historii pokazuje zapraszającego i datę w języku interfejsu", () => {
    h.historia = [adminClubInvitationRow({ created_at: CLUB_BASE_ISO })];
    panel();

    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
    expect(screen.getByText("18.08.2026")).toBeTruthy();
  });
});
