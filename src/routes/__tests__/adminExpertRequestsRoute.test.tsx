// Trasa `/admin/expert-requests` ZAMONTOWANA - przegląd i rozstrzyganie
// „Zapytań do eksperta" obszaru roboczego. Do dziś: 0 z 17 linii, martwe
// `AdminExpertRequests` i `act` - żaden test nie montował tej trasy.
//
// SZEŚĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NAGŁÓWKI KOLUMN NAZYWAJĄ KOLUMNY. Kolumna statusu była podpisana
//      `t("expertRequest.status.pending")` - czyli „Oczekuje"/„Pending", nazwą
//      JEDNEGO ze statusów, nad wierszami „Zatwierdzone" i „Odrzucone".
//      Kolumna akcji miała twardy napis „-" (czytnik ekranu: „minus").
//      NAPRAWIONE: status bierze istniejącą etykietę wymiaru
//      `expertRequest.admin.filter` („Status" - ta sama, co nad filtrem),
//      akcje - nowy klucz `expertRequest.admin.columnActions` (PL i EN).
//   2. FILTR STARTUJE OD OCZEKUJĄCYCH, „WSZYSTKIE" NIE ZAWĘŻA. Panel jest
//      kolejką pracy; „wszystkie" wysłane jako `p_status: "all"` dałoby pustą
//      listę (takiego statusu nie ma), a nie pełną.
//   3. AKCJA IDZIE DO RPC Z WŁAŚCIWĄ NAZWĄ I ID WIERSZA. `approve` otwiera
//      bezpośrednią konwersację, `decline` kończy zapytanie - zamiana to
//      rozmowa otwarta z kimś, komu odmówiono.
//   4. TOAST SUKCESU MÓWI STATUSEM, NIE NAZWĄ AKCJI. Zapas na brak `status`
//      w odpowiedzi brał goły `action` - `expertRequest.status.approve` nie
//      istnieje w słowniku, więc toast pokazywał surowy klucz. NAPRAWIONE
//      mapą akcja -> status docelowy.
//   5. ODMOWA SERWERA TO KLUCZ Z `expertRequestErrorI18nKey`, nie surowy
//      komunikat Postgresa (z nazwami funkcji i tabel).
//   6. ROZSTRZYGANIE W LOCIE BLOKUJE PRZYCISKI. Drugi klik w „Otwórz rozmowę"
//      wysyłał drugie RPC, które padało na „invalid status transition" - toast
//      błędu tuż po toaście sukcesu. NAPRAWIONE (`disabled` na czas mutacji).
//
// Oraz dostępność filtra: `<label>` nie był powiązany z listą wyboru, więc
// lista nie miała dostępnej nazwy. NAPRAWIONE (`htmlFor` + `id` z `useId`).
//
// TYTUŁ W `head()` JEST TWARDY PO POLSKU - i tak zostaje: to konwencja
// tras panelu (ponad sto plików `admin.*.tsx` ma literał w `head()`), a panel
// i tak jest `noindex`. Przypinamy tylko `noindex, nofollow`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - KSZTAŁTU ARGUMENTÓW RPC W HAKACH (`p_limit`, `p_offset`, `p_note`):
//   `src/lib/chat/__tests__/chatPrivacyHooks.test.tsx`. Tu haki biegną
//   PRAWDZIWE (atrapowany jest tylko `supabase.rpc`), więc dowodzimy tego, co
//   panel do nich wkłada.
// - TABELI DOPASOWAŃ BŁĘDÓW: `src/lib/chat/__tests__/expertRequestErrors.test.ts`.
// - AUTORYZACJI: rozstrzyga `resolve_expert_request` (SECURITY DEFINER,
//   odbiorca albo superadmin), a wejście do panelu - layout `/admin`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  /** Atrapa `supabase.rpc`; wstrzykiwana z fabryki `vi.mock`. */
  rpc: null as SupabaseRpcStub | null,
  /** Wiersze `expert_inmails` oddawane przez listę panelu. */
  rows: [] as Record<string, unknown>[],
  /** Czy rozstrzygnięcie ma WISIEĆ (dowód blokady przycisków). */
  hangResolve: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Haki zapytań eksperta importują `useAuth` dla skrzynek użytkownika; panel
// admina z niego nie korzysta, więc atrapa jest pusta z założenia.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const stub = supabaseRpcStub();
  h.rpc = stub;
  /** Wiszące rozstrzygnięcie: wywołanie JEST zapisane, odpowiedź nie wraca. */
  const rpc = (name: string, args?: Record<string, unknown>) => {
    const answer = stub.rpc(name, args);
    if (h.hangResolve && name === "resolve_expert_inmail") return new Promise(() => {});
    return answer;
  };
  return { supabase: { rpc } };
});
// Radix Select nie otwiera listy pod happy-dom - podmiana na natywny `<select>`.
// Przedmiotem dowodu jest wartość filtra, która trafia do RPC.
vi.mock("@/components/ui/select", async () => {
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(await import("react"));
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { expertRequestErrorI18nKey } from "@/lib/chat/expertRequestErrors";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as AdminExpertRequestsRoute } from "@/routes/admin.expert-requests";

const PATH = "/admin/expert-requests";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000a1";

/** Wiersz zapytania. Tematy i uzasadnienia WYMYŚLONE (RODO w fixtures). */
function request(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REQUEST_ID,
    subject: "Sankcje wtórne a handel z Azją Centralną",
    reason: "Przygotowuję analizę dla zespołu regionalnego.",
    status: "pending",
    ...patch,
  };
}

function rpc(): SupabaseRpcStub {
  if (!h.rpc) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

const listCalls = () => rpc().callsFor("admin_list_inmails");
const resolveCalls = () => rpc().callsFor("resolve_expert_inmail");

/** Plan odpowiedzi rozstrzygnięcia: dane albo odmowa serwera. */
function planResolve(answer: { data: unknown } | { error: string }) {
  if ("error" in answer) rpc().setError("resolve_expert_inmail", answer.error);
  else rpc().setData("resolve_expert_inmail", answer.data);
}

async function mount() {
  const view = await renderRoute({
    route: AdminExpertRequestsRoute,
    path: PATH,
    initialEntry: PATH,
  });
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  return view;
}

/** Wiersz tabeli po temacie - z twardym błędem zamiast cichego `null`. */
function rowOf(subject: string): HTMLElement {
  const row = screen.getByText(subject).closest("tr");
  if (!(row instanceof HTMLElement)) throw new Error(`test: brak wiersza "${subject}"`);
  return row;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("pl");
  rpc().reset();
  h.rows = [request()];
  h.hangResolve = false;
  rpc().setResponse("admin_list_inmails", () => ({ data: h.rows, error: null }));
  planResolve({ data: { status: "approved", conversation_id: "c1" } });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("admin.expert-requests - tabela", () => {
  it("nagłówek kolumny statusu to „Status”, a kolumna akcji ma nazwę zamiast dywizu", async () => {
    // REGUŁA 1 (regresja). Przed naprawą: „Temat rozmowy | Oczekuje | -".
    await mount();
    await screen.findByText("Sankcje wtórne a handel z Azją Centralną");

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Temat rozmowy", "Status", "Akcje"]);
  });

  it("po angielsku nagłówki też są angielskie", async () => {
    await i18n.changeLanguage("en");
    await mount();
    await screen.findByText("Sankcje wtórne a handel z Azją Centralną");

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Subject", "Status", "Actions"]);
  });

  it("przyciski rozstrzygnięcia są TYLKO przy oczekujących zapytaniach", async () => {
    // Zapytanie zatwierdzone ma już konwersację - „Odrzuć" przy nim byłby
    // obietnicą przejścia, które serwer odrzuci jako niedozwolone.
    h.rows = [
      request(),
      request({ id: "r2", subject: "Taryfy CBAM w praktyce", status: "approved" }),
    ];
    await mount();
    await screen.findByText("Taryfy CBAM w praktyce");

    expect(within(rowOf("Taryfy CBAM w praktyce")).queryAllByRole("button")).toEqual([]);
    expect(within(rowOf("Taryfy CBAM w praktyce")).getByText("Zatwierdzone")).toBeVisible();
    expect(
      within(rowOf("Sankcje wtórne a handel z Azją Centralną")).getAllByRole("button"),
    ).toHaveLength(2);
  });

  it("pusta lista mówi o pustce, a licznik pokazuje zero", async () => {
    h.rows = [];
    await mount();

    expect(await screen.findByText("Brak wiadomości w tej skrzynce.")).toBeInTheDocument();
    expect(screen.getByText("Łącznie: 0")).toBeInTheDocument();
  });

  it("licznik liczy wiersze, które oddał serwer", async () => {
    h.rows = [request(), request({ id: "r2", subject: "Taryfy CBAM w praktyce" })];
    await mount();

    expect(await screen.findByText("Łącznie: 2")).toBeInTheDocument();
  });
});

describe("admin.expert-requests - filtr statusu", () => {
  it("startuje od oczekujących: pierwsze RPC niesie `p_status: pending`", async () => {
    // REGUŁA 2. Panel jest kolejką pracy - start od wszystkich chowałby
    // oczekujące między setkami rozstrzygniętych.
    await mount();

    expect(listCalls()[0].arg("p_status")).toBe("pending");
  });

  it("„Wszystkie” pyta BEZ `p_status`, a nie o status o nazwie „all”", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(1));
    expect(listCalls().at(-1)?.has("p_status")).toBe(false);
  });

  it("wybór konkretnego statusu zawęża RPC do niego", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "declined" } });

    await waitFor(() => expect(listCalls().at(-1)?.arg("p_status")).toBe("declined"));
  });

  it("lista wyboru ma dostępną nazwę z etykiety i komplet statusów", async () => {
    // Bez powiązania `<label for>` lista była dla czytnika ekranu bezimienna
    // (`getByLabelText` nie znajdował jej wcale).
    await mount();
    const filter = screen.getByLabelText("Status");

    const options = [...filter.querySelectorAll("option")].map((option) => option.value);
    expect(options).toEqual(["all", "pending", "approved", "declined", "answered", "cancelled"]);
  });
});

describe("admin.expert-requests - rozstrzyganie", () => {
  const approve = () => screen.getByRole("button", { name: "Otwórz rozmowę" });
  const decline = () => screen.getByRole("button", { name: "Odrzuć" });

  it("akceptacja woła RPC z `approve` i id wiersza, a toast mówi statusem z odpowiedzi", async () => {
    // REGUŁA 3.
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Otwórz rozmowę" }));

    await waitFor(() => expect(resolveCalls()).toHaveLength(1));
    expect(resolveCalls()[0].args).toEqual({ p_inmail_id: REQUEST_ID, p_action: "approve" });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Zatwierdzone"));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("odrzucenie woła RPC z `decline`", async () => {
    planResolve({ data: { status: "declined" } });
    await mount();
    await screen.findByText("Sankcje wtórne a handel z Azją Centralną");
    fireEvent.click(decline());

    await waitFor(() => expect(resolveCalls()).toHaveLength(1));
    expect(resolveCalls()[0].arg("p_action")).toBe("decline");
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Odrzucone"));
  });

  it.each([
    ["approve", "Otwórz rozmowę", "Zatwierdzone"],
    ["decline", "Odrzuć", "Odrzucone"],
  ])(
    "odpowiedź BEZ statusu po „%s” daje toast statusu docelowego, nie surowy klucz",
    async (_action, buttonName, expected) => {
      // REGUŁA 4 (regresja). Przed naprawą zapas brał nazwę akcji i toast
      // pokazywał „expertRequest.status.approve" - klucz, którego nie ma.
      planResolve({ data: null });
      await mount();
      fireEvent.click(await screen.findByRole("button", { name: buttonName }));

      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(expected));
      const shown = String(h.toastSuccess.mock.calls[0]?.[0]);
      expect(shown).not.toContain("expertRequest.");
    },
  );

  it.each([
    ["expert_request: invalid status transition"],
    ["expert_request: forbidden"],
    ["connection reset by peer"],
  ])("odmowa „%s” → toast z klucza expertRequestErrorI18nKey", async (message) => {
    // REGUŁA 5. Surowy komunikat Postgresa niesie nazwy funkcji i tabel;
    // klucz mówi administratorowi, co zrobić (np. „odśwież listę").
    planResolve({ error: message });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Otwórz rozmowę" }));

    const expected = i18n.t(expertRequestErrorI18nKey(new Error(message)));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expected));
    expect(expected).not.toContain(message);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie rozstrzygania oba przyciski są zablokowane - drugi klik nie woła RPC", async () => {
    // REGUŁA 6 (regresja). Drugie RPC na tym samym wierszu kończyło się
    // „invalid status transition" - toastem błędu po toaście sukcesu.
    h.hangResolve = true;
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Otwórz rozmowę" }));

    await waitFor(() => expect(approve()).toBeDisabled());
    expect(decline()).toBeDisabled();
    fireEvent.click(approve());
    fireEvent.click(decline());
    expect(resolveCalls()).toHaveLength(1);
  });

  it("udane rozstrzygnięcie przeładowuje listę - wiersz traci przyciski", async () => {
    // Bez odświeżenia rozstrzygnięte zapytanie wisiałoby w kolejce
    // oczekujących z aktywnymi przyciskami.
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Otwórz rozmowę" }));
    const before = listCalls().length;
    h.rows = [];

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
    expect(await screen.findByText("Brak wiadomości w tej skrzynce.")).toBeInTheDocument();
  });
});

describe("admin.expert-requests - nagłówek dokumentu", () => {
  it("panel z korespondencją użytkowników jest `noindex, nofollow`", async () => {
    const meta = await routeMeta(AdminExpertRequestsRoute);

    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});
