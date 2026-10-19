// Sekcja „Popup rejestracji" w Admin → Popupy: edytor + własny zapis.
//
// PO CO. Ten popup ZAKŁADA REALNE KONTO, więc jego treść i pola to nie
// dekoracja. Zapis jest ręczny, a jedyną ochroną pracy operatora jest znacznik
// „niezapisane zmiany" - pomyłki są ciche:
//   * szkic nadpisany świeżym odczytem z bazy w trakcie edycji to utrata
//     wpisanej treści bez żadnego sygnału;
//   * znacznik zgaszony po NIEUDANYM zapisie to operator wychodzący z panelu w
//     przekonaniu, że zapisał;
//   * „przywróć domyślne" bez oznaczenia zmiany to reset, którego nie da się
//     zapisać.
//
// ZAPIS (S1 def. 9). Sekcja NIE robi już UPDATE całym wierszem ustawień
// newslettera - woła RPC `admin_newsletter_settings_patch` z grupą `popup`,
// patchem zmienionych kolumn i tokenem `updated_at`. Asercje zapisu czytają
// argumenty RPC; atrapa serwera robi CAS jak prawdziwa funkcja (stary token
// -> 40001). Zmiana świadoma: dawny zapis całym wierszem cofał zmiany
// przeglądu newslettera zrobione w innej karcie.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseFromStub, ok } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  from: (_t: string): unknown => ({}),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.from(table),
    rpc: (fn: string, args: unknown) => h.rpc(fn, args),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Edytor ma własne testy (sześć zakładek, przemiał po kontrolkach). Tutaj liczy
// się tylko, że sekcja podaje mu bieżący stan i przyjmuje patch.
vi.mock("@/components/admin/popups/signup/SignupPopupEditor", () => ({
  SignupPopupEditor: ({
    value,
    onChange,
  }: {
    value: { popup_title_pl: string };
    onChange: (patch: Record<string, unknown>) => void;
  }) => (
    <div data-testid="edytor">
      <span data-testid="tytul">{value.popup_title_pl}</span>
      <button type="button" onClick={() => onChange({ popup_title_pl: "Nowy tytuł" })}>
        zmien-tytul
      </button>
    </div>
  ),
}));

import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { SignupPopupContentSection } from "@/components/admin/popups/SignupPopupContentSection";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";

const G = (key: string) => i18n.t(`adminPopupSignup.${key}`);

let stub: ReturnType<typeof supabaseFromStub>;

const T0 = "2026-10-19T10:00:00.100001+00:00";
const T1 = "2026-10-19T10:00:05.200002+00:00";
const T2 = "2026-10-19T10:00:09.300003+00:00";

interface PatchArgs {
  p_group: string;
  p_patch: Record<string, unknown>;
  p_expected_updated_at: string | null;
}

/** Atrapa serwera: jeden wiersz z tokenem, RPC z CAS jak w SQL. */
const server = {
  row: null as unknown as NewsletterSettings,
  tokens: [T1, T2],
  /** Wymuszony błąd następnego zapisu (np. awaria bazy). */
  failNext: null as Error | null,
};

function patchCalls(): PatchArgs[] {
  return h.rpc.mock.calls
    .filter(([fn]) => fn === "admin_newsletter_settings_patch")
    .map(([, args]) => args as PatchArgs);
}

function mount(overrides: Partial<NewsletterSettings> = {}) {
  server.row = {
    ...defaultNewsletterSettings(),
    tenant_id: "tenant-1",
    popup_title_pl: "Zapisz się",
    updated_at: T0,
    ...overrides,
  };
  stub.setResponse("newsletter_settings", () => ok(server.row));
  return renderWithQueryClient(<SignupPopupContentSection />);
}

async function mounted(overrides: Partial<NewsletterSettings> = {}) {
  const utils = mount(overrides);
  await waitFor(() => expect(utils.queryClient.getQueryData(["newsletter-settings"])).toBeTruthy());
  await act(async () => {});
  return utils;
}

function saveButton(): HTMLButtonElement {
  return screen.getByText(G("save")).closest("button")!;
}

/** Patch, jaki poszedł do bazy (ostatnie wywołanie RPC). */
function sentPatch(): Record<string, unknown> {
  const calls = patchCalls();
  expect(calls.length, "brak wywołania RPC zapisu").toBeGreaterThan(0);
  return calls[calls.length - 1]!.p_patch;
}

/** Projekt popupu różny od domyślnego (schemat jasny) - reset ma wtedy co zmienić. */
function customDesign() {
  return { ...defaultPopupDesign(), colorScheme: "light" as const };
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  stub = supabaseFromStub();
  h.from = stub.from;
  clearEdgeTtlCache();
  vi.clearAllMocks();
  h.rpc.mockReset();
  server.tokens = [T1, T2];
  server.failNext = null;
  h.rpc.mockImplementation(async (_fn: string, args: PatchArgs) => {
    if (server.failNext) {
      const error = server.failNext;
      server.failNext = null;
      return { data: null, error };
    }
    if (args.p_expected_updated_at !== server.row.updated_at) {
      return { data: null, error: Object.assign(new Error("stale_write"), { code: "40001" }) };
    }
    const token = server.tokens.shift() ?? "2026-10-19T11:00:00.000001+00:00";
    server.row = { ...server.row, ...args.p_patch, updated_at: token };
    return { data: { updated_at: token, changed: Object.keys(args.p_patch).sort() }, error: null };
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("wczytywanie i szkic", () => {
  it("edytor dostaje ustawienia Z BAZY", async () => {
    await mounted({ popup_title_pl: "Dołącz do nas" });

    expect(screen.getByTestId("tytul").textContent).toBe("Dołącz do nas");
    // Nie domyślny tytuł - edytor nie może startować od pustej treści, gdy
    // w bazie coś już jest.
    expect(screen.getByTestId("tytul").textContent).not.toBe("");
  });

  it("dopóki dane nie doszły, edytor pracuje na domyślnych - nie na pustce", async () => {
    // Pusty obiekt wywaliłby edytor na pierwszym odczycie zagnieżdżonego pola.
    mount();

    expect(screen.getByTestId("edytor")).toBeTruthy();
    expect(screen.getByTestId("tytul").textContent).toBe(
      defaultNewsletterSettings().popup_title_pl,
    );
  });

  it("świeży odczyt z bazy NIE nadpisuje szkicu w trakcie edycji", async () => {
    // Inaczej odświeżenie zapytania (inne okno, powrót do karty) wyciera treść
    // wpisaną przed chwilą, bez żadnego sygnału.
    const { queryClient } = await mounted({ popup_title_pl: "Zapisz się" });
    fireEvent.click(screen.getByText("zmien-tytul"));
    expect(screen.getByTestId("tytul").textContent).toBe("Nowy tytuł");

    await act(async () => {
      queryClient.setQueryData(["newsletter-settings"], {
        ...defaultNewsletterSettings(),
        popup_title_pl: "Z innego okna",
      });
    });

    expect(screen.getByTestId("tytul").textContent).toBe("Nowy tytuł");
  });
});

// ---------------------------------------------------------------------------
describe("znacznik niezapisanych zmian", () => {
  it("na starcie znacznika nie ma, a zapis jest ZABLOKOWANY", async () => {
    await mounted();

    expect(screen.queryByText(G("unsaved"))).toBeNull();
    expect(saveButton()).toHaveProperty("disabled", true);
  });

  it("pierwsza zmiana zapala znacznik i odblokowuje zapis", async () => {
    await mounted();

    fireEvent.click(screen.getByText("zmien-tytul"));

    expect(screen.getByText(G("unsaved"))).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("UDANY zapis gasi znacznik", async () => {
    await mounted();
    fireEvent.click(screen.getByText("zmien-tytul"));

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });

    expect(screen.queryByText(G("unsaved"))).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(G("saved"));
  });

  it("NIEUDANY zapis ZOSTAWIA znacznik - inaczej operator wychodzi z panelu bez pracy", async () => {
    server.failNext = new Error("baza padla");
    await mounted();
    fireEvent.click(screen.getByText("zmien-tytul"));

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });

    expect(screen.getByText(G("unsaved"))).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(G("saveError"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("zapis", () => {
  it("wysyła WYŁĄCZNIE zmienioną kolumnę, grupę `popup` i surowy token", async () => {
    // Dawniej szły CAŁE ustawienia newslettera (także nadawca i tryb z
    // chwili otwarcia panelu) - zapis treści popupu cofał zmiany przeglądu.
    await mounted({ popup_title_pl: "Zapisz się" });
    fireEvent.click(screen.getByText("zmien-tytul"));

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });

    expect(patchCalls()).toEqual([
      { p_group: "popup", p_patch: { popup_title_pl: "Nowy tytuł" }, p_expected_updated_at: T0 },
    ]);
    expect(
      stub.chainsFor("newsletter_settings").some((c) => c.has("update") || c.has("insert")),
    ).toBe(false);
  });

  it("bez zmian nie da się kliknąć zapisu, więc nic nie leci do bazy", async () => {
    await mounted();

    fireEvent.click(screen.getByText(G("save")));

    await act(async () => {});
    expect(patchCalls()).toHaveLength(0);
    // Przycisk jest ZABLOKOWANY - to on jest barierą, nie milczenie zapisu.
    expect(screen.getByText(G("save")).closest("button")?.hasAttribute("disabled")).toBe(true);
  });

  it("konflikt z cudzą zmianą INNYCH kolumn scala się sam - obie zmiany w bazie", async () => {
    await mounted();
    fireEvent.click(screen.getByText("zmien-tytul"));
    // Druga karta (przegląd newslettera) zmieniła nadawcę - spoza grupy `popup`.
    server.row = { ...server.row, sender_name: "Redakcja", updated_at: T1 };
    server.tokens = [T2];

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(i18n.t("adminPaywall.sync.merged")),
    );
    expect(patchCalls().map((c) => c.p_expected_updated_at)).toEqual([T0, T1]);
    expect(server.row).toMatchObject({ popup_title_pl: "Nowy tytuł", sender_name: "Redakcja" });
  });

  it("PRAWDZIWY konflikt (ten sam tytuł) - komunikat konfliktu i zachowany szkic", async () => {
    await mounted();
    fireEvent.click(screen.getByText("zmien-tytul"));
    server.row = { ...server.row, popup_title_pl: "Tytuł z drugiej karty", updated_at: T1 };

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        i18n.t("adminPaywall.sync.staleWrite"),
        expect.objectContaining({ action: expect.anything() }),
      ),
    );
    expect(patchCalls()).toHaveLength(1);
    expect(server.row.popup_title_pl).toBe("Tytuł z drugiej karty");
    expect(screen.getByTestId("tytul").textContent).toBe("Nowy tytuł");
    expect(screen.getByText(G("unsaved"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Fikstura startuje z projektem RÓŻNYM od domyślnego: znacznik zmian liczy
// realną różnicę względem bazy, więc reset projektu, który już jest domyślny,
// nie jest zmianą (zapis nie miałby czego wysłać) - to osobny przypadek niżej.
describe("przywracanie domyślnych", () => {
  it("reset wstawia KOMPLETNY domyślny obiekt prezentacji", async () => {
    // Częściowy obiekt zostawiłby w bazie mieszankę starych i nowych gałęzi.
    await mounted({ popup_design: customDesign() });

    fireEvent.click(screen.getByText(G("reset")));

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });
    expect(sentPatch().popup_design).toEqual(defaultPopupDesign());
    // Komplet gałęzi, nie jedna - częściowy obiekt zostawiłby mieszankę.
    expect(Object.keys(sentPatch().popup_design as object).sort()).toEqual(
      Object.keys(defaultPopupDesign()).sort(),
    );
  });

  it("reset jest ZMIANĄ - zapala znacznik, żeby dało się go zapisać", async () => {
    await mounted({ popup_design: customDesign() });

    fireEvent.click(screen.getByText(G("reset")));

    expect(screen.getByText(G("unsaved"))).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("reset potwierdza się komunikatem", async () => {
    await mounted();

    fireEvent.click(screen.getByText(G("reset")));

    expect(toast.success).toHaveBeenCalledWith(G("resetDone"));
    // Reset to jeszcze nie zapis - komunikat nie może mówić „zapisano".
    expect(toast.success).not.toHaveBeenCalledWith(G("saved"));
  });

  it("reset NIE rusza treści popupu - tylko warstwę prezentacji", async () => {
    await mounted({ popup_title_pl: "Dołącz do nas", popup_design: customDesign() });

    fireEvent.click(screen.getByText(G("reset")));

    expect(screen.getByTestId("tytul").textContent).toBe("Dołącz do nas");
    // Reset JEST zauważony - zapis staje się możliwy.
    expect(screen.getByText(G("save")).closest("button")?.hasAttribute("disabled")).toBe(false);
  });

  it("reset projektu, który JUŻ jest domyślny, nie udaje zmiany", async () => {
    await mounted();

    fireEvent.click(screen.getByText(G("reset")));

    expect(screen.queryByText(G("unsaved"))).toBeNull();
    expect(saveButton()).toHaveProperty("disabled", true);
  });
});

// ---------------------------------------------------------------------------
describe("tłumaczenia", () => {
  it("przyciski idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      await mounted();

      expect(screen.getByText(i18n.t("adminPopupSignup.save"))).toBeTruthy();
      expect(screen.getByText(i18n.t("adminPopupSignup.reset"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});
