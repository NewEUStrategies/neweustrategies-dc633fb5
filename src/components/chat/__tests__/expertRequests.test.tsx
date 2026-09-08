// Formularz „Zapytanie do eksperta" od kliknięcia do RPC - trzy pliki, które
// stały na czystym zerze (`ExpertRequestDialog` 0/71 linii i 0/26 funkcji,
// `ExpertRequestDialogHost` 0/5 i 0/3, `ExpertRequestsInbox` 0/49 i 0/16).
//
// CO JEST PRZEDMIOTEM DOWODU. Ta ścieżka jest PŁATNA i JEDNOKIERUNKOWA:
// wysłane zapytanie zjada miesięczną pulę nadawcy i nie wraca nawet po
// wycofaniu (migracja 20260806160000). Dowodzimy więc rzeczy, których czysta
// reguła nie dowiedzie:
//   * prefill z szyny faktycznie ląduje w polu tematu, a zmiana odbiorcy NIE
//     przenosi treści pisanej dla kogoś innego,
//   * bramka wysyłki trzyma pusty temat, puste uzasadnienie i przekroczoną
//     długość PRZED wywołaniem RPC (zużyta pula za literówkę jest nie do
//     odzyskania),
//   * `send_expert_inmail` dostaje KOMPLET i NAZWY argumentów - zgubiony
//     `p_external_links` czy `p_expected_answers` przechodzi przez `tsc`
//     i przez przegląd, bo obiekt argumentów jest luźny,
//   * werdykty serwera (opt-out odbiorcy, wyczerpana pula, nieznana odmowa)
//     są POKAZYWANE użytkownikowi, a nie zjadane w „Spróbuj ponownie",
//   * skrzynka eksperta oddaje decyzję (przyjmij/odrzuć) i identyfikator
//     rozmowy, którą serwer utworzył przy zatwierdzeniu.
//
// ŚWIADOMIE POZA ZAKRESEM (mają własne dowody, nie powtarzamy ich):
//   * mechanika samej szyny - replay dla leniwego hosta, jednorazowość
//     odtworzenia, `null` przy zamknięciu: `src/lib/chat/__tests__/chatBuses.test.ts`,
//   * TABELA mapowania komunikatów serwera na klucze i18n:
//     `src/lib/chat/__tests__/expertRequestErrors.test.ts` (tutaj dowodzimy
//     wyłącznie, że dialog i skrzynka te komunikaty WYŚWIETLAJĄ),
//   * wycofanie zapytania przez nadawcę i skrzynka „Wysłane":
//     `expertRequestCancel.test.tsx` oraz `expertRequestList.test.tsx`,
//   * autoryzacja, granica tenanta i pula - mieszkają w SECURITY DEFINER RPC,
//     a ukryty przycisk nie jest zabezpieczeniem i ten plik tego nie twierdzi.
//
// RODO: wszystkie osoby, tematy i treści są zmyślone, linki wskazują wyłącznie
// na `example.org`, identyfikatory pochodzą z `CHAT_IDS`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { CHAT_IDS, type RecordedRpc, type SupabaseRpcStub } from "@/test/chat/fixtures";
import type { Database } from "@/integrations/supabase/types";
import type { ExpertRequestQuota } from "@/lib/chat/useExpertRequests";

type ExpertRequestRow = Database["public"]["Tables"]["expert_inmails"]["Row"];

// UWAGA: fabryka `vi.hoisted` biegnie PRZED importami pliku, więc nie wolno
// jej czytać `CHAT_IDS` - tożsamość ustawia `beforeEach`.
const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  tenantId: null as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// Atrapa RPC powstaje WEWNĄTRZ fabryki `vi.mock` (jest hoistowana ponad
// importy), a uchwyt do niej wraca tędy. Typ jest importowany zwykłym
// `import type`, więc nie ma tu żadnego rzutowania.
const stubs = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const rpc = fixtures.supabaseRpcStub();
  stubs.rpc = rpc;
  return { supabase: { rpc: rpc.rpc } };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, tenantId: h.tenantId }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => h.toastSuccess(...args),
    error: (...args: unknown[]) => h.toastError(...args),
  },
}));

// Dialog linkuje do cennika przez <Link> TanStacka, a ten wymaga żywego
// routera. Test bada formularz, nie routing.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Nakładka i18n rejestruje się efektem ubocznym importu. ExpertRequestDialog
// (w odróżnieniu od hosta i skrzynki) NIE woła `ensureI18n` sam, więc plik
// testu musi wciągnąć słownik, zanim cokolwiek wyrenderuje.
import "@/lib/i18n-expert-request";
import { expertRequestPl } from "@/lib/i18n-expert-request";
import { ExpertRequestDialog, type ExpertRequestDialogProps } from "../ExpertRequestDialog";
import { ExpertRequestDialogHost } from "../ExpertRequestDialogHost";
import { ExpertRequestsInbox } from "../ExpertRequestsInbox";
import {
  closeExpertRequestDialog,
  openExpertRequestDialog,
  subscribeExpertRequestDialog,
  type ExpertRequestPrefill,
} from "@/lib/chat/expertRequestDialogBus";

const T = expertRequestPl.expertRequest;

/** Podstawia `{{zmienne}}` w napisie ze słownika - bez wpisywania tłumaczeń. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) =>
    key in vars ? String(vars[key]) : _match,
  );
}

function rpc(): SupabaseRpcStub {
  const stub = stubs.rpc;
  if (!stub) throw new Error("test: atrapa RPC nie została utworzona przez fabrykę vi.mock");
  return stub;
}

function quotaOf(overrides: Partial<ExpertRequestQuota> = {}): ExpertRequestQuota {
  return { quota: 5, used: 1, remaining: 4, unlimited: false, direct: false, ...overrides };
}

function prefillOf(overrides: Partial<ExpertRequestPrefill> = {}): ExpertRequestPrefill {
  return {
    recipientId: CHAT_IDS.peer,
    recipientName: "Zofia Testowa",
    recipientAvatar: null,
    subject: "Pakiet energetyczny 2030",
    ...overrides,
  };
}

/**
 * Wiersz skrzynki w PEŁNYM kształcie wiersza bazy - bez rzutowania. Brakująca
 * kolumna ma być błędem typów TUTAJ, przy zmianie migracji, a nie cichym
 * `undefined` w renderze.
 */
function requestRow(overrides: Partial<ExpertRequestRow> = {}): ExpertRequestRow {
  return {
    id: "req-1",
    tenant_id: CHAT_IDS.tenant,
    sender_id: CHAT_IDS.peer,
    recipient_id: CHAT_IDS.me,
    subject: "Konsultacja regulacyjna",
    reason: "Prośba o rozmowę o skutkach projektu rozporządzenia dla sektora.",
    questions: [],
    expected_answers: null,
    external_links: [],
    status: "pending",
    admin_note: null,
    decline_reason: null,
    responded_at: null,
    converted_conversation_id: null,
    created_at: "2026-08-30T10:00:00.000Z",
    updated_at: "2026-08-30T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  h.user = { id: CHAT_IDS.me };
  h.tenantId = CHAT_IDS.tenant;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  rpc().reset();
  rpc().setData("my_inmail_quota", quotaOf());
  rpc().setData("send_expert_inmail", "req-nowe");
  rpc().setData("list_my_inmails", []);
  rpc().setData("resolve_expert_inmail", { status: "approved" });
  // Szyna trzyma stan modułowy (zaległy prefill do odtworzenia), więc każdy
  // test zaczyna od czystej karty.
  const off = subscribeExpertRequestDialog(() => {});
  off();
  closeExpertRequestDialog();
});

afterEach(() => cleanup());

// --- dialog: pomocnicy DOM -------------------------------------------------

function dialogProps(overrides: Partial<ExpertRequestDialogProps> = {}): ExpertRequestDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    prefill: prefillOf(),
    ...overrides,
  };
}

function renderDialog(overrides: Partial<ExpertRequestDialogProps> = {}) {
  const props = dialogProps(overrides);
  const view = renderWithQueryClient(<ExpertRequestDialog {...props} />);
  /** Podmiana propsów BEZ gubienia klienta zapytań (a więc i cache puli). */
  const rerenderWith = (next: Partial<ExpertRequestDialogProps>) =>
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <ExpertRequestDialog {...{ ...props, ...next }} />
      </QueryClientProvider>,
    );
  return { ...view, props, rerenderWith };
}

function subjectField(): HTMLInputElement {
  const el = screen.getByLabelText(T.fields.subject);
  if (!(el instanceof HTMLInputElement)) throw new Error("test: pole tematu nie jest inputem");
  return el;
}

function reasonField(): HTMLTextAreaElement {
  const el = screen.getByLabelText(T.fields.reason);
  if (!(el instanceof HTMLTextAreaElement)) {
    throw new Error("test: pole uzasadnienia nie jest polem tekstowym");
  }
  return el;
}

function questionField(n: number): HTMLElement {
  return screen.getByLabelText(fill(T.fields.questionPlaceholder, { n }));
}

function type(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: T.submit });
}

/**
 * Sam formularz - dialog żyje w portalu, więc szukamy go w całym dokumencie.
 *
 * Potrzebny tam, gdzie dowodzimy DRUGIEJ bramki (schemat zod). Pola mają
 * `maxLength` i `type="url"`, więc PIERWSZĄ bramką jest walidacja natywna
 * przeglądarki: klik w „Wyślij" przy złej wartości nie wypuszcza nawet
 * zdarzenia `submit`. Zdarzenie wysłane wprost odtwarza sytuację, w której
 * wartość przechodzi obok tamtej bramki (wklejenie z autouzupełnienia,
 * `novalidate`, rozjazd implementacji) - i wtedy o zużyciu puli decyduje już
 * wyłącznie schemat.
 */
function formElement(): HTMLFormElement {
  const form = document.querySelector("form");
  if (!form) throw new Error("test: dialog nie renderuje formularza");
  return form;
}

/** Minimum, które przepuszcza bramka `canSubmit` (temat z prefillu + powód). */
const POWOD = "Chcielibyśmy poznać stanowisko wobec projektu rozporządzenia.";

function lastSendCall(): RecordedRpc {
  const call = rpc().lastCall("send_expert_inmail");
  if (!call) throw new Error("test: dialog nie wywołał send_expert_inmail");
  return call;
}

describe("ExpertRequestDialog - otwarcie z szyny", () => {
  it("prefill wypełnia temat i nazywa odbiorcę, a uzasadnienie zostaje puste", async () => {
    renderDialog();

    expect(screen.getByText(T.dialogTitle)).toBeInTheDocument();
    expect(screen.getByText(T.dialogSubtitle)).toBeInTheDocument();
    expect(screen.getByText(T.recipientLabel)).toBeInTheDocument();
    expect(screen.getByText("Zofia Testowa")).toBeInTheDocument();
    // Bez zdjęcia odbiorca ma inicjały, nie pustą plamę.
    expect(screen.getByText("ZT")).toBeInTheDocument();
    await waitFor(() => expect(subjectField().value).toBe("Pakiet energetyczny 2030"));
    // Uzasadnienie jest ŚWIADOMIE puste: szyna niesie tylko temat, a serwer
    // wymaga 20 znaków kontekstu - użytkownik musi je napisać sam.
    expect(reasonField().value).toBe("");
  });

  it("odbiorca bez nazwy nie renderuje pustki ani „undefined”", () => {
    renderDialog({ prefill: prefillOf({ recipientName: null, subject: "" }) });

    expect(screen.getByText(T.recipientLabel)).toBeInTheDocument();
    // Kreska i znak zapytania to jedyne dozwolone zastępniki - katalog
    // ekspertów potrafi oddać rekord bez wypełnionego imienia.
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(subjectField().value).toBe("");
  });

  it("zamknięty dialog nie renderuje formularza (nie da się wysłać zapytania z ukrycia)", () => {
    renderDialog({ open: false });
    expect(screen.queryByText(T.dialogTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: T.submit })).not.toBeInTheDocument();
  });

  it("ZMIANA ODBIORCY czyści treść pisaną dla poprzedniego eksperta", async () => {
    const { rerenderWith } = renderDialog();
    type(reasonField(), "Treść przeznaczona dla pierwszego odbiorcy - poufna.");

    rerenderWith({
      prefill: prefillOf({
        recipientId: CHAT_IDS.peerTwo,
        recipientName: "Jan Przykładowy",
        subject: "Rewizja taksonomii",
      }),
    });

    await waitFor(() => expect(subjectField().value).toBe("Rewizja taksonomii"));
    // Bez tego czyszczenia uzasadnienie napisane dla jednej osoby poleciałoby
    // do drugiej - dokładnie tego rodzaju wyciek treści.
    expect(reasonField().value).toBe("");
    expect(screen.getByText("Jan Przykładowy")).toBeInTheDocument();
  });
});

describe("ExpertRequestDialog - bramka wysyłki", () => {
  it("pusty temat blokuje wysyłkę i NIE dotyka RPC", () => {
    renderDialog({ prefill: prefillOf({ subject: "" }) });
    type(reasonField(), POWOD);

    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);
  });

  it("uzasadnienie krótsze niż wymagane blokuje wysyłkę", () => {
    renderDialog();
    type(reasonField(), "Za krótko");

    expect(submitButton()).toBeDisabled();
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);
  });

  it("temat PONAD limit długości kończy się komunikatem, nie zużytą pulą", async () => {
    renderDialog();
    type(subjectField(), "x".repeat(200));
    type(reasonField(), POWOD);

    // Bramka pierwsza (`maxLength` na polu): klik nie wypuszcza formularza.
    fireEvent.click(submitButton());
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);

    // Bramka druga (schemat): nazywa problem zamiast milczeć.
    fireEvent.submit(formElement());

    expect(await screen.findByText(T.validation.subject)).toBeInTheDocument();
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);
  });

  it("pytanie krótsze niż wymagane zatrzymuje całą wysyłkę", async () => {
    renderDialog();
    type(reasonField(), POWOD);
    type(questionField(1), "Ok");

    fireEvent.click(submitButton());

    expect(await screen.findByText(T.validation.question)).toBeInTheDocument();
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);
  });

  it("link bez schematu http(s) zatrzymuje wysyłkę", async () => {
    renderDialog();
    type(reasonField(), POWOD);
    fireEvent.click(screen.getByRole("button", { name: T.fields.addLink }));
    type(screen.getAllByLabelText(T.fields.linkPlaceholder)[0], "example.org/analiza");

    // Bramka pierwsza (`type="url"`): klik nie wypuszcza formularza.
    fireEvent.click(submitButton());
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);

    // Bramka druga (schemat): odsyłacz bez `http(s)://` nie trafia do bazy
    // jako tekst udający link.
    fireEvent.submit(formElement());

    expect(await screen.findByText(T.validation.link)).toBeInTheDocument();
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);
  });
});

describe("ExpertRequestDialog - kontrakt wywołania send_expert_inmail", () => {
  it("wysyłka niesie KOMPLET argumentów, przycięte napisy i tylko wypełnione pytania", async () => {
    const { props } = renderDialog();
    type(subjectField(), "   Pakiet energetyczny 2030   ");
    type(reasonField(), `  ${POWOD}  `);
    type(questionField(1), "Jaki jest harmonogram prac nad projektem?");
    fireEvent.click(screen.getByRole("button", { name: T.fields.addQuestion }));
    // Drugie pytanie zostaje PUSTE - pusty wiersz formularza nie jest pytaniem.
    type(screen.getByLabelText(T.fields.expectedAnswers), "Krótka lista rekomendacji.");
    fireEvent.click(screen.getByRole("button", { name: T.fields.addLink }));
    type(screen.getAllByLabelText(T.fields.linkPlaceholder)[0], "https://example.org/analiza");

    fireEvent.click(submitButton());

    await waitFor(() => expect(rpc().callsFor("send_expert_inmail")).toHaveLength(1));
    expect(lastSendCall().args).toEqual({
      p_recipient_id: CHAT_IDS.peer,
      p_subject: "Pakiet energetyczny 2030",
      p_reason: POWOD,
      p_questions: ["Jaki jest harmonogram prac nad projektem?"],
      p_external_links: ["https://example.org/analiza"],
      p_expected_answers: "Krótka lista rekomendacji.",
    });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(T.sentToast));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("nieużyte pola opcjonalne NIE jadą do serwera jako puste napisy", async () => {
    renderDialog();
    type(reasonField(), POWOD);

    fireEvent.click(submitButton());

    await waitFor(() => expect(rpc().callsFor("send_expert_inmail")).toHaveLength(1));
    const call = lastSendCall();
    expect(call.arg("p_questions")).toEqual([]);
    expect(call.arg("p_external_links")).toEqual([]);
    // Serwerowy DEFAULT to co innego niż przekazany pusty napis - dlatego
    // klucza ma NIE BYĆ, a nie być z wartością `""`.
    expect(call.has("p_expected_answers")).toBe(false);
  });

  it("zamknięcie przyciskiem Anuluj nie wysyła niczego", () => {
    const { props } = renderDialog();
    type(reasonField(), POWOD);

    fireEvent.click(screen.getByRole("button", { name: T.cancel }));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(rpc().callsFor("send_expert_inmail")).toHaveLength(0);
  });
});

describe("ExpertRequestDialog - werdykt serwera trafia do użytkownika", () => {
  const WERDYKTY: ReadonlyArray<{ label: string; message: string; expected: string }> = [
    {
      label: "odbiorca wstrzymał zapytania",
      message: "expert_request: recipient not accepting requests",
      expected: T.error.recipientDisabled,
    },
    {
      label: "wyczerpana pula miesięczna",
      message: "inmail: monthly quota exceeded",
      expected: T.error.monthlyQuota,
    },
    {
      label: "moduł wyłączony w organizacji",
      message: "expert_request: feature disabled",
      expected: T.error.featureDisabled,
    },
    {
      label: "odmowa nierozpoznana",
      message: "coś poszło nie tak po stronie bazy",
      expected: T.error.generic,
    },
  ];

  it.each(WERDYKTY)(
    "$label - dialog POKAZUJE właściwy komunikat",
    async ({ message, expected }) => {
      rpc().setError("send_expert_inmail", message);
      const { props } = renderDialog();
      type(reasonField(), POWOD);

      fireEvent.click(submitButton());

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expected));
      // Odmowa NIE zamyka dialogu - użytkownik ma poprawić i spróbować dalej,
      // a nie odzyskiwać przepisaną treść z pamięci.
      expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
      expect(h.toastSuccess).not.toHaveBeenCalled();
    },
  );
});

describe("ExpertRequestDialog - miesięczna pula", () => {
  interface PrzypadekPuli {
    label: string;
    quota: ExpertRequestQuota;
    banner: string;
    /** Czy pod banerem stoi ostrzeżenie „wycofanie nie zwraca puli". */
    limited: boolean;
    canSend: boolean;
  }

  const PULE: ReadonlyArray<PrzypadekPuli> = [
    {
      label: "pula częściowo wykorzystana",
      quota: quotaOf({ quota: 5, used: 1, remaining: 4 }),
      banner: fill(T.quota.remaining, { remaining: 4, quota: 5 }),
      limited: true,
      canSend: true,
    },
    {
      label: "pula wyczerpana",
      quota: quotaOf({ quota: 3, used: 3, remaining: 0 }),
      banner: fill(T.quota.exhausted, { quota: 3 }),
      limited: true,
      canSend: false,
    },
    {
      label: "plan bez zapytań",
      quota: quotaOf({ quota: 0, used: 0, remaining: 0 }),
      banner: T.quota.none,
      limited: false,
      canSend: false,
    },
    {
      label: "plan z bezpośrednią rozmową",
      quota: quotaOf({ quota: 0, used: 0, remaining: 0, unlimited: true, direct: true }),
      banner: T.quota.direct,
      limited: false,
      canSend: true,
    },
  ];

  it.each(PULE)(
    "$label - baner i dostępność wysyłki",
    async ({ quota, banner, limited, canSend }) => {
      rpc().setData("my_inmail_quota", quota);
      renderDialog();
      type(reasonField(), POWOD);

      const status = await screen.findByRole("status");
      expect(status.textContent ?? "").toContain(banner);
      // Cena kliknięcia: wycofanie NIE zwraca puli. Zdanie stoi tam, gdzie
      // decyzja zapada - przed wysyłką, nie dopiero przy anulowaniu.
      expect((status.textContent ?? "").includes(T.quota.cancelledCounts)).toBe(limited);
      await waitFor(() =>
        canSend ? expect(submitButton()).toBeEnabled() : expect(submitButton()).toBeDisabled(),
      );
    },
  );
});

describe("ExpertRequestDialog - pytania i linki", () => {
  it("pytania dokładają się do piątki, a potem przycisk znika", () => {
    renderDialog();
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: T.fields.addQuestion }));
    }
    expect(questionField(5)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: T.fields.addQuestion })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: T.fields.removeQuestion })[0]);

    expect(screen.queryByLabelText(fill(T.fields.questionPlaceholder, { n: 5 }))).toBeNull();
    expect(screen.getByRole("button", { name: T.fields.addQuestion })).toBeInTheDocument();
  });

  it("jedyne pytanie nie ma kosza, a linki kończą się na trzech", () => {
    renderDialog();
    // Ostatniego pytania nie da się usunąć - formularz zawsze pokazuje jedno.
    expect(screen.queryByRole("button", { name: T.fields.removeQuestion })).not.toBeInTheDocument();

    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: T.fields.addLink }));
    }
    expect(screen.getAllByLabelText(T.fields.linkPlaceholder)).toHaveLength(3);
    expect(screen.queryByRole("button", { name: T.fields.addLink })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: T.fields.removeLink })[0]);
    expect(screen.getAllByLabelText(T.fields.linkPlaceholder)).toHaveLength(2);
  });
});

describe("ExpertRequestDialogHost", () => {
  it("bez żądania z szyny nie renderuje nic widocznego", () => {
    renderWithQueryClient(<ExpertRequestDialogHost />);
    expect(screen.queryByText(T.dialogTitle)).not.toBeInTheDocument();
  });

  it("żądanie z szyny otwiera dialog z prefillem odbiorcy", async () => {
    renderWithQueryClient(<ExpertRequestDialogHost />);

    act(() => {
      openExpertRequestDialog(prefillOf({ subject: "Rewizja taksonomii" }));
    });

    expect(await screen.findByText(T.dialogTitle)).toBeInTheDocument();
    expect(screen.getByText("Zofia Testowa")).toBeInTheDocument();
    await waitFor(() => expect(subjectField().value).toBe("Rewizja taksonomii"));
  });

  it("zamknięcie dialogu przez formularz kasuje żądanie w hoście", async () => {
    renderWithQueryClient(<ExpertRequestDialogHost />);
    act(() => {
      openExpertRequestDialog(prefillOf());
    });
    expect(await screen.findByText(T.dialogTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: T.cancel }));

    await waitFor(() => expect(screen.queryByText(T.dialogTitle)).not.toBeInTheDocument());
  });

  it("zamknięcie z szyny (null) też gasi dialog", async () => {
    renderWithQueryClient(<ExpertRequestDialogHost />);
    act(() => {
      openExpertRequestDialog(prefillOf());
    });
    expect(await screen.findByText(T.dialogTitle)).toBeInTheDocument();

    act(() => {
      closeExpertRequestDialog();
    });

    await waitFor(() => expect(screen.queryByText(T.dialogTitle)).not.toBeInTheDocument());
  });

  it("ODMONTOWANIE hosta zdejmuje subskrypcję szyny", () => {
    const { unmount } = renderWithQueryClient(<ExpertRequestDialogHost />);
    unmount();

    // Gdyby host nie odsubskrybował, emisja trafiłaby do jego (martwego)
    // nasłuchu zamiast zostać zapamiętana do odtworzenia. Odebranie prefillu
    // przez ŚWIEŻEGO subskrybenta jest więc dowodem posprzątania.
    const seen: Array<ExpertRequestPrefill | null> = [];
    openExpertRequestDialog(prefillOf({ subject: "Po odmontowaniu" }));
    const off = subscribeExpertRequestDialog((value) => seen.push(value));

    expect(seen).toEqual([prefillOf({ subject: "Po odmontowaniu" })]);
    off();
  });
});

// --- skrzynka eksperta -----------------------------------------------------

function renderInbox() {
  const onOpenConversation = vi.fn();
  const view = renderWithQueryClient(
    <ExpertRequestsInbox onOpenConversation={onOpenConversation} />,
  );
  return { ...view, onOpenConversation };
}

function lastResolveCall(): RecordedRpc {
  const call = rpc().lastCall("resolve_expert_inmail");
  if (!call) throw new Error("test: skrzynka nie wywołała resolve_expert_inmail");
  return call;
}

describe("ExpertRequestsInbox - stany listy", () => {
  it("dopóki serwer nie odpowie, widać szkielet, a nie fałszywą pustkę", async () => {
    rpc().setData("list_my_inmails", [requestRow()]);
    const { container } = renderInbox();

    // Synchronicznie po renderze zapytanie jeszcze leci - pusty stan w tym
    // momencie kłamałby, że ekspert nie ma zapytań.
    expect(container.querySelector("[aria-busy]")).not.toBeNull();
    expect(screen.queryByText(T.inbox.empty)).not.toBeInTheDocument();

    expect(await screen.findByText("Konsultacja regulacyjna")).toBeInTheDocument();
  });

  it("pusta skrzynka mówi, czego brakuje - nie zostawia pustego prostokąta", async () => {
    renderInbox();
    expect(await screen.findByText(T.inbox.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("czyta WYŁĄCZNIE skrzynkę odbiorcy (`received`)", async () => {
    renderInbox();
    await waitFor(() => expect(rpc().callsFor("list_my_inmails")).toHaveLength(1));
    // `sent` w tym miejscu pokazałby ekspertowi jego własne zapytania do
    // innych i pozwalał „rozstrzygać" cudze.
    expect(rpc().lastCall("list_my_inmails")?.arg("p_box")).toBe("received");
  });

  it("oczekujące idą NA GÓRĘ listy, reszta po dacie malejąco", async () => {
    rpc().setData("list_my_inmails", [
      requestRow({
        id: "req-approved",
        subject: "Zatwierdzone wcześniej",
        status: "approved",
        created_at: "2026-08-31T10:00:00.000Z",
      }),
      requestRow({
        id: "req-pending",
        subject: "Czeka na decyzję",
        status: "pending",
        created_at: "2026-08-20T10:00:00.000Z",
      }),
    ]);
    renderInbox();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    // Decyzja do podjęcia bije świeżość: inaczej najstarsze oczekujące
    // zapytanie ginie pod rozstrzygniętymi.
    expect(items[0].textContent).toContain("Czeka na decyzję");
    expect(items[0].textContent).toContain(T.status.pending);
    expect(items[1].textContent).toContain(T.status.approved);
  });

  it("szczegóły pokazują pytania, oczekiwania i TYLKO poprawne linki", async () => {
    rpc().setData("list_my_inmails", [
      requestRow({
        questions: ["Jak wygląda harmonogram?", "   "],
        expected_answers: "Lista rekomendacji.",
        external_links: ["https://example.org/analiza", "ftp://example.org/plik"],
      }),
    ]);
    renderInbox();

    fireEvent.click(await screen.findByRole("button", { name: T.inbox.more }));

    expect(screen.getByText(T.inbox.questions)).toBeInTheDocument();
    expect(screen.getByText("Jak wygląda harmonogram?")).toBeInTheDocument();
    expect(screen.getByText("Lista rekomendacji.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /example\.org\/analiza/ });
    expect(link).toHaveAttribute("href", "https://example.org/analiza");
    // Cudze linki otwierają się w nowej karcie BEZ dostępu do `window.opener`.
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // Schemat spoza http(s) nie ma prawa dojechać do atrybutu `href`.
    expect(screen.queryByText(/ftp:\/\//)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.inbox.less })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: T.inbox.less }));
    expect(screen.queryByText("Jak wygląda harmonogram?")).not.toBeInTheDocument();
    expect(screen.queryByText("Lista rekomendacji.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.inbox.more })).toBeInTheDocument();
  });
});

describe("ExpertRequestsInbox - decyzje eksperta", () => {
  it("przyjęcie zapytania woła RPC i oddaje ROZMOWĘ utworzoną przez serwer", async () => {
    rpc().setData("list_my_inmails", [requestRow({ id: "req-77" })]);
    rpc().setData("resolve_expert_inmail", {
      status: "approved",
      conversation_id: CHAT_IDS.conversation,
    });
    const { onOpenConversation } = renderInbox();

    fireEvent.click(await screen.findByRole("button", { name: T.inbox.reply }));

    await waitFor(() => expect(rpc().callsFor("resolve_expert_inmail")).toHaveLength(1));
    expect(lastResolveCall().args).toEqual({ p_inmail_id: "req-77", p_action: "approve" });
    await waitFor(() => expect(onOpenConversation).toHaveBeenCalledWith(CHAT_IDS.conversation));
    expect(h.toastSuccess).toHaveBeenCalledWith(T.inbox.openedToast);
  });

  it("gdy serwer nie odda id rozmowy, skrzynka sięga po rozmowę zapisaną w wierszu", async () => {
    rpc().setData("list_my_inmails", [
      requestRow({ id: "req-78", converted_conversation_id: CHAT_IDS.otherConversation }),
    ]);
    rpc().setData("resolve_expert_inmail", { status: "approved" });
    const { onOpenConversation } = renderInbox();

    fireEvent.click(await screen.findByRole("button", { name: T.inbox.reply }));

    await waitFor(() =>
      expect(onOpenConversation).toHaveBeenCalledWith(CHAT_IDS.otherConversation),
    );
  });

  it("odrzucenie woła akcję `decline` i NIE otwiera żadnej rozmowy", async () => {
    rpc().setData("list_my_inmails", [requestRow({ id: "req-79" })]);
    rpc().setData("resolve_expert_inmail", { status: "declined" });
    const { onOpenConversation } = renderInbox();

    fireEvent.click(await screen.findByRole("button", { name: T.actions.decline }));

    await waitFor(() => expect(rpc().callsFor("resolve_expert_inmail")).toHaveLength(1));
    expect(lastResolveCall().args).toEqual({ p_inmail_id: "req-79", p_action: "decline" });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(T.status.declined));
    // Odrzucenie kończy sprawę - żadnej rozmowy z tego nie ma.
    expect(onOpenConversation).not.toHaveBeenCalled();
  });

  it("ODMOWA SERWERA nie udaje sukcesu - komunikat idzie z mapowania werdyktów", async () => {
    rpc().setData("list_my_inmails", [requestRow()]);
    rpc().setError("resolve_expert_inmail", "expert_request: invalid status transition");
    const { onOpenConversation } = renderInbox();

    fireEvent.click(await screen.findByRole("button", { name: T.inbox.reply }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(T.error.invalidTransition));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(onOpenConversation).not.toHaveBeenCalled();
  });

  it("wiersz ROZSTRZYGNIĘTY nie daje decyzji, tylko wejście do rozmowy - bez RPC", async () => {
    rpc().setData("list_my_inmails", [
      requestRow({
        status: "approved",
        converted_conversation_id: CHAT_IDS.conversation,
      }),
    ]);
    const { onOpenConversation } = renderInbox();

    const item = await screen.findByRole("listitem");
    expect(within(item).queryByRole("button", { name: T.actions.decline })).not.toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: T.inbox.reply })).not.toBeInTheDocument();

    fireEvent.click(within(item).getByRole("button", { name: T.actions.openConversation }));

    expect(onOpenConversation).toHaveBeenCalledWith(CHAT_IDS.conversation);
    // Otwarcie istniejącej rozmowy to nawigacja, nie kolejna zmiana statusu.
    expect(rpc().callsFor("resolve_expert_inmail")).toHaveLength(0);
  });

  it("wiersz odrzucony BEZ rozmowy nie oferuje żadnej akcji", async () => {
    rpc().setData("list_my_inmails", [requestRow({ status: "declined" })]);
    renderInbox();

    const item = await screen.findByRole("listitem");
    expect(within(item).getByText(T.status.declined)).toBeInTheDocument();
    expect(
      within(item).queryByRole("button", { name: T.actions.openConversation }),
    ).not.toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: T.inbox.reply })).not.toBeInTheDocument();
  });
});
