// Skrzynka zgłoszeń klubowych - SKLEJENIE trzech zapytań i dwóch mutacji.
//
// CO TEN PLIK DOWODZI. Ta ścieżka ma incydent produkcyjny w historii
// (`source_type='club_application'` złamał CHECK na `crm_leads`, i dlatego
// istnieje bramka `check:pg-harness`), więc testujemy ją jak coś, co już raz
// zawiodło - od argumentów RPC do treści toastu:
//
//   1. CO IDZIE DO RPC. Filtr statusu i szukanie jadą jako `p_status`/`p_search`,
//      a ich BRAK jako `undefined` - nie jako pusty napis. Pusty napis
//      w `p_status` to filtr po statusie równym „” , czyli pusta skrzynka
//      wyglądająca jak brak zgłoszeń.
//   2. `duplicate_open` JEST NAZWANY. Cofnięcie decyzji przy drugim OTWARTYM
//      zgłoszeniu tej osoby kończy się tym kodem z bazy. Bez nazwania operator
//      widzi wyłącznie „nie udało się zapisać statusu” i nie wie, że przeszkodą
//      jest inne zgłoszenie - to jest RÓŻNICA między błędem do zrozumienia
//      a awarią, i dlatego ma tu osobny test.
//   3. POCZTA IDZIE TYLKO DLA DECYZJI, KTÓRE KANDYDAT MUSI POZNAĆ, a jej
//      porażka NIE cofa decyzji: status zapisany, drugi toast o mailu.
//   4. PONOWIENIE SYNCHRONIZACJI CRM dotyczy JEDNEGO wiersza (blokada i wirujący
//      piktogram tylko przy nim), a jego wynik jest nazwany - także wtedy, gdy
//      po ponowieniu stan nadal nie jest `ok`.
//   5. TRZY STANY LISTY: dane / pustka / zapytanie w locie, plus dane CZĘŚCIOWE
//      (zgłoszenie bez klubu, bez telefonu, bez poczty, bez lat doświadczenia) -
//      żadne z tych pól nie ma prawa pokazać gołego `undefined`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) REGUŁ skrzynki - tabele przypadków (tony,
// deskryptor CRM, stan poczty, lista pól kartoteki, zakładki z licznikami) są
// w `lib/clubs/__tests__/adminApplicationsInbox.test.ts`; tutaj dowodzimy, że
// organizm ich UŻYWA i co robi z odpowiedzią. (2) KONTRAKTU warstwy danych
// (nazwy funkcji RPC, mapowanie komunikatu bazy na kod) - to `applyApi.test.ts`.
// (3) AUTORYZACJI - jest w SECURITY DEFINER i w pgTAP; `admin_club_*` woła
// `assert_admin_tenant()`, a nie ten komponent. (4) WYSYŁKI maila - server fn
// `notifyClubApplicationStatus` ma własny zakres; tutaj jest atrapą, bo
// przedmiotem dowodu jest to, CO panel do niej wysyła i co robi z wynikiem.
//
// Radix Select nie działa pod happy-dom bez pełnego pointer API - `FormSelect`
// jest podmieniony na natywny `<select>` (wzór z `clubApplyRoute.test.tsx`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubApplicationNotifyResult } from "@/lib/clubs/applicationNotify.functions";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Argumenty, z jakimi panel wołał server fn powiadomienia. */
  notifyCalls: [] as { data: { applicationId: string; status: string } }[],
  notifyResult: { ok: true } as ClubApplicationNotifyResult,
  /** Gdy ustawione, server fn ODRZUCA tą wartością (także nie-`Error`). */
  notifyRejects: null as unknown,
  /**
   * Nazwa RPC, które ma ZAWISNĄĆ - tak testujemy stan „zapytanie w locie”
   * i blokady na czas zapisu bez ani jednego `setTimeout`.
   */
  hangRpc: null as string | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Klient Supabase: rejestrator RPC modułu klubów, z jednym dodatkiem - wybrane
// wywołanie może ZAWISNĄĆ. Bez tego nie da się dowieść blokad na czas zapisu:
// atrapa odpowiada natychmiast, a stan „w locie” trwa wtedy krócej niż jedno
// przemalowanie.
vi.mock("@/integrations/supabase/client", async () => {
  const { clubRpc } = await import("@/test/clubs/fixtures");
  return {
    supabase: {
      rpc: (name: string, args?: Record<string, unknown>) =>
        name === h.hangRpc ? new Promise<never>(() => {}) : clubRpc.rpc(name, args),
    },
  };
});
// Atrapa TanStack Start: łańcuch `createServerFn` (żeby moduł powiadomienia dał
// się zaimportować) i `useServerFn`, które oddaje atrapę wysyłki.
vi.mock("@tanstack/react-start", async () => {
  const { reactStartMock } = await import("@/test/serverFnChain");
  return {
    ...reactStartMock(),
    createMiddleware: () => ({ server: () => ({}) }),
    useServerFn: () => async (input: { data: { applicationId: string; status: string } }) => {
      h.notifyCalls.push(input);
      if (h.notifyRejects !== null) throw h.notifyRejects;
      return h.notifyResult;
    },
  };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    value,
    onValueChange,
    options,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: readonly { value: string; label: ReactNode }[];
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

import { ClubApplicationsInbox } from "@/components/admin/clubs/organisms/ClubApplicationsInbox";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { clubIsoOffset, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import {
  APPLICATION_IDS,
  clubApplicationAdminRow,
  clubApplicationCountRow,
  clubApplicationCrmRetryResult,
} from "@/test/clubs/inboxFixtures";

const LIST = "admin_club_applications_list";
const COUNTS = "admin_club_applications_counts";
const SET_STATUS = "admin_club_application_set_status";
const CRM_RETRY = "admin_club_application_crm_retry";
const SPECS = "club_specializations_public";

/** Wiersz katalogu specjalizacji w kształcie, jaki oddaje RPC. */
function specRow(slug: string, labelPl: string, labelEn: string, sort: number) {
  return {
    slug,
    key: slug,
    label_pl: labelPl,
    label_en: labelEn,
    lead_pl: null,
    lead_en: null,
    desc_pl: null,
    desc_en: null,
    icon: "zap",
    sort_order: sort,
    club_count: 2,
  };
}

/** Zgłoszenie zsynchronizowane z CRM, czekające na decyzję. */
const pendingRow = () =>
  clubApplicationAdminRow({
    id: APPLICATION_IDS.first,
    status: "pending",
    notified_status: null,
    notified_at: null,
  });

/** Zgłoszenie, którego kartoteka w CRM NIE powstała - z treścią błędu. */
const brokenCrmRow = () =>
  clubApplicationAdminRow({
    id: APPLICATION_IDS.second,
    first_name: "Marek",
    last_name: "Nowak",
    status: "accepted",
    specialization_slug: "cyfryzacja",
    crm_lead_id: null,
    crm_sync_status: "error",
    crm_synced_at: null,
    crm_last_attempt_at: clubIsoOffset(30),
    crm_error: 'new row for relation "crm_leads" violates check constraint',
    notified_status: "accepted",
    notified_at: clubIsoOffset(35),
  });

/** Zgłoszenie CZĘŚCIOWE: bez klubu, bez części pól, bez próby CRM i bez poczty. */
const sparseRow = () =>
  clubApplicationAdminRow({
    id: APPLICATION_IDS.third,
    first_name: "Ewa",
    last_name: "Lis",
    status: "needs_info",
    club_id: null,
    club_name_pl: null,
    club_name_en: null,
    phone: "",
    city: "",
    industry: "",
    linkedin_url: "",
    languages: "",
    availability: "",
    referral_source: "",
    goals: "",
    contribution: "",
    years_experience: null,
    crm_lead_id: null,
    crm_sync_status: "pending",
    crm_synced_at: null,
    crm_last_attempt_at: null,
    notified_status: null,
    notified_at: null,
    notify_error: "550 mailbox unavailable",
  });

function planujDane(rows: unknown[] = [pendingRow(), brokenCrmRow(), sparseRow()]): void {
  clubRpc.setData(SPECS, [
    specRow("energia-klimat", "Energia i klimat", "Energy and climate", 1),
    specRow("cyfryzacja", "Cyfryzacja", "Digital", 2),
  ]);
  clubRpc.setData(COUNTS, [
    clubApplicationCountRow({ specialization_slug: "energia-klimat", pending: 2, total: 4 }),
    clubApplicationCountRow({ specialization_slug: "cyfryzacja", pending: 0, total: 1 }),
  ]);
  clubRpc.setData(LIST, rows);
}

/** Wiersz o danym nazwisku - asercje idą po wierszu, nie po całej stronie. */
function wiersz(nazwisko: string): HTMLElement {
  const items = screen.getAllByRole("listitem");
  const found = items.find((item) => item.textContent?.includes(nazwisko));
  if (!found) throw new Error(`test: brak wiersza dla ${nazwisko}`);
  return found;
}

async function zamontuj(): Promise<void> {
  renderWithQueryClient(<ClubApplicationsInbox />);
  await waitFor(() => expect(clubRpc.callsFor(LIST).length).toBeGreaterThan(0));
}

beforeEach(() => {
  cleanup();
  resetClubRpc();
  h.lang = "pl";
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.notifyCalls.length = 0;
  h.notifyResult = { ok: true };
  h.notifyRejects = null;
  h.hangRpc = null;
});

// --- 1. trzy stany listy + dane częściowe ----------------------------------

describe("stany skrzynki", () => {
  it("zapytanie W LOCIE mówi „wczytuję”, a nie „brak zgłoszeń”", () => {
    planujDane();
    renderWithQueryClient(<ClubApplicationsInbox />);
    expect(screen.getByText("adminClubs.applications.loading")).toBeInTheDocument();
    expect(screen.queryByText("adminClubs.applications.empty")).not.toBeInTheDocument();
  });

  it("pusta skrzynka mówi o pustce i nie renderuje ani jednego wiersza", async () => {
    planujDane([]);
    await zamontuj();
    await waitFor(() =>
      expect(screen.getByText("adminClubs.applications.empty")).toBeInTheDocument(),
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("dane pełne renderują wiersz na zgłoszenie, ze statusem i stanem CRM", async () => {
    planujDane();
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));

    const anna = wiersz("Kowalska");
    expect(within(anna).getByText("adminClubs.applications.status.pending")).toBeInTheDocument();
    expect(anna.textContent).toContain("adminClubs.applications.crm.ok");
    expect(anna.textContent).toContain("anna.kowalska@example.org");
    // Nazwa klubu w języku operatora - polski interfejs, polska kolumna.
    expect(anna.textContent).toContain("Klub energetyczny");
    // Bez wysyłki poczty: osobny komunikat, nie puste miejsce.
    expect(anna.textContent).toContain("adminClubs.applications.mail.none");
  });

  it("dane CZĘŚCIOWE nie pokazują gołego undefined ani null", async () => {
    planujDane([sparseRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    const ewa = wiersz("Lis");
    expect(ewa.textContent).not.toContain("undefined");
    expect(ewa.textContent).not.toContain("null");
    // Brak klubu: wiersz pokazuje specjalizację i warstwę, bez pustego separatora.
    expect(ewa.textContent).toContain("energia-klimat");
    // CRM bez ANI JEDNEJ próby to osobny stan - nie „ostatnia próba: -”.
    expect(ewa.textContent).toContain("adminClubs.applications.crm.never");
    expect(ewa.textContent).not.toContain("adminClubs.applications.crm.lastAttempt");
    // Nieudana wysyłka niesie treść błędu z bazy.
    expect(ewa.textContent).toContain("adminClubs.applications.mail.error");
  });

  it("awaria katalogu specjalizacji zostawia samą zakładkę „wszystkie”", async () => {
    clubRpc.setError(SPECS, "permission denied for function club_specializations_public");
    clubRpc.setData(COUNTS, []);
    clubRpc.setData(LIST, []);
    await zamontuj();
    await waitFor(() =>
      expect(screen.getByText("adminClubs.applications.empty")).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab")).toHaveAttribute("aria-selected", "true");
  });

  it.fails(
    "AWARIA RPC listy powinna mieć własny komunikat, a nie wyglądać jak pusta skrzynka",
    async () => {
      clubRpc.setData(SPECS, []);
      clubRpc.setData(COUNTS, []);
      clubRpc.setError(LIST, "permission denied for function admin_club_applications_list");
      await zamontuj();
      await waitFor(() =>
        expect(screen.getByText("adminClubs.applications.empty")).toBeInTheDocument(),
      );
      // Skrzynka po odmowie bazy mówi dokładnie to samo, co skrzynka pusta -
      // redakcja nie ma jak odróżnić „nie ma zgłoszeń” od „nie mam dostępu”.
      expect(screen.queryByText("adminClubs.applications.error")).toBeInTheDocument();
    },
  );
});

// --- 2. zakładki i filtry --------------------------------------------------

describe("zakładki i filtry", () => {
  it("zakładki mają licznik zaległości i przełączają filtr specjalizacji", async () => {
    planujDane();
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));

    const tabs = screen.getAllByRole("tab");
    // Suma zaległości przy „wszystkich”, zero NIE renderuje licznika.
    expect(tabs[0].textContent).toBe("adminClubs.applications.allTab2");
    expect(tabs[1].textContent).toBe("Energia i klimat2");
    expect(tabs[2].textContent).toBe("Cyfryzacja");

    fireEvent.click(tabs[2]);
    await waitFor(() => expect(clubRpc.lastCall(LIST)?.arg("p_specialization")).toBe("cyfryzacja"));
    expect(screen.getAllByRole("tab")[2]).toHaveAttribute("aria-selected", "true");
  });

  it("BRAK filtra jedzie do RPC jako undefined, nie jako pusty napis", async () => {
    planujDane();
    await zamontuj();
    const call = clubRpc.lastCall(LIST);
    expect(call?.arg("p_specialization")).toBeUndefined();
    expect(call?.arg("p_status")).toBeUndefined();
    expect(call?.arg("p_search")).toBeUndefined();
    expect(call?.arg("p_limit")).toBe(200);
  });

  it("szukanie i filtr statusu jadą do RPC jako argumenty", async () => {
    planujDane();
    await zamontuj();

    fireEvent.change(screen.getByLabelText("adminClubs.applications.searchPlaceholder"), {
      target: { value: "kowalska" },
    });
    await waitFor(() => expect(clubRpc.lastCall(LIST)?.arg("p_search")).toBe("kowalska"));

    fireEvent.change(screen.getByLabelText("adminClubs.applications.allStatuses"), {
      target: { value: "review" },
    });
    await waitFor(() => expect(clubRpc.lastCall(LIST)?.arg("p_status")).toBe("review"));
    expect(clubRpc.lastCall(LIST)?.arg("p_search")).toBe("kowalska");
  });

  it("powrót do „wszystkich statusów” NIGDY nie wysyła pustego napisu", async () => {
    planujDane();
    await zamontuj();
    const select = screen.getByLabelText("adminClubs.applications.allStatuses");
    fireEvent.change(select, { target: { value: "accepted" } });
    await waitFor(() => expect(clubRpc.lastCall(LIST)?.arg("p_status")).toBe("accepted"));

    fireEvent.change(select, { target: { value: "" } });
    // Widok wraca na listę bez filtra (z cache - klucz zapytania jest ten sam,
    // co przy wejściu), a w CAŁEJ historii wywołań nie ma ani jednego
    // `p_status: ""`. Pusty napis byłby filtrem po statusie, którego nie ma.
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    for (const call of clubRpc.callsFor(LIST)) expect(call.arg("p_status")).not.toBe("");
    for (const call of clubRpc.callsFor(LIST)) expect(call.arg("p_search")).not.toBe("");
  });

  it("pole wyboru statusu oferuje PEŁNY słownik plus „wszystkie”", async () => {
    planujDane();
    await zamontuj();
    const select = screen.getByLabelText("adminClubs.applications.allStatuses");
    expect([...select.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "",
      "pending",
      "review",
      "accepted",
      "rejected",
      "needs_info",
    ]);
  });
});

// --- 3. zmiana statusu i poczta --------------------------------------------

describe("zmiana statusu", () => {
  it("wysyła id i status do RPC, a decyzję do wiadomej kandydatowi poczty", async () => {
    planujDane([pendingRow()]);
    clubRpc.setData(SET_STATUS, null);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.accepted"),
    );

    await waitFor(() => expect(clubRpc.lastCall(SET_STATUS)?.arg("p_status")).toBe("accepted"));
    expect(clubRpc.lastCall(SET_STATUS)?.arg("p_id")).toBe(APPLICATION_IDS.first);
    expect(h.notifyCalls).toEqual([
      { data: { applicationId: APPLICATION_IDS.first, status: "accepted" } },
    ]);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.applications.statusSaved"),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.applications.mail.queued");
  });

  it("status obecny NIE jest przyciskiem - nie da się zapisać tego, co już jest", async () => {
    planujDane([pendingRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    const anna = wiersz("Kowalska");
    expect(
      within(anna).queryByText("adminClubs.applications.setStatus.pending"),
    ).not.toBeInTheDocument();
    expect(within(anna).getAllByRole("button")).toHaveLength(
      // rozwijanie + ponowienie CRM nie występuje przy `ok`, więc 1 + 4 statusy
      5,
    );
  });

  it("decyzja BEZ powiadomienia (przegląd) nie rusza poczty", async () => {
    planujDane([pendingRow()]);
    clubRpc.setData(SET_STATUS, null);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.review"),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.applications.statusSaved"),
    );
    expect(h.notifyCalls).toEqual([]);
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("przyciski statusu są ODCIĘTE na czas zapisu", async () => {
    planujDane([pendingRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    // Zapis wisi, więc stan „w locie” trwa - dokładnie wtedy podwójne
    // kliknięcie zapisałoby dwa razy.
    h.hangRpc = SET_STATUS;
    const przycisk = within(wiersz("Kowalska")).getByText(
      "adminClubs.applications.setStatus.rejected",
    );
    fireEvent.click(przycisk);
    await waitFor(() => expect(przycisk.closest("button")).toBeDisabled());
    for (const status of ["accepted", "review", "needs_info"]) {
      expect(
        within(wiersz("Kowalska"))
          .getByText(`adminClubs.applications.setStatus.${status}`)
          .closest("button"),
      ).toBeDisabled();
    }
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("nieudana wysyłka NIE cofa decyzji - status zapisany, osobny błąd poczty", async () => {
    planujDane([pendingRow()]);
    clubRpc.setData(SET_STATUS, null);
    h.notifyResult = { ok: false, error: "smtp down" };
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.rejected"),
    );
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.applications.mail.failed"),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.applications.statusSaved");
  });

  it("poczta wysłana wcześniej (duplikat) mówi osobnym zdaniem, ale sukcesem", async () => {
    planujDane([pendingRow()]);
    clubRpc.setData(SET_STATUS, null);
    h.notifyResult = { ok: true, skipped: "duplicate" };
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.needs_info"),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.applications.mail.duplicate"),
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("zapis unieważnia liczniki i listę - zaległość przy zakładce znika", async () => {
    planujDane([pendingRow()]);
    clubRpc.setData(SET_STATUS, null);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    const przedZapisem = clubRpc.callsFor(COUNTS).length;

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.review"),
    );
    await waitFor(() => expect(clubRpc.callsFor(COUNTS).length).toBeGreaterThan(przedZapisem));
  });
});

// --- 4. odmowa bazy: incydent `duplicate_open` -----------------------------

describe("odmowa zapisu statusu", () => {
  it("COFNIĘCIE decyzji przy drugim otwartym zgłoszeniu jest NAZWANE", async () => {
    planujDane([clubApplicationAdminRow({ status: "accepted" })]);
    clubRpc.setError(SET_STATUS, "club_application_set_status: duplicate_open", "23505");
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.pending"),
    );
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminClubs.applications.statusErrors.duplicate_open",
      ),
    );
    expect(h.toastError).not.toHaveBeenCalledWith("adminClubs.applications.statusError");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa, której nie umiemy nazwać, schodzi na komunikat ogólny", async () => {
    planujDane([pendingRow()]);
    clubRpc.setError(SET_STATUS, "permission denied for function", "42501");
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.review"),
    );
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.applications.statusError"),
    );
  });

  it("odrzucenie NIE będące wyjątkiem też ma komunikat, a nie ciszę", async () => {
    planujDane([pendingRow()]);
    clubRpc.setData(SET_STATUS, null);
    h.notifyRejects = "sieć padła";
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(
      within(wiersz("Kowalska")).getByText("adminClubs.applications.setStatus.accepted"),
    );
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.applications.statusError"),
    );
  });
});

// --- 5. synchronizacja CRM ------------------------------------------------

describe("ponowienie synchronizacji CRM", () => {
  it("wiersz `ok` NIE ma przycisku ponowienia - nie ma czego ponawiać", async () => {
    planujDane([pendingRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(
      within(wiersz("Kowalska")).queryByText("adminClubs.applications.crm.retry"),
    ).not.toBeInTheDocument();
  });

  it("wiersz w błędzie ponawia po SWOIM id i mówi o sukcesie", async () => {
    planujDane([brokenCrmRow()]);
    clubRpc.setData(CRM_RETRY, [clubApplicationCrmRetryResult()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(within(wiersz("Nowak")).getByText("adminClubs.applications.crm.retry"));
    await waitFor(() =>
      expect(clubRpc.lastCall(CRM_RETRY)?.arg("p_id")).toBe(APPLICATION_IDS.second),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.applications.crm.retryOk"),
    );
  });

  it("ponowienie, po którym stan NADAL nie jest `ok`, nie udaje sukcesu", async () => {
    planujDane([brokenCrmRow()]);
    clubRpc.setData(CRM_RETRY, [
      clubApplicationCrmRetryResult({
        crm_sync_status: "error",
        crm_synced_at: null,
        crm_error: "check constraint",
      }),
    ]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(within(wiersz("Nowak")).getByText("adminClubs.applications.crm.retry"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.applications.crm.retryFailed"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa RPC ponowienia mówi tym samym błędem, a nie ciszą", async () => {
    planujDane([brokenCrmRow()]);
    clubRpc.setError(CRM_RETRY, "permission denied for function");
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(within(wiersz("Nowak")).getByText("adminClubs.applications.crm.retry"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.applications.crm.retryFailed"),
    );
  });

  it("blokada dotyczy WYŁĄCZNIE ponawianego wiersza", async () => {
    planujDane([brokenCrmRow(), sparseRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));

    h.hangRpc = CRM_RETRY;
    fireEvent.click(within(wiersz("Nowak")).getByText("adminClubs.applications.crm.retry"));
    await waitFor(() =>
      expect(
        within(wiersz("Nowak")).getByText("adminClubs.applications.crm.retrying"),
      ).toBeInTheDocument(),
    );
    // Drugi wiersz zostaje klikalny - ponowienie jest per zgłoszenie, nie per
    // skrzynka; wspólna blokada zatrzymywałaby pracę nad ośmioma wierszami.
    expect(
      within(wiersz("Lis")).getByText("adminClubs.applications.crm.retry"),
    ).toBeInTheDocument();
    expect(
      within(wiersz("Lis")).getByText("adminClubs.applications.crm.retry").closest("button"),
    ).not.toBeDisabled();
  });

  it("udane ponowienie unieważnia listę - stan CRM na wierszu jest świeży", async () => {
    planujDane([brokenCrmRow()]);
    clubRpc.setData(CRM_RETRY, [clubApplicationCrmRetryResult()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    const przed = clubRpc.callsFor(LIST).length;

    fireEvent.click(within(wiersz("Nowak")).getByText("adminClubs.applications.crm.retry"));
    await waitFor(() => expect(clubRpc.callsFor(LIST).length).toBeGreaterThan(przed));
  });
});

// --- 6. kartoteka kandydata -----------------------------------------------

describe("kartoteka kandydata", () => {
  it("rozwija się i zwija, a pola puste NIE renderują etykiet", async () => {
    planujDane([sparseRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    const ewa = wiersz("Lis");
    const rozwin = within(ewa).getAllByRole("button")[0];
    expect(rozwin).toHaveAttribute("aria-expanded", "false");
    expect(within(ewa).queryByText("club.spec.apply.motivation")).not.toBeInTheDocument();

    fireEvent.click(rozwin);
    expect(rozwin).toHaveAttribute("aria-expanded", "true");
    // Wypełnione zostają: kraj, staż, doświadczenie, motywacja.
    expect(within(ewa).getByText("club.spec.apply.country")).toBeInTheDocument();
    expect(within(ewa).getByText("club.spec.apply.motivation")).toBeInTheDocument();
    // Puste: telefon, miasto, lata, cele, wkład.
    expect(within(ewa).queryByText("club.spec.apply.phone")).not.toBeInTheDocument();
    expect(within(ewa).queryByText("club.spec.apply.years")).not.toBeInTheDocument();
    expect(within(ewa).queryByText("club.spec.apply.goals")).not.toBeInTheDocument();

    fireEvent.click(rozwin);
    expect(within(ewa).queryByText("club.spec.apply.motivation")).not.toBeInTheDocument();
  });

  it("kartoteka kompletna pokazuje WSZYSTKIE czternaście pól", async () => {
    planujDane([pendingRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    const anna = wiersz("Kowalska");
    fireEvent.click(within(anna).getAllByRole("button")[0]);
    expect(within(anna).getAllByRole("definition")).toHaveLength(14);
    expect(within(anna).getByText("+48 600 100 200")).toBeInTheDocument();
    expect(within(anna).getByText("9")).toBeInTheDocument();
  });
});

// --- 7. język operatora ---------------------------------------------------

describe("język interfejsu", () => {
  it("po angielsku wygrywają angielskie nazwy klubu i specjalizacji", async () => {
    h.lang = "en";
    planujDane([pendingRow()]);
    await zamontuj();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));

    expect(wiersz("Kowalska").textContent).toContain("Energy club");
    expect(screen.getAllByRole("tab")[1].textContent).toBe("Energy and climate2");
  });
});
