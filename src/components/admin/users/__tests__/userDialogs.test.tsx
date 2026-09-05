// Dwie modalki panelu użytkowników: zaproszenie pojedyncze i import zespołu.
//
// CO TEN PLIK DOWODZI. Obie modalki są jedynym miejscem w interfejsie, przez
// które powstają KONTA - a stały na zerowym pokryciu (0 z 28 funkcji w całej
// funkcjonalności „Użytkownicy i role"). Przedmiotem dowodu jest ładunek
// wysyłany na serwer i to, co widzi administrator, gdy serwer odmówi:
//
//   1. ROLA I TRYB WYSYŁKI SĄ CZĘŚCIĄ ŁADUNKU, nie domysłem serwera. Wybór
//      w modalce musi dojechać do `createInvitations` - pomyłka daje konto
//      z inną rolą, niż administrator wybrał.
//   2. FORMULARZ NIE WYSYŁA NIEKOMPLETNEGO ZAPROSZENIA. Bez adresu albo bez
//      nazwy przycisk jest zablokowany, a `submit` wychodzi bez zapytania.
//   3. HASŁO TYMCZASOWE POKAZUJE SIĘ OSOBNYM KOMUNIKATEM. Jest jednorazowe
//      i tylko administrator może je przekazać - wtopione w toast sukcesu
//      przepadłoby.
//   4. IMPORT NIE TWORZY DUBLI. Osoby z istniejącym kontem są odznaczone
//      i NIEZAZNACZALNE, a `run()` dodatkowo je odfiltrowuje - dwie niezależne
//      obrony, bo pierwsza jest tylko wizualna.
//   5. STAN OSOBY (nowa / zaproszona / ma konto) to trzy RÓŻNE komunikaty.
//      Jeden wspólny kazałby administratorowi zgadywać, czy zaproszenie już
//      poszło.
//   6. PORAŻKA KAŻDEGO Z TRZECH KROKÓW (utworzenie, wysyłka, dowiązanie
//      widgetów) kończy się komunikatem i odblokowaniem modalki.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - BRAMEK ROLI I NAJEMCY W WARSTWIE SERWEROWEJ. `previewTeamImport`,
//   `createInvitations`, `sendInvitation` i reszta są chronione
//   `requireSupabaseAuth` + weryfikacją roli per najemca; dowodzi tego
//   `src/lib/admin/__tests__/invitationsFunctions.test.ts`. Tutaj serwer jest
//   atrapą - modalka nie jest warstwą autoryzacji i test nie może udawać, że
//   nią jest.
// - AUTORYTETU BAZY: `role_management_test.sql` (11 asercji) i
//   `rls_tenant_isolation_test.sql`.
// - MECHANIKI RADIKSA: `Select`, `Dialog` i `Checkbox` są podmienione na
//   natywne odpowiedniki, bo przedmiotem dowodu jest ŁADUNEK, nie biblioteka.
//
// GAŁĄŹ NIEOSIĄGALNA. W `InviteUserDialog` `submit()` otwiera się warunkiem
// `if (!email || !first || !last || !linkedinOk) return;`, a jedyne wejście do
// `submit()` to przycisk z `disabled={busy || uploading || !email ||
// !firstName.trim() || !lastName.trim() || !linkedinOk}` - czyli ten sam
// warunek plus dwa dodatkowe składniki. Obrona zostaje (handler jest publiczny
// w obrębie komponentu), tylko nie da się jej wywołać z testu bez rozmontowania
// blokady przycisku, którą osobno dowodzą testy „przycisk wysłania jest
// ZABLOKOWANY…” i „LinkedIn: błędny adres BLOKUJE wysyłkę…”. Druga taka gałąź
// (`items.length === 0` w `TeamImportDialog.run()`) jest opisana przy testach
// importu.
//
// ZAREJESTROWANY DEFEKT (`it.fails`). `reset()` w `InviteUserDialog` czyści
// pola osoby i przywraca autoakceptację, ale NIE przywraca `role` ani `mode` -
// więc rola z poprzedniego zaproszenia zostaje na następne. Opis skutku
// i przyczyny stoi przy samym teście.
//
// RODO: żadnych realnych danych osobowych - adresy wyłącznie w `example.org`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TeamImportCandidate } from "@/lib/admin/invitations.functions";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  /** Ładunki, z jakimi modalki zawołały warstwę serwerową. */
  createCalls: [] as { items: Record<string, unknown>[] }[],
  sendCalls: [] as string[],
  bulkSendCalls: [] as string[][],
  linkCalls: [] as string[],
  previewCalls: [] as string[],
  provisionCalls: [] as Record<string, unknown>[],
  /** Odpowiedzi atrapy serwera. */
  createResult: { ids: ["inv-1"], created: 1 } as { ids: string[]; created: number },
  sendResult: { ok: true } as { ok: boolean; error?: string; tempPassword?: string },
  bulkSendResult: { results: [{ ok: true }] } as { results: { ok: boolean }[] },
  linkResult: { updated: 2 } as { updated: number },
  previewResult: { candidates: [] as TeamImportCandidate[] },
  provisionResult: { created: 1, skipped: 0, linked: 1, errors: [] } as {
    created: number;
    skipped: number;
    linked: number;
    errors: { email: string; error: string }[];
  },
  /** Który krok ma rzucić - jedna ścieżka błędu na raz. */
  throwOn: null as null | "preview" | "create" | "send" | "bulkSend" | "link" | "provision",
  /**
   * Gdy `true`, krok z `throwOn` rzuca ŁAŃCUCHEM, nie `Error`. To jedyna droga
   * do gałęzi `String(e)` - a nie jest ona teoretyczna: `useServerFn` przy
   * odpowiedzi nie-JSON rzuca surową treścią odpowiedzi.
   */
  throwRaw: false,
  uploadCalls: [] as string[],
  uploadResult: { error: null } as { error: { message: string } | null },
  /**
   * Gdy ustawione, magazyn RZUCA tą wartością zamiast oddać `{ error }`.
   * Odpowiednik `throwRaw` dla warstwy serwerowej: klient magazynu przy
   * zerwanym połączeniu rzuca wartością, która NIE jest `Error`.
   */
  uploadThrows: null as string | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-team-media", () => ({}));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: h.toastInfo },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => "tenant-1" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          h.uploadCalls.push(path);
          if (h.uploadThrows !== null) throw h.uploadThrows;
          return h.uploadResult;
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.example.org/${path}` },
        }),
      }),
    },
  },
}));

function boom(step: string): never {
  if (h.throwRaw) throw `${step}_raw`;
  throw new Error(`${step}_failed`);
}

vi.mock("@/lib/admin/invitations.functions", () => ({
  previewTeamImport: async ({ data }: { data: { pageSlug: string } }) => {
    h.previewCalls.push(data.pageSlug);
    if (h.throwOn === "preview") boom("preview");
    return h.previewResult;
  },
  createInvitations: async ({ data }: { data: { items: Record<string, unknown>[] } }) => {
    h.createCalls.push(data);
    if (h.throwOn === "create") boom("create");
    return h.createResult;
  },
  sendInvitation: async ({ data }: { data: { id: string } }) => {
    h.sendCalls.push(data.id);
    if (h.throwOn === "send") boom("send");
    return h.sendResult;
  },
  sendInvitationsBulk: async ({ data }: { data: { ids: string[] } }) => {
    h.bulkSendCalls.push(data.ids);
    if (h.throwOn === "bulkSend") boom("bulkSend");
    return h.bulkSendResult;
  },
  linkTeamWidgets: async ({ data }: { data: { pageSlug: string } }) => {
    h.linkCalls.push(data.pageSlug);
    if (h.throwOn === "link") boom("link");
    return h.linkResult;
  },
  provisionTeamMembers: async ({ data }: { data: Record<string, unknown> }) => {
    h.provisionCalls.push(data);
    if (h.throwOn === "provision") boom("provision");
    return h.provisionResult;
  },
}));

// Natywne odpowiedniki komponentów Radiksa - patrz nagłówek pliku.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    children?: ReactNode;
  }) =>
    open ? (
      <div data-testid="dialog">
        <button type="button" data-testid="dialog-close" onClick={() => onOpenChange(false)}>
          zamknij
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      data-value={value}
      value={value}
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
    disabled,
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import { InviteUserDialog } from "@/components/admin/users/InviteUserDialog";
import { TeamImportDialog } from "@/components/admin/users/TeamImportDialog";

function candidate(overrides: Partial<TeamImportCandidate> = {}): TeamImportCandidate {
  // Pełny kształt jako ADNOTACJA (a nie rzutowanie na końcu): brak pola w tym
  // literale jest wtedy błędem kompilacji dokładnie tutaj, a nie cichym
  // `undefined` w atrapie kandydata importu.
  const base: TeamImportCandidate = {
    email: "nowa@example.org",
    name: "Nowa Osoba",
    widgetId: "w-1",
    position_pl: "Analityczka",
    position_en: "Analyst",
    programLabel_pl: null,
    programLabel_en: null,
    photo: null,
    phone: null,
    bio_pl: null,
    bio_en: null,
    linkedin: null,
    facebook: null,
    instagram: null,
    website: null,
    existingUserId: null,
    existingInvitationId: null,
  };
  return { ...base, ...overrides };
}

function selects(): HTMLSelectElement[] {
  return Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
}

function buttonWith(fragment: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((element) =>
    element.textContent?.includes(fragment),
  );
  if (!button) throw new Error(`test: brak przycisku „${fragment}”`);
  return button;
}

beforeEach(() => {
  cleanup();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.toastInfo.mockReset();
  h.createCalls = [];
  h.sendCalls = [];
  h.bulkSendCalls = [];
  h.linkCalls = [];
  h.previewCalls = [];
  h.provisionCalls = [];
  h.createResult = { ids: ["inv-1"], created: 1 };
  h.sendResult = { ok: true };
  h.bulkSendResult = { results: [{ ok: true }] };
  h.linkResult = { updated: 2 };
  h.previewResult = { candidates: [] };
  h.uploadCalls = [];
  h.uploadResult = { error: null };
  h.uploadThrows = null;
  h.provisionResult = { created: 1, skipped: 0, linked: 1, errors: [] };
  h.throwOn = null;
  h.throwRaw = false;
});

// ---------------------------------------------------------------------------
// InviteUserDialog
// ---------------------------------------------------------------------------

describe("InviteUserDialog", () => {
  function mount(props: Partial<Parameters<typeof InviteUserDialog>[0]> = {}) {
    const onOpenChange = vi.fn();
    const onDone = vi.fn();
    const utils = render(
      <InviteUserDialog open onOpenChange={onOpenChange} onDone={onDone} {...props} />,
    );
    return { ...utils, onOpenChange, onDone };
  }

  function field(id: string): HTMLInputElement {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) throw new Error(`test: brak pola #${id}`);
    return el;
  }

  function fill(
    email = "nowa@example.org",
    firstName = "Łucja",
    lastName = "Ostrowska-Nowak",
  ): void {
    fireEvent.change(field("invite-email"), { target: { value: email } });
    fireEvent.change(field("invite-first-name"), { target: { value: firstName } });
    fireEvent.change(field("invite-last-name"), { target: { value: lastName } });
  }

  it("zamknięta modalka nie renderuje niczego", () => {
    mount({ open: false });
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("startuje z rolą `author` i trybem odnośnika jednorazowego", () => {
    // Najmniejsze uprawnienie i najbezpieczniejszy tryb jako domyślne - konto
    // z hasłem tymczasowym wymaga przekazania hasła kanałem poza systemem.
    mount();
    const [roleSelect, modeSelect] = selects();
    expect(roleSelect.getAttribute("data-value")).toBe("author");
    expect(modeSelect.getAttribute("data-value")).toBe("magic_link");
  });

  it("oferuje DOKŁADNIE cztery role - `super_admin` nie jest zaproszeniem", () => {
    // Nadanie `super_admin` wymaga osobnej decyzji na karcie użytkownika
    // (i osobnego uprawnienia w RPC), więc nie może być opcją zaproszenia.
    mount();
    const values = Array.from(selects()[0].options).map((option) => option.value);
    expect(values).toEqual(["admin", "editor", "author", "user"]);
  });

  it("przycisk wysłania jest ZABLOKOWANY, dopóki brakuje adresu, imienia albo nazwiska", () => {
    mount();
    expect(buttonWith("adminTeamMedia.inviteUser.send").disabled).toBe(true);

    fireEvent.change(field("invite-email"), { target: { value: "nowa@example.org" } });
    expect(buttonWith("adminTeamMedia.inviteUser.send").disabled).toBe(true);

    fireEvent.change(field("invite-first-name"), { target: { value: "Łucja" } });
    expect(buttonWith("adminTeamMedia.inviteUser.send").disabled).toBe(true);

    fireEvent.change(field("invite-last-name"), { target: { value: "Ostrowska-Nowak" } });
    expect(buttonWith("adminTeamMedia.inviteUser.send").disabled).toBe(false);
  });

  it("pole adresu ma typ `email` - walidacja przeglądarki jest pierwszą bramką", () => {
    mount();
    expect(field("invite-email").type).toBe("email");
  });

  it("pełny formularz wysyła ładunek z ROLĄ, TRYBEM i źródłem `manual`", async () => {
    mount();
    fill();
    fireEvent.change(selects()[0], { target: { value: "editor" } });
    fireEvent.change(selects()[1], { target: { value: "temp_password" } });
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0].items).toEqual([
      {
        email: "nowa@example.org",
        display_name: "Łucja Ostrowska-Nowak",
        role: "editor",
        mode: "temp_password",
        // Źródło rozdziela zaproszenia ręczne od importu zespołu w audycie.
        source: "manual",
        // Autoakceptacja jest domyślna - administrator tworzy konto gotowe
        // do użycia, więc zaproszenie nie zostaje w stanie „wysłane".
        metadata: { auto_accept: true },
      },
    ]);
    await waitFor(() => expect(h.sendCalls).toEqual(["inv-1"]));
  });

  it("powodzenie zamyka modalkę, zgłasza `onDone` i CZYŚCI pola", async () => {
    const { onOpenChange, onDone } = mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminTeamMedia.inviteUser.sent"),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Pola muszą zniknąć: modalka otwarta ponownie z poprzednim adresem
    // kończy się drugim zaproszeniem dla tej samej osoby.
    await waitFor(() => expect(field("invite-email").value).toBe(""));
    expect(field("invite-first-name").value).toBe("");
    expect(field("invite-last-name").value).toBe("");
  });

  it("hasło tymczasowe idzie OSOBNYM komunikatem, obok komunikatu o sukcesie", async () => {
    h.sendResult = { ok: true, tempPassword: "Tmp-2026-Xk8" };
    mount();
    fill();
    fireEvent.change(selects()[1], { target: { value: "temp_password" } });
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastInfo).toHaveBeenCalled());
    expect(String(h.toastInfo.mock.calls[0][0])).toContain("Tmp-2026-Xk8");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminTeamMedia.inviteUser.sent");
  });

  it("tryb odnośnika jednorazowego NIE pokazuje żadnego hasła", async () => {
    mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("inicjały wyliczają się z osobnych pól imienia i nazwiska, dopóki nie ma zdjęcia", () => {
    mount();
    expect(screen.getByTestId("invite-avatar").textContent).toBe("?");
    fireEvent.change(field("invite-first-name"), { target: { value: "Łucja" } });
    fireEvent.change(field("invite-last-name"), { target: { value: "Ostrowska-Nowak" } });
    expect(screen.getByTestId("invite-avatar").textContent).toBe("ŁO");
  });

  it("wgrane zdjęcie zastępuje inicjały i trafia do ładunku zaproszenia", async () => {
    mount();
    fill();
    const file = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [file] } });
    await waitFor(() => expect(h.uploadCalls).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId("invite-avatar").querySelector("img")).toBeTruthy(),
    );

    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    const meta = h.createCalls[0].items[0].metadata as Record<string, unknown>;
    expect(String(meta.photo)).toContain("tenant-1/invites/");
  });

  it("zbyt duże zdjęcie i plik nie-graficzny są ODRZUCANE bez wysyłki do magazynu", async () => {
    mount();
    const text = new File(["x"], "cv.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [text] } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());

    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [big] } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(2));
    expect(h.uploadCalls).toEqual([]);
  });

  it("ANULOWANE okno wyboru pliku nie rusza magazynu i nie krzyczy błędem", async () => {
    // Przeglądarka potrafi zgłosić `change` z PUSTĄ listą plików, gdy
    // administrator otworzy okno wyboru i je zamknie. Bez straży `if (!file)`
    // dalsza część czyta `file.type` na `undefined` - modalka wywala się
    // wyjątkiem w trakcie zwykłego rozmyślenia się użytkownika.
    mount();
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [] } });
    await waitFor(() => expect(h.uploadCalls).toEqual([]));
    expect(h.toastError).not.toHaveBeenCalled();
    // Kafel awataru zostaje w stanie sprzed otwarcia okna.
    expect(screen.getByTestId("invite-avatar").textContent).toBe("?");
  });

  it("przycisk zdjęcia PRZEKAZUJE kliknięcie do ukrytego pola pliku", () => {
    // Natywne pole `type=file` jest ukryte (`className=\"hidden\"`), więc ten
    // przycisk to JEDYNE wejście do wyboru zdjęcia. Zerwane `ref` znaczy
    // martwy przycisk: nic się nie dzieje i nic o tym nie mówi.
    mount();
    const input = screen.getByTestId("invite-photo-input");
    const forwarded: string[] = [];
    input.addEventListener("click", () => forwarded.push("click"));
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.photo"));
    expect(forwarded).toEqual(["click"]);
  });

  it("usunięcie zdjęcia wraca do inicjałów i WYRZUCA zdjęcie z ładunku", async () => {
    // Bez tego kroku administrator, który wgrał niewłaściwą fotografię, nie ma
    // jak jej cofnąć - a `photo` w metadanych przepisuje się do
    // `profiles.avatar_url` przy zakładaniu konta.
    mount();
    fill();
    const file = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByTestId("invite-avatar").querySelector("img")).toBeTruthy(),
    );

    fireEvent.click(screen.getByLabelText("adminTeamMedia.inviteUser.photoRemove"));
    await waitFor(() =>
      expect(screen.getByTestId("invite-avatar").querySelector("img")).toBeNull(),
    );
    expect(screen.getByTestId("invite-avatar").textContent).toBe("ŁO");
    // Przycisk usuwania znika razem ze zdjęciem - nie ma czego usuwać.
    expect(screen.queryByLabelText("adminTeamMedia.inviteUser.photoRemove")).toBeNull();

    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0].items[0].metadata).toEqual({ auto_accept: true });
  });

  it("plik BEZ rozszerzenia ląduje w magazynie pod nazwą z `.png`", async () => {
    // Nazwa z samą kropką na końcu (tak potrafi wyglądać plik z udziału
    // sieciowego albo z wklejenia ze schowka) daje PUSTE rozszerzenie. Ścieżka
    // bez kropki i sufiksu potrafi trafić do magazynu jako plik bez typu, więc
    // przeglądarka pokazuje ją jako pobranie zamiast obrazka.
    mount();
    const file = new File(["x"], "skan.", { type: "image/png" });
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [file] } });
    await waitFor(() => expect(h.uploadCalls).toHaveLength(1));
    expect(h.uploadCalls[0].endsWith(".png")).toBe(true);
    expect(h.uploadCalls[0].startsWith("tenant-1/invites/")).toBe(true);
  });

  it("odmowa magazynu pokazuje POWÓD, nie ustawia zdjęcia i odblokowuje modalkę", async () => {
    // `StorageError` z klienta Supabase JEST `Error`, więc administrator ma
    // zobaczyć treść odmowy (np. przekroczony limit), a nie „[object Object]".
    h.uploadResult = { error: new Error("storage_quota_exceeded") };
    mount();
    fill();
    const file = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [file] } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("storage_quota_exceeded"));
    // Nieudane wgranie nie może zostawić kafla z pustym `img` ani wpisać
    // adresu, którego w magazynie nie ma.
    expect(screen.getByTestId("invite-avatar").querySelector("img")).toBeNull();
    // `uploading` blokuje przycisk wysłania - gdyby zostało włączone, modalka
    // byłaby martwa aż do zamknięcia.
    await waitFor(() => expect(buttonWith("adminTeamMedia.inviteUser.send").disabled).toBe(false));
  });

  it("błąd magazynu NIE-`Error` degraduje do tekstowej postaci wartości", async () => {
    // Zerwane połączenie z magazynem potrafi wyjść z klienta jako łańcuch.
    h.uploadThrows = "storage_offline";
    mount();
    const file = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("invite-photo-input"), { target: { files: [file] } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("storage_offline"));
    expect(screen.getByTestId("invite-avatar").textContent).toBe("?");
  });

  it("LinkedIn: błędny adres BLOKUJE wysyłkę, poprawny jedzie znormalizowany", async () => {
    mount();
    fill();
    fireEvent.change(field("invite-linkedin"), { target: { value: "https://example.org/jan" } });
    expect(buttonWith("adminTeamMedia.inviteUser.send").disabled).toBe(true);

    fireEvent.change(field("invite-linkedin"), { target: { value: "linkedin.com/in/jan" } });
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    const meta = h.createCalls[0].items[0].metadata as Record<string, unknown>;
    expect(meta.linkedin).toBe("https://linkedin.com/in/jan");
  });

  it("wyłączona autoakceptacja jedzie w metadanych jako `false`", async () => {
    mount();
    fill();
    const box = document.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (!box) throw new Error("test: brak pola autoakceptacji");
    fireEvent.click(box);
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0].items[0].metadata).toEqual({ auto_accept: false });
  });

  it("odmowa wysyłki pokazuje powód serwera i NIE mówi o sukcesie", async () => {
    h.sendResult = { ok: false, error: "mailer_unavailable" };
    mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("mailer_unavailable"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa BEZ powodu degraduje do zastępczego napisu", async () => {
    h.sendResult = { ok: false };
    mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("failed"));
  });

  it("odmowa wysyłki JEDNAK zamyka modalkę - zaproszenie zostało utworzone", async () => {
    // To NIE jest przeoczenie: rekord `user_invitations` już istnieje, więc
    // ponawianie należy do listy zaproszeń, nie do tej modalki.
    h.sendResult = { ok: false, error: "mailer_unavailable" };
    const { onOpenChange, onDone } = mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("serwer, który nie oddał identyfikatora, przerywa PRZED wysyłką", async () => {
    // Bez identyfikatora wysyłka poszłaby dla `undefined` - i serwer
    // odpowiedziałby błędem walidacji, którego nikt nie potrafi zinterpretować.
    h.createResult = { ids: [], created: 0 };
    const { onOpenChange } = mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("no_id"));
    expect(h.sendCalls).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("wyjątek utworzenia zaproszenia pokazuje komunikat i ODBLOKOWUJE formularz", async () => {
    h.throwOn = "create";
    mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("create_failed"));
    // Zablokowany przycisk po błędzie zamykałby administratora w modalce.
    await waitFor(() => expect(buttonWith("adminTeamMedia.inviteUser.send").disabled).toBe(false));
  });

  it("wyjątek wysyłki pokazuje komunikat", async () => {
    h.throwOn = "send";
    mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("send_failed"));
  });

  it("wyjątek NIE-`Error` degraduje do tekstowej postaci wartości", async () => {
    // `useServerFn` przy odpowiedzi nie-JSON rzuca surową treścią - bez tej
    // gałęzi administrator dostaje toast z napisem `[object Object]`.
    h.throwOn = "create";
    h.throwRaw = true;
    mount();
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("create_raw"));
  });

  it("przycisk anulowania zamyka modalkę i nie rusza serwera", () => {
    const { onOpenChange } = mount();
    fill();
    fireEvent.click(buttonWith("common.cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.createCalls).toHaveLength(0);
  });

  it("modalka bez `onDone` nie wywala się po powodzeniu", async () => {
    // `onDone` jest opcjonalne - modalka używana poza listą użytkowników nie
    // ma czego unieważniać.
    const onOpenChange = vi.fn();
    render(<InviteUserDialog open onOpenChange={onOpenChange} />);
    fill();
    fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it.fails(
    "DEFEKT: po wysłanym zaproszeniu ROLA zostaje podniesiona na następne zaproszenie",
    async () => {
      // `reset()` czyści adres, imię, nazwisko, LinkedIn i zdjęcie ORAZ
      // przywraca autoakceptację do `true` - ale NIE dotyka `role` ani `mode`.
      // Modalka nie jest odmontowywana (steruje nią wyłącznie `open`), więc
      // wybór z poprzedniego zaproszenia zostaje w stanie.
      //
      // SKUTEK W PRODUKCIE: administrator zaprasza jedną osobę jako `admin`,
      // zamyka modalkę, otwiera ją dla kolejnej osoby - i selektor nadal stoi
      // na `admin`. Formularz wygląda na wyczyszczony (wszystkie pola puste),
      // więc nie ma sygnału, że uprawnienie jest niedomyślne. Kolejne konto
      // dostaje pełne uprawnienia panelu przez przeoczenie.
      //
      // PRZYCZYNA: `reset()` w `InviteUserDialog.tsx` pomija `setRole("author")`
      // i `setMode("magic_link")`. Niespójność jest widoczna wprost - sąsiednia
      // `autoAccept` JEST przywracana do wartości domyślnej.
      mount();
      fill();
      fireEvent.change(selects()[0], { target: { value: "admin" } });
      fireEvent.click(buttonWith("adminTeamMedia.inviteUser.send"));
      await waitFor(() => expect(field("invite-email").value).toBe(""));
      expect(selects()[0].getAttribute("data-value")).toBe("author");
    },
  );
});

// ---------------------------------------------------------------------------
// TeamImportDialog
// ---------------------------------------------------------------------------

describe("TeamImportDialog", () => {
  function mount(props: Partial<Parameters<typeof TeamImportDialog>[0]> = {}) {
    const onOpenChange = vi.fn();
    const onDone = vi.fn();
    const utils = render(
      <TeamImportDialog open onOpenChange={onOpenChange} onDone={onDone} {...props} />,
    );
    return { ...utils, onOpenChange, onDone };
  }

  function rows(): HTMLTableRowElement[] {
    return Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  }

  function personCheckboxes(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]"));
  }

  it("zamknięta modalka NIE pyta serwera o podgląd", () => {
    mount({ open: false });
    expect(h.previewCalls).toHaveLength(0);
  });

  it("otwarcie pyta o podgląd wskazanej strony - domyślnie `o-nas`", async () => {
    mount();
    await waitFor(() => expect(h.previewCalls).toEqual(["o-nas"]));
  });

  it("inny slug strony jedzie do serwera bez zmian", async () => {
    mount({ pageSlug: "zespol" });
    await waitFor(() => expect(h.previewCalls).toEqual(["zespol"]));
  });

  it("domyślnie zaznaczone są TYLKO osoby bez konta i bez zaproszenia", async () => {
    h.previewResult = {
      candidates: [
        candidate({ email: "nowa@example.org" }),
        candidate({ email: "ma-konto@example.org", existingUserId: "u-1" }),
        candidate({ email: "zaproszona@example.org", existingInvitationId: "inv-9" }),
      ],
    };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const boxes = personCheckboxes();
    expect(boxes[0].checked).toBe(true);
    // Osoba z kontem: odznaczona I niezaznaczalna - dwie obrony przed dublem.
    expect(boxes[1].checked).toBe(false);
    expect(boxes[1].disabled).toBe(true);
    // Osoba z zaproszeniem w kolejce: odznaczona, ale zaznaczalna (ponowienie
    // jest świadomą decyzją administratora).
    expect(boxes[2].checked).toBe(false);
    expect(boxes[2].disabled).toBe(false);
  });

  it("trzy stany osoby mają TRZY różne komunikaty", async () => {
    h.previewResult = {
      candidates: [
        candidate({ email: "nowa@example.org" }),
        candidate({ email: "ma-konto@example.org", existingUserId: "u-1" }),
        candidate({ email: "zaproszona@example.org", existingInvitationId: "inv-9" }),
      ],
    };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const text = document.body.textContent ?? "";
    expect(text).toContain("adminTeamMedia.teamImport.statusNew");
    expect(text).toContain("adminTeamMedia.teamImport.statusExists");
    expect(text).toContain("adminTeamMedia.teamImport.statusQueued");
  });

  it("kolumna funkcji degraduje: etykieta programu, stanowisko PL, stanowisko EN, `-`", async () => {
    h.previewResult = {
      candidates: [
        candidate({ email: "a@example.org", programLabel_pl: "Program Wschodni" }),
        candidate({ email: "b@example.org", position_pl: "Analityczka", position_en: "Analyst" }),
        candidate({ email: "c@example.org", position_pl: null, position_en: "Analyst" }),
        candidate({ email: "d@example.org", position_pl: null, position_en: null }),
      ],
    };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(4));
    const cells = rows().map((row) => row.querySelectorAll("td")[3].textContent);
    expect(cells).toEqual(["Program Wschodni", "Analityczka", "Analyst", "-"]);
  });

  it("licznik pokazuje zaznaczone I całość - a nie tylko jedną liczbę", async () => {
    h.previewResult = {
      candidates: [
        candidate({ email: "a@example.org" }),
        candidate({ email: "b@example.org", existingUserId: "u-1" }),
      ],
    };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(document.body.textContent).toContain("selected=1");
    expect(document.body.textContent).toContain("total=2");
  });

  it("przełączanie zaznaczenia działa w obie strony", async () => {
    h.previewResult = { candidates: [candidate()] };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(personCheckboxes()[0].checked).toBe(true);
    fireEvent.click(personCheckboxes()[0]);
    await waitFor(() => expect(personCheckboxes()[0].checked).toBe(false));
    fireEvent.click(personCheckboxes()[0]);
    await waitFor(() => expect(personCheckboxes()[0].checked).toBe(true));
  });

  it("przycisk tworzenia jest ZABLOKOWANY przy zerowym zaznaczeniu", async () => {
    h.previewResult = { candidates: [candidate({ existingUserId: "u-1" })] };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(buttonWith("adminTeamMedia.teamImport.createInvitesBtn").disabled).toBe(true);
  });

  it("ładunek importu niesie ROLĘ, TRYB, źródło ze slugiem i metadane osoby", async () => {
    h.previewResult = {
      candidates: [
        candidate({
          email: "nowa@example.org",
          name: "Nowa Osoba",
          widgetId: "w-7",
          position_pl: "Analityczka",
          position_en: "Analyst",
          phone: "+48000000000",
          linkedin: "https://example.org/in",
        }),
      ],
    };
    mount({ pageSlug: "zespol" });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.change(selects()[0], { target: { value: "editor" } });
    fireEvent.change(selects()[1], { target: { value: "temp_password" } });
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    const item = h.createCalls[0].items[0];
    expect(item.email).toBe("nowa@example.org");
    expect(item.display_name).toBe("Nowa Osoba");
    expect(item.role).toBe("editor");
    expect(item.mode).toBe("temp_password");
    // Źródło niesie slug strony - inaczej audyt nie odtworzy, skąd wzięło się
    // konto, gdy zespół żyje na kilku stronach.
    expect(item.source).toBe("team_import:zespol");
    expect(item.metadata).toMatchObject({
      widgetId: "w-7",
      position_pl: "Analityczka",
      position_en: "Analyst",
      phone: "+48000000000",
      linkedin: "https://example.org/in",
    });
  });

  it("osoby Z KONTEM są odfiltrowane z ładunku, choćby były zaznaczone", async () => {
    // Druga obrona przed dublem: zaznaczenie da się przywrócić klawiaturą,
    // więc `run()` nie może polegać na zablokowanym polu.
    h.previewResult = {
      candidates: [
        candidate({ email: "nowa@example.org" }),
        candidate({ email: "ma-konto@example.org", existingUserId: "u-1" }),
      ],
    };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(2));
    // Zaznaczamy „na siłę" osobę z kontem, omijając zablokowane pole.
    fireEvent.change(personCheckboxes()[1], { target: { checked: true } });
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0].items).toHaveLength(1);
    expect(h.createCalls[0].items[0].email).toBe("nowa@example.org");
  });

  it("osoba z zaproszeniem W KOLEJCE po zaznaczeniu WCHODZI do ładunku", async () => {
    // Ponowne zaproszenie jest świadomą decyzją administratora (np. adres był
    // literówką), więc `existingInvitationId` NIE odfiltrowuje osoby - w
    // przeciwieństwie do istniejącego konta, które odfiltrowuje zawsze.
    h.previewResult = {
      candidates: [candidate({ email: "zaproszona@example.org", existingInvitationId: "inv-9" })],
    };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(personCheckboxes()[0].checked).toBe(false);
    fireEvent.click(personCheckboxes()[0]);
    await waitFor(() => expect(personCheckboxes()[0].checked).toBe(true));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0].items[0].email).toBe("zaproszona@example.org");
  });

  // GAŁĄŹ NIEOSIĄGALNA Z INTERFEJSU: `items.length === 0` w `run()`
  // (komunikat `toastNoNew`). Żeby ją wywołać, w `selected` musiałby siedzieć
  // WYŁĄCZNIE adres kandydata, który ma już konto - a takiego adresu nie da się
  // tam włożyć. Trzy niezależne powody:
  //   1. domyślne zaznaczenie bierze tylko osoby bez konta i bez zaproszenia,
  //   2. pole osoby z kontem jest `disabled`, a Reakt NIE dowozi zdarzenia do
  //      zablokowanej kontrolki formularza - sprawdzone: `fireEvent.change`
  //      z `checked: true` na tym polu nie rusza licznika zaznaczeń,
  //   3. każde nowe wczytanie podglądu przestawia `selected` RAZEM z listą
  //      kandydatów (jedno `.then`), więc oba stany nie mogą się rozjechać.
  // Obrona zostaje w kodzie na wypadek rozluźnienia warunku `disabled` - tylko
  // nie da się jej wywołać z testu bez rozmontowania tej gwarancji. Drugą,
  // realnie działającą obronę (filtr `!existingUserId` w `run()`) pokrywa test
  // „osoby Z KONTEM są odfiltrowane z ładunku".

  it("dowiązanie widgetów jest DOMYŚLNIE włączone i biegnie po utworzeniu", async () => {
    // Bez dowiązania widget zespołu nadal nie wskazuje na konto - import
    // „się udał", a strona o nas wygląda tak samo jak przed nim.
    h.previewResult = { candidates: [candidate()] };
    const { onDone, onOpenChange } = mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.linkCalls).toEqual(["o-nas"]));
    expect(h.bulkSendCalls).toHaveLength(0);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("wyłączone dowiązanie pomija ten krok", async () => {
    h.previewResult = { candidates: [candidate()] };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const [autoLink] = Array.from(
      document.querySelectorAll<HTMLInputElement>("label input[type=checkbox]"),
    );
    fireEvent.click(autoLink);
    await waitFor(() => expect(autoLink.checked).toBe(false));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.linkCalls).toHaveLength(0);
  });

  it("„wyślij od razu” dokłada wysyłkę zbiorczą i RAPORTUJE porażki", async () => {
    h.previewResult = { candidates: [candidate(), candidate({ email: "druga@example.org" })] };
    h.createResult = { ids: ["inv-1", "inv-2"], created: 2 };
    h.bulkSendResult = { results: [{ ok: true }, { ok: false }] };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(2));
    const boxes = Array.from(
      document.querySelectorAll<HTMLInputElement>("label input[type=checkbox]"),
    );
    fireEvent.click(boxes[1]);
    await waitFor(() => expect(boxes[1].checked).toBe(true));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.bulkSendCalls).toEqual([["inv-1", "inv-2"]]));
    // Komunikat niesie OBIE liczby - „wysłano 2" przy jednej porażce byłoby
    // kłamstwem, a „nie udało się" przy jednym sukcesie zbędnym alarmem.
    const message = h.toastSuccess.mock.calls.map((call) => String(call[0])).join("|");
    expect(message).toContain("ok=1");
    expect(message).toContain("fail=1");
  });

  it("„wyślij od razu” bez utworzonych identyfikatorów pomija wysyłkę", async () => {
    h.previewResult = { candidates: [candidate()] };
    h.createResult = { ids: [], created: 0 };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const boxes = Array.from(
      document.querySelectorAll<HTMLInputElement>("label input[type=checkbox]"),
    );
    fireEvent.click(boxes[1]);
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.bulkSendCalls).toHaveLength(0);
  });

  it("wyjątek podglądu pokazuje komunikat i kończy wczytywanie", async () => {
    h.throwOn = "preview";
    mount();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("preview_failed"));
    // Napis „wczytywanie" zostawiony na zawsze wyglądałby jak zawieszenie.
    await waitFor(() =>
      expect(document.body.textContent).not.toContain("adminTeamMedia.teamImport.loading"),
    );
  });

  it("wyjątek utworzenia NIE zamyka modalki - administrator może poprawić wybór", async () => {
    h.previewResult = { candidates: [candidate()] };
    h.throwOn = "create";
    const { onOpenChange } = mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("create_failed"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(buttonWith("adminTeamMedia.teamImport.createInvitesBtn").disabled).toBe(false),
    );
  });

  it("wyjątek dowiązania widgetów nie unieważnia UTWORZONYCH zaproszeń", async () => {
    // Zaproszenia już są w bazie - komunikat musi mówić o dowiązaniu, a nie
    // sugerować, że cały import przepadł.
    h.previewResult = { candidates: [candidate()] };
    h.throwOn = "link";
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("link_failed"));
    expect(h.createCalls).toHaveLength(1);
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("wyjątek wysyłki zbiorczej nie ukrywa utworzenia", async () => {
    h.previewResult = { candidates: [candidate()] };
    h.throwOn = "bulkSend";
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const boxes = Array.from(
      document.querySelectorAll<HTMLInputElement>("label input[type=checkbox]"),
    );
    fireEvent.click(boxes[1]);
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("bulkSend_failed"));
    expect(h.createCalls).toHaveLength(1);
  });

  it("ścieżka „utwórz konta od razu” jedzie osobnym wywołaniem z ROLĄ i dowiązaniem", async () => {
    h.previewResult = { candidates: [candidate()] };
    const { onDone, onOpenChange } = mount({ pageSlug: "zespol" });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.change(selects()[0], { target: { value: "admin" } });
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.provisionBtn"));
    await waitFor(() => expect(h.provisionCalls).toHaveLength(1));
    expect(h.provisionCalls[0]).toEqual({ pageSlug: "zespol", role: "admin", autoLink: true });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("„utwórz konta od razu” raportuje PIERWSZY błąd wraz z liczbą wszystkich", async () => {
    h.previewResult = { candidates: [candidate()] };
    h.provisionResult = {
      created: 1,
      skipped: 1,
      linked: 1,
      errors: [
        { email: "pierwsza@example.org", error: "duplicate" },
        { email: "druga@example.org", error: "mailer" },
      ],
    };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.provisionBtn"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const message = String(h.toastError.mock.calls[0][0]);
    expect(message).toContain("count=2");
    expect(message).toContain("pierwsza@example.org");
  });

  it("„utwórz konta od razu” BEZ błędów nie pokazuje komunikatu błędu", async () => {
    h.previewResult = { candidates: [candidate()] };
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.provisionBtn"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("wyjątek „utwórz konta od razu” odblokowuje modalkę", async () => {
    h.previewResult = { candidates: [candidate()] };
    h.throwOn = "provision";
    const { onOpenChange } = mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.provisionBtn"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("provision_failed"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(buttonWith("adminTeamMedia.teamImport.provisionBtn").disabled).toBe(false),
    );
  });

  it("„utwórz konta od razu” jest zablokowane przy PUSTYM podglądzie", async () => {
    // Zerowa lista kandydatów znaczy „na tej stronie nie ma widgetów zespołu" -
    // nie ma czego tworzyć, a przycisk nie może tego udawać.
    mount();
    await waitFor(() => expect(h.previewCalls).toHaveLength(1));
    await waitFor(() =>
      expect(buttonWith("adminTeamMedia.teamImport.provisionBtn").disabled).toBe(true),
    );
  });

  it("wyjątek NIE-`Error` w PODGLĄDZIE degraduje do tekstowej postaci wartości", async () => {
    h.throwOn = "preview";
    h.throwRaw = true;
    mount();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("preview_raw"));
  });

  it("wyjątek NIE-`Error` w IMPORCIE degraduje do tekstowej postaci wartości", async () => {
    h.previewResult = { candidates: [candidate()] };
    h.throwOn = "create";
    h.throwRaw = true;
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("create_raw"));
  });

  it("wyjątek NIE-`Error` w „utwórz konta od razu” degraduje do tekstowej postaci", async () => {
    h.previewResult = { candidates: [candidate()] };
    h.throwOn = "provision";
    h.throwRaw = true;
    mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.provisionBtn"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("provision_raw"));
  });

  it("anulowanie zamyka modalkę bez wywołania serwera", async () => {
    h.previewResult = { candidates: [candidate()] };
    const { onOpenChange } = mount();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("common.cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.createCalls).toHaveLength(0);
  });

  it("modalka bez `onDone` kończy import bez wyjątku", async () => {
    h.previewResult = { candidates: [candidate()] };
    const onOpenChange = vi.fn();
    render(<TeamImportDialog open onOpenChange={onOpenChange} />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(buttonWith("adminTeamMedia.teamImport.createInvitesBtn"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("tytuł modalki niesie slug strony - administrator widzi, co importuje", async () => {
    mount({ pageSlug: "zespol" });
    await waitFor(() => expect(h.previewCalls).toHaveLength(1));
    expect(document.querySelector("h2")?.textContent).toContain("slug=zespol");
  });
});
