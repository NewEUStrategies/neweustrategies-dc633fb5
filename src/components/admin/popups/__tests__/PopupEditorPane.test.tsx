// Edytor popupu buildera - nazwa, status, dokument i ustawienia w jednym ekranie
// z RĘCZNYM zapisem.
//
// PO CO. Zapis jest ręczny, więc jedyną ochroną pracy operatora jest porównanie
// bieżącego stanu z migawką z ostatniego zapisu. Pomyłki są ciche i kosztowne:
//   * migawka NIE odświeżona po zapisie -> „niezapisane zmiany" zostają na
//     zawsze i operator uczy się ignorować ostrzeżenie;
//   * migawka odświeżona po NIEUDANYM zapisie -> ostrzeżenie gaśnie, operator
//     wychodzi z edytora i traci pracę;
//   * przełączenie statusu na „aktywny" bez zapisu -> popup, o którym operator
//     myśli, że działa.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

interface PopupRecord {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  builder_data: { sections: unknown[] };
  settings: Record<string, unknown>;
}

const env = vi.hoisted(() => ({
  popup: null as unknown,
  loading: false,
  saveOk: true,
  saved: [] as Record<string, unknown>[],
  guardWith: [] as boolean[],
}));

vi.mock("@/lib/builder/popups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/popups")>();
  return {
    ...actual,
    usePopupEditor: () => ({
      popup: env.popup,
      loading: env.loading,
      save: async (patch: Record<string, unknown>) => {
        env.saved.push(patch);
        return env.saveOk;
      },
    }),
  };
});
// Blokada wyjścia ma własne testy; tutaj interesuje nas tylko, Z JAKĄ flagą jest
// wołana - to ona decyduje, czy operator zostanie ostrzeżony.
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: (when: boolean) => {
    env.guardWith.push(when);
  },
}));
// Builder to cały edytor wizualny - ma własne testy. Tu wystarczy, że da się
// przez niego zmienić dokument.
vi.mock("@/components/admin/builder/Builder", () => ({
  Builder: ({
    value,
    onChange,
    scope,
    lang,
  }: {
    value: unknown;
    onChange: (doc: unknown) => void;
    scope: string;
    lang: string;
  }) => (
    <div data-testid="builder" data-scope={scope} data-lang={lang}>
      <button type="button" onClick={() => onChange({ sections: [{ id: "nowa" }] })}>
        zmien-dokument
      </button>
      <span>{JSON.stringify(value)}</span>
    </div>
  ),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Link: ({ to, children, className }: Record<string, unknown>) =>
      createElement("a", { href: to as string, className: className as string }, children as never),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { PopupEditorPane } from "@/components/admin/popups/PopupEditorPane";
import { defaultPopupSettings } from "@/lib/builder/popups";

const P = (key: string) => i18n.t(`admin.popups.${key}`);

function popupRecord(overrides: Partial<PopupRecord> = {}): PopupRecord {
  return {
    id: "popup-1",
    name: "Powitalny",
    status: "draft",
    builder_data: { sections: [{ id: "s1" }] },
    settings: { ...defaultPopupSettings() },
    ...overrides,
  };
}

async function mount(record: PopupRecord | null = popupRecord()) {
  env.popup = record;
  const utils = render(<PopupEditorPane popupId="popup-1" />);
  if (record) await screen.findByTestId("builder");
  return utils;
}

function nameInput(): HTMLInputElement {
  return screen.getByPlaceholderText(P("namePlaceholder")) as HTMLInputElement;
}

/** Czy blokada wyjścia jest w tym momencie WŁĄCZONA. */
function guardActive(): boolean {
  return env.guardWith.at(-1) === true;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  env.popup = popupRecord();
  env.loading = false;
  env.saveOk = true;
  env.saved = [];
  env.guardWith = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("stany wczytywania", () => {
  it("w trakcie wczytywania nie pokazuje edytora", () => {
    env.loading = true;
    env.popup = null;
    render(<PopupEditorPane popupId="popup-1" />);

    expect(screen.getByText(P("loading"))).toBeTruthy();
    expect(screen.queryByTestId("builder")).toBeNull();
  });

  it("BRAK rekordu mówi to wprost i daje drogę powrotu", () => {
    // Wcześniej ta gałąź była NIEOSIĄGALNA: warunek ładowania łapał też
    // `!popup && !doc`, więc operator wchodzący w usunięty albo obcy popup
    // patrzył na „Ładowanie..." bez końca i bez drogi powrotu.
    env.loading = false;
    env.popup = null;
    render(<PopupEditorPane popupId="nie-ma" />);

    expect(screen.getByText(P("notFound"))).toBeTruthy();
    expect(screen.getByText(P("backToList")).closest("a")?.getAttribute("href")).toBe(
      "/admin/popups",
    );
  });

  it("„ładowanie” pokazuje się TYLKO w trakcie wczytywania", () => {
    // Rozdzielenie obu stanów jest sedno poprawki: „nie wiem jeszcze" i „nie ma"
    // wymagają od operatora różnych rzeczy.
    env.loading = true;
    env.popup = null;
    render(<PopupEditorPane popupId="popup-1" />);

    expect(screen.getByText(P("loading"))).toBeTruthy();
    expect(screen.queryByText(P("notFound"))).toBeNull();
  });

  it("wczytany rekord zasila nazwę, status i dokument", async () => {
    await mount(popupRecord({ name: "Powitalny", status: "active" }));

    expect(nameInput().value).toBe("Powitalny");
    expect(screen.getByText(P("statusActive"))).toBeTruthy();
    expect(screen.getByTestId("builder").textContent).toContain("s1");
  });
});

// ---------------------------------------------------------------------------
describe("ochrona niezapisanej pracy", () => {
  it("świeżo wczytany edytor NIE jest brudny", async () => {
    await mount();

    expect(guardActive()).toBe(false);
    // Blokada została ZAREJESTROWANA, tylko wyłączona - inaczej test przechodziłby
    // też wtedy, gdyby edytor wcale o nią nie poprosił.
    expect(env.guardWith.length).toBeGreaterThan(0);
  });

  it("zmiana nazwy WŁĄCZA ostrzeżenie o niezapisanych zmianach", async () => {
    await mount();

    fireEvent.change(nameInput(), { target: { value: "Inny" } });

    expect(guardActive()).toBe(true);
    // Pole trzyma nową wartość - ostrzeżenie bez zmiany w polu byłoby fałszywe.
    expect(nameInput().value).toBe("Inny");
  });

  it("zmiana dokumentu w builderze też włącza ostrzeżenie", async () => {
    await mount();

    fireEvent.click(screen.getByText("zmien-dokument"));

    expect(guardActive()).toBe(true);
    // Zmiana idzie z buildera, nie z pola nazwy.
    expect(nameInput().value).toBe("Powitalny");
  });

  it("UDANY zapis odświeża migawkę i gasi ostrzeżenie", async () => {
    // Bez odświeżenia migawki ostrzeżenie zostaje na zawsze i operator uczy się
    // je ignorować.
    await mount();
    fireEvent.change(nameInput(), { target: { value: "Inny" } });
    expect(guardActive()).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText(P("save")));
    });

    expect(guardActive()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(P("saved"));
  });

  it("NIEUDANY zapis ZOSTAWIA ostrzeżenie - inaczej operator traci pracę", async () => {
    env.saveOk = false;
    await mount();
    fireEvent.change(nameInput(), { target: { value: "Inny" } });

    await act(async () => {
      fireEvent.click(screen.getByText(P("save")));
    });

    expect(guardActive()).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(P("saveError"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("powrót do zapisanej wartości gasi ostrzeżenie", async () => {
    await mount(popupRecord({ name: "Powitalny" }));

    fireEvent.change(nameInput(), { target: { value: "Inny" } });
    expect(guardActive()).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "Powitalny" } });

    expect(guardActive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("zapis", () => {
  it("wysyła nazwę, status, dokument i ustawienia razem", async () => {
    await mount(popupRecord({ name: "Powitalny", status: "draft" }));

    await act(async () => {
      fireEvent.click(screen.getByText(P("save")));
    });

    expect(env.saved).toHaveLength(1);
    expect(Object.keys(env.saved[0]!).sort()).toEqual([
      "builder_data",
      "name",
      "settings",
      "status",
    ]);
  });

  it("PUSTA nazwa schodzi na wartość awaryjną - popup bez nazwy jest nie do znalezienia", async () => {
    await mount();
    fireEvent.change(nameInput(), { target: { value: "   " } });

    await act(async () => {
      fireEvent.click(screen.getByText(P("save")));
    });

    expect(env.saved[0]!.name).toBe("Popup");
    // Nie pusty napis i nie same spacje - inaczej lista pokazuje puste wiersze.
    expect(env.saved[0]!.name).not.toBe("");
  });

  it("nazwa jest przycinana z brzegowych spacji", async () => {
    await mount();
    fireEvent.change(nameInput(), { target: { value: "  Powitalny 2  " } });

    await act(async () => {
      fireEvent.click(screen.getByText(P("save")));
    });

    expect(env.saved[0]!.name).toBe("Powitalny 2");
    // Spacja W ŚRODKU nazwy zostaje - przycinamy tylko brzegi.
    expect(env.saved[0]!.name).toContain(" ");
  });

  it("zmieniony status jedzie w zapisie", async () => {
    await mount(popupRecord({ status: "draft" }));

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: P("statusActive") }));
    await act(async () => {
      fireEvent.click(screen.getByText(P("save")));
    });

    expect(env.saved[0]!.status).toBe("active");
    // Zmiana statusu nie gubi po drodze dokumentu ani nazwy.
    expect(env.saved[0]!.name).toBe("Powitalny");
  });

  it("zmieniony dokument jedzie w zapisie", async () => {
    await mount();

    fireEvent.click(screen.getByText("zmien-dokument"));
    await act(async () => {
      fireEvent.click(screen.getByText(P("save")));
    });

    expect(JSON.stringify(env.saved[0]!.builder_data)).toContain("nowa");
    // Zapis idzie RAZ, nie raz na każdą zmianę dokumentu.
    expect(env.saved).toHaveLength(1);
  });

  it("przycisk zapisu jest ZABLOKOWANY w trakcie zapisywania", async () => {
    await mount();

    fireEvent.click(screen.getByText(P("save")));

    // Etykieta przechodzi na „zapisywanie", a przycisk jest zablokowany, więc
    // podwójny klik nie wysyła drugiego żądania.
    const button = screen.getByText(P("saving")).closest("button")!;
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    await waitFor(() => expect(env.saved.length).toBe(1));
  });
});

// ---------------------------------------------------------------------------
describe("zakładki i builder", () => {
  it("builder dostaje ZAKRES „popup” - inaczej biblioteka pokazuje widgety stron", async () => {
    await mount();

    expect(screen.getByTestId("builder").getAttribute("data-scope")).toBe("popup");
    expect(screen.getByTestId("builder").getAttribute("data-scope")).not.toBe("page");
  });

  it("język kanwy startuje od języka panelu", async () => {
    await mount();

    expect(screen.getByTestId("builder").getAttribute("data-lang")).toBe("pl");
    // Kanwa dostaje język, a nie pełny kod lokalizacji („pl-PL").
    expect(screen.getByTestId("builder").getAttribute("data-lang")).not.toContain("-");
  });

  it("zakładka ustawień pokazuje formularz wyświetlania", async () => {
    await mount();

    // Radix aktywuje zakładkę na wcisnieciu przycisku, nie na samym kliknięciu.
    const trigger = screen.getByText(P("tabSettings"));
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    expect(await screen.findByText(i18n.t("admin.popups.settings.triggerSection"))).toBeTruthy();
    expect(screen.getByText(i18n.t("admin.popups.settings.appearanceSection"))).toBeTruthy();
  });

  it("nagłówek daje powrót do listy popupów", async () => {
    await mount();

    const back = screen.getByText(P("title")).closest("a");
    expect(back?.getAttribute("href")).toBe("/admin/popups");
    // To link, nie przycisk - operator może otworzyć listę w nowej karcie.
    expect(back?.tagName).toBe("A");
  });
});
