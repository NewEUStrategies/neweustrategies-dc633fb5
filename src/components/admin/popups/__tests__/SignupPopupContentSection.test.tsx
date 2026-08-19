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
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseFromStub, ok, type RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ from: (_t: string): unknown => ({}) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.from(table) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
let saveResult: (chain: RecordedChain) => ReturnType<typeof ok>;

function mount(overrides: Partial<NewsletterSettings> = {}) {
  const row = {
    ...defaultNewsletterSettings(),
    tenant_id: "tenant-1",
    popup_title_pl: "Zapisz się",
    ...overrides,
  };
  stub.setResponse("newsletter_settings", (chain) => {
    if (chain.has("update") || chain.has("insert")) return saveResult(chain);
    if ((chain.argsOf("select")?.[0] as string) === "tenant_id")
      return ok({ tenant_id: "tenant-1" });
    return ok(row);
  });
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

/** Treść, jaka poszłaby do bazy. */
function sentBody(): Record<string, unknown> {
  const chain = stub.chainsFor("newsletter_settings").find((c) => c.has("update"))!;
  return chain.argsOf("update")![0] as Record<string, unknown>;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  stub = supabaseFromStub();
  h.from = stub.from;
  saveResult = () => ok(null);
  clearEdgeTtlCache();
  vi.clearAllMocks();
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
    saveResult = () => ({ data: null, error: Object.assign(new Error("baza padla"), {}) });
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
  it("wysyła CAŁE ustawienia, razem ze zmianą operatora", async () => {
    await mounted({ popup_title_pl: "Zapisz się" });
    fireEvent.click(screen.getByText("zmien-tytul"));

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });

    expect(sentBody().popup_title_pl).toBe("Nowy tytuł");
    expect(sentBody().popup_enabled).toBe(defaultNewsletterSettings().popup_enabled);
  });

  it("bez zmian nie da się kliknąć zapisu, więc nic nie leci do bazy", async () => {
    await mounted();

    fireEvent.click(screen.getByText(G("save")));

    await act(async () => {});
    expect(stub.chainsFor("newsletter_settings").some((c) => c.has("update"))).toBe(false);
    // Przycisk jest ZABLOKOWANY - to on jest barierą, nie milczenie zapisu.
    expect(screen.getByText(G("save")).closest("button")?.hasAttribute("disabled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("przywracanie domyślnych", () => {
  it("reset wstawia KOMPLETNY domyślny obiekt prezentacji", async () => {
    // Częściowy obiekt zostawiłby w bazie mieszankę starych i nowych gałęzi.
    await mounted();

    fireEvent.click(screen.getByText(G("reset")));

    await act(async () => {
      fireEvent.click(screen.getByText(G("save")));
    });
    expect(sentBody().popup_design).toEqual(defaultPopupDesign());
    // Komplet gałęzi, nie jedna - częściowy obiekt zostawiłby mieszankę.
    expect(Object.keys(sentBody().popup_design as object).sort()).toEqual(
      Object.keys(defaultPopupDesign()).sort(),
    );
  });

  it("reset jest ZMIANĄ - zapala znacznik, żeby dało się go zapisać", async () => {
    await mounted();

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
    await mounted({ popup_title_pl: "Dołącz do nas" });

    fireEvent.click(screen.getByText(G("reset")));

    expect(screen.getByTestId("tytul").textContent).toBe("Dołącz do nas");
    // Reset JEST zauważony - zapis staje się możliwy.
    expect(screen.getByText(G("save")).closest("button")?.hasAttribute("disabled")).toBe(false);
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
