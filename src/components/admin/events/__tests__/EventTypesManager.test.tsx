// Katalog rodzajów wydarzeń - SKLEJENIE listy, dialogu i czterech mutacji.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY LISTY MAJĄ TRZY WIDOKI (w locie / awaria / pustka), a czwarty
//      to lista. Wczytywanie, które wygląda jak pustka, kończy się drugim
//      rodzajem o tej samej nazwie.
//   2. WPIS SYSTEMOWY I WPIS W UŻYCIU MAJĄ ODCIĘTY KOSZ, a kliknięcie NIE otwiera
//      pytania o usunięcie i NIE woła mutacji. To reguła danych: rodzaj używany
//      przez wydarzenia zabrałby ze sobą etykietę z archiwum.
//   3. PRZEPIĘCIE POJAWIA SIĘ TYLKO TAM, GDZIE MA SKUTEK - i niesie LICZBĘ
//      w przycisku potwierdzenia, nie w tekście obok.
//   4. CO IDZIE DO MUTACJI ZAPISU: payload z reguł domeny, nie treść pól. Asercja
//      jest na OBIEKCIE przekazanym do `mutate`, nie na DOM-ie.
//   5. LICZNIK UŻYCIA MÓWI TRZY RÓŻNE RZECZY (nieużywany / tylko szkice /
//      mieszany), bo to trzy różne decyzje redaktora.
//   6. ODMOWA BAZY MA DWIE DROGI: rozpoznana przyczyna jedzie zdaniem ze
//      słownika, każda inna - surowym tekstem z bazy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł katalogu (wersja robocza, walidacja,
// payload, odcięcie kosza, mapowanie odmowy) - tabele przypadków są
// w `lib/events/__tests__/adminEventTypeCatalog.test.ts`; tutaj dowodzimy, że
// organizm ich UŻYWA i co robi z wynikiem. (2) Molekuł `AdminCatalog*` - mają
// własne pliki. (3) Samych hooków (unieważnianie cache, `staleTime`) - są
// zamockowane na poziomie MODUŁU, bo przedmiotem dowodu jest to, CO organizm do
// nich wysyła.
//
// Radix Dialog i AlertDialog nie działają pod happy-dom bez pełnego pointer API
// - oba są podmienione na natywne odpowiedniki, w których TREŚĆ istnieje
// wyłącznie przy otwartym dialogu (tak jak portal Radixa).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { EventTypeAdminRow } from "@/lib/events/eventTypes";
import type { EventTypeUpsertInput } from "@/lib/events/eventTypesApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess: (value: T) => void;
  onError: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  rows: undefined as EventTypeAdminRow[] | undefined,
  isLoading: false,
  isError: false,
  listError: "permission denied for function admin_event_types_list",
  upsertInputs: [] as EventTypeUpsertInput[],
  upsertFails: null as string | null,
  upsertPending: false,
  activeCalls: [] as { id: string; isActive: boolean }[],
  activeFails: null as string | null,
  removeIds: [] as string[],
  removeFails: null as string | null,
  reassignCalls: [] as { fromId: string; toId: string }[],
  reassignMoved: 0,
  reassignFails: null as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// Selektor ikony ciągnie cały katalog Lucide - w teście organizmu jest tylko
// polem tekstowym, którego wartość jedzie do wersji roboczej.
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (name: string | undefined) => void;
  }) => (
    <input
      aria-label="icon-picker"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

// Atrapa Radixa: `Root` renderuje dzieci zawsze, ale `Content` istnieje tylko
// przy otwartym dialogu (portal nie jest montowany).
vi.mock("@/components/ui/dialog", () => {
  let open = false;
  let setOpen: ((next: boolean) => void) | null = null;
  return {
    Dialog: ({
      open: isOpen,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children: ReactNode;
    }) => {
      open = isOpen;
      setOpen = onOpenChange;
      return <div data-testid="dialog-root">{children}</div>;
    },
    DialogContent: ({ children }: { children: ReactNode }) =>
      open ? (
        <div role="dialog">
          {children}
          <button type="button" onClick={() => setOpen?.(false)}>
            zamknij-dialog
          </button>
        </div>
      ) : null,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("@/components/ui/alert-dialog", () => {
  let open = false;
  let setOpen: ((next: boolean) => void) | null = null;
  return {
    AlertDialog: ({
      open: isOpen,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (next: boolean) => void;
      children: ReactNode;
    }) => {
      open = isOpen;
      setOpen = onOpenChange;
      return <div data-testid="alert-root">{children}</div>;
    },
    AlertDialogContent: ({ children }: { children: ReactNode }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: { children: ReactNode }) => (
      <button type="button" onClick={() => setOpen?.(false)}>
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      onClick,
      disabled,
    }: {
      children: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

// Radix Select nie renderuje opcji bez pointer API - droplista jest natywnym
// `<select>`, którego wartość jedzie tą samą drogą.
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/lib/events/useEventTypes", () => ({
  useAdminEventTypes: () => ({
    data: h.rows,
    isLoading: h.isLoading,
    isError: h.isError,
    error: new Error(h.listError),
  }),
  useUpsertEventType: () => ({
    isPending: h.upsertPending,
    mutate: (input: EventTypeUpsertInput, res: Wynik<string>) => {
      h.upsertInputs.push(input);
      if (h.upsertFails !== null) res.onError(new Error(h.upsertFails));
      else res.onSuccess("nowe-id");
    },
  }),
  useSetEventTypeActive: () => ({
    isPending: false,
    mutate: (input: { id: string; isActive: boolean }, res: Wynik<boolean>) => {
      h.activeCalls.push(input);
      if (h.activeFails !== null) res.onError(new Error(h.activeFails));
      else res.onSuccess(true);
    },
  }),
  useDeleteEventType: () => ({
    isPending: false,
    mutate: (id: string, res: Wynik<boolean>) => {
      h.removeIds.push(id);
      if (h.removeFails !== null) res.onError(new Error(h.removeFails));
      else res.onSuccess(true);
    },
  }),
  useReassignEventType: () => ({
    isPending: false,
    mutate: (input: { fromId: string; toId: string }, res: Wynik<number>) => {
      h.reassignCalls.push(input);
      if (h.reassignFails !== null) res.onError(new Error(h.reassignFails));
      else res.onSuccess(h.reassignMoved);
    },
  }),
}));

const { EventTypesManager } = await import("@/components/admin/events/organisms/EventTypesManager");

function wiersz(patch: Partial<EventTypeAdminRow> = {}): EventTypeAdminRow {
  return {
    id: "id-roundtable",
    key: "roundtable",
    name_pl: "Okrągły stół",
    name_en: "Roundtable",
    description_pl: "",
    description_en: "",
    icon: "Users",
    accent_color: null,
    default_format: "onsite",
    default_registration_mode: "form",
    default_registration_flow: "instant",
    default_guest_mode: "teaser",
    default_capacity: null,
    default_duration_minutes: null,
    default_min_tier_rank: 0,
    default_chatham_house: false,
    requires_ticket: false,
    sort_order: 30,
    is_active: true,
    is_system: false,
    events_count: 0,
    published_events_count: 0,
    ...patch,
  };
}

beforeEach(() => {
  h.rows = [wiersz()];
  h.isLoading = false;
  h.isError = false;
  h.upsertInputs = [];
  h.upsertFails = null;
  h.upsertPending = false;
  h.activeCalls = [];
  h.activeFails = null;
  h.removeIds = [];
  h.removeFails = null;
  h.reassignCalls = [];
  h.reassignMoved = 0;
  h.reassignFails = null;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("trzy stany listy", () => {
  it("wczytywanie pokazuje postęp, nie pustkę", () => {
    h.rows = undefined;
    h.isLoading = true;
    render(<EventTypesManager />);
    expect(screen.getByText("adminEvents.types.loading")).toBeTruthy();
    expect(screen.queryByText("adminEvents.types.empty")).toBeNull();
  });

  it("awaria pokazuje treść z bazy, nie pustkę", () => {
    h.rows = undefined;
    h.isError = true;
    render(<EventTypesManager />);
    expect(screen.getByText(h.listError)).toBeTruthy();
    expect(screen.queryByText("adminEvents.types.empty")).toBeNull();
  });

  it("pustka mówi to wprost i nie rysuje wiersza", () => {
    h.rows = [];
    render(<EventTypesManager />);
    expect(screen.getByText("adminEvents.types.empty")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("nagłówek liczy WŁĄCZONE wpisy, nie długość listy", () => {
    h.rows = [wiersz(), wiersz({ id: "b", key: "webinar", is_active: false })];
    render(<EventTypesManager />);
    expect(screen.getByText("adminEvents.types.summary(active=1,total=2)")).toBeTruthy();
  });
});

describe("licznik użycia mówi trzy różne rzeczy", () => {
  it("rodzaj nieużywany", () => {
    render(<EventTypesManager />);
    expect(screen.getByText(/adminEvents\.types\.usageNone/)).toBeTruthy();
  });

  it("rodzaj tylko w szkicach - przepięcie bez skutku publicznego", () => {
    h.rows = [wiersz({ events_count: 7, published_events_count: 0 })];
    render(<EventTypesManager />);
    expect(screen.getByText(/adminEvents\.types\.usageDraftsOnly\(total=7\)/)).toBeTruthy();
  });

  it("rodzaj mieszany - przepięcie ruszy stronę publiczną", () => {
    h.rows = [wiersz({ events_count: 40, published_events_count: 12 })];
    render(<EventTypesManager />);
    expect(
      screen.getByText(/adminEvents\.types\.usageMixed\(published=12,total=40\)/),
    ).toBeTruthy();
  });
});

describe("odcięcie kosza", () => {
  it("wpis systemowy ma kosz odcięty i klik nie woła mutacji", () => {
    h.rows = [wiersz({ is_system: true })];
    render(<EventTypesManager />);
    const kosz = screen.getByLabelText("adminEvents.types.deleteLabel(name=Okrągły stół)");
    expect(kosz.hasAttribute("disabled")).toBe(true);
    fireEvent.click(kosz);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });

  it("wpis w użyciu ma kosz odcięty", () => {
    h.rows = [wiersz({ events_count: 3, published_events_count: 1 })];
    render(<EventTypesManager />);
    expect(
      screen
        .getByLabelText("adminEvents.types.deleteLabel(name=Okrągły stół)")
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("wpis nieużywany kasuje się po potwierdzeniu", () => {
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.deleteLabel(name=Okrągły stół)"));
    const pytanie = screen.getByRole("alertdialog");
    fireEvent.click(within(pytanie).getByText("adminEvents.types.deleteDialog.confirmAction"));
    expect(h.removeIds).toEqual(["id-roundtable"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.types.toasts.deleted");
  });

  it("odmowa usunięcia mówi zdaniem ze słownika, gdy przyczynę rozpoznaliśmy", () => {
    h.removeFails = "event_type_in_use: 12 event(s) still use this type";
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.deleteLabel(name=Okrągły stół)"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEvents.types.deleteDialog.confirmAction",
      ),
    );
    expect(h.toastError).toHaveBeenCalledWith("adminEvents.types.errors.inUse");
  });

  it("odmowa nierozpoznana mówi SUROWĄ treścią z bazy", () => {
    h.removeFails = "permission denied for function admin_event_type_delete";
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.deleteLabel(name=Okrągły stół)"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByText(
        "adminEvents.types.deleteDialog.confirmAction",
      ),
    );
    expect(h.toastError).toHaveBeenCalledWith(
      "permission denied for function admin_event_type_delete",
    );
  });
});

describe("przepięcie wydarzeń", () => {
  const dwaRodzaje = () => [
    wiersz({ events_count: 40, published_events_count: 12 }),
    wiersz({ id: "id-webinar", key: "webinar", name_pl: "Webinar", name_en: "Webinar" }),
  ];

  it("przycisk pojawia się tylko tam, gdzie MA co i gdzie przepiąć", () => {
    h.rows = dwaRodzaje();
    render(<EventTypesManager />);
    // Rodzaj używany, jest cel - przycisk jest.
    expect(
      screen.getByLabelText("adminEvents.types.reassignLabel(name=Okrągły stół)"),
    ).toBeTruthy();
    // Rodzaj nieużywany - przycisku nie ma.
    expect(screen.queryByLabelText("adminEvents.types.reassignLabel(name=Webinar)")).toBeNull();
  });

  it("nie pojawia się, gdy nie ma innego AKTYWNEGO rodzaju", () => {
    h.rows = [
      wiersz({ events_count: 40, published_events_count: 12 }),
      wiersz({ id: "id-webinar", key: "webinar", name_pl: "Webinar", is_active: false }),
    ];
    render(<EventTypesManager />);
    expect(
      screen.queryByLabelText("adminEvents.types.reassignLabel(name=Okrągły stół)"),
    ).toBeNull();
  });

  it("liczba stoi w PRZYCISKU potwierdzenia, a wybór celu jedzie do mutacji", () => {
    h.rows = dwaRodzaje();
    h.reassignMoved = 40;
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.reassignLabel(name=Okrągły stół)"));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("adminEvents.types.reassignDialog.confirmAction(total=40)"),
    ).toBeTruthy();

    fireEvent.change(
      within(dialog).getByLabelText("adminEvents.types.reassignDialog.targetLabel"),
      { target: { value: "id-webinar" } },
    );
    fireEvent.click(
      within(dialog).getByText("adminEvents.types.reassignDialog.confirmAction(total=40)"),
    );

    expect(h.reassignCalls).toEqual([{ fromId: "id-roundtable", toId: "id-webinar" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.types.toasts.reassigned(count=40)");
  });

  it("bez wybranego celu przycisk jest odcięty", () => {
    h.rows = dwaRodzaje();
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.reassignLabel(name=Okrągły stół)"));
    const dialog = screen.getByRole("dialog");
    const potwierdz = within(dialog).getByText(
      "adminEvents.types.reassignDialog.confirmAction(total=40)",
    );
    expect(potwierdz.closest("button")?.hasAttribute("disabled")).toBe(true);
  });

  it("lista celów NIE zawiera rodzaju źródłowego", () => {
    h.rows = dwaRodzaje();
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.reassignLabel(name=Okrągły stół)"));
    const droplista = within(screen.getByRole("dialog")).getByLabelText(
      "adminEvents.types.reassignDialog.targetLabel",
    );
    const wartosci = Array.from(droplista.querySelectorAll("option")).map((o) => o.value);
    expect(wartosci).toEqual(["", "id-webinar"]);
  });
});

describe("przełącznik dostępności", () => {
  it("wysyła NOWĄ wartość i potwierdza toastem", () => {
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.toggleLabel(name=Okrągły stół)"));
    expect(h.activeCalls).toEqual([{ id: "id-roundtable", isActive: false }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.types.toasts.toggled");
  });

  it("awaria przełączenia mówi treścią z bazy", () => {
    h.activeFails = "permission denied";
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.toggleLabel(name=Okrągły stół)"));
    expect(h.toastError).toHaveBeenCalledWith("permission denied");
  });
});

describe("dialog zapisu", () => {
  it("nowy wpis dostaje kolejność z ostatniego wiersza listy", () => {
    h.rows = [wiersz({ sort_order: 60 })];
    render(<EventTypesManager />);
    fireEvent.click(screen.getByText("adminEvents.types.addAction"));
    const dialog = screen.getByRole("dialog");
    const kolejnosc = within(dialog).getByLabelText(
      "adminEvents.types.dialog.sortOrderLabel",
    ) as HTMLInputElement;
    expect(kolejnosc.value).toBe("70");
  });

  it("klucz podąża za nazwą polską do pierwszego tknięcia pola", () => {
    render(<EventTypesManager />);
    fireEvent.click(screen.getByText("adminEvents.types.addAction"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("adminEvents.types.dialog.namePlLabel"), {
      target: { value: "Śniadanie prasowe" },
    });
    const klucz = within(dialog).getByLabelText(
      "adminEvents.types.dialog.keyLabel",
    ) as HTMLInputElement;
    expect(klucz.value).toBe("sniadanie_prasowe");
  });

  it("klucz jest ZAMROŻONY przy edycji istniejącego wpisu", () => {
    render(<EventTypesManager />);
    fireEvent.click(screen.getByLabelText("adminEvents.types.editLabel(name=Okrągły stół)"));
    const klucz = within(screen.getByRole("dialog")).getByLabelText(
      "adminEvents.types.dialog.keyLabel",
    );
    expect(klucz.hasAttribute("disabled")).toBe(true);
  });

  it("zapis niesie payload z REGUŁ, nie treść pól", () => {
    render(<EventTypesManager />);
    fireEvent.click(screen.getByText("adminEvents.types.addAction"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("adminEvents.types.dialog.namePlLabel"), {
      target: { value: "  Panel ekspertów  " },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEvents.types.dialog.nameEnLabel"), {
      target: { value: " Expert panel " },
    });
    fireEvent.click(within(dialog).getByText("adminEvents.types.dialog.saveAction"));

    expect(h.upsertInputs).toHaveLength(1);
    const payload = h.upsertInputs[0]!;
    // Nazwy PRZYCIĘTE, klucz ROZSTRZYGNIĘTY z nazwy polskiej, pustki jako `null`.
    expect(payload.namePl).toBe("Panel ekspertów");
    expect(payload.nameEn).toBe("Expert panel");
    expect(payload.key).toBe("panel_ekspertow");
    expect(payload.defaultCapacity).toBeNull();
    expect(payload.accentColor).toBeNull();
    expect(payload.id).toBeNull();
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.types.toasts.saved");
  });

  it("walidacja ODCINA przycisk zapisu i pokazuje powód", () => {
    render(<EventTypesManager />);
    fireEvent.click(screen.getByText("adminEvents.types.addAction"));
    const dialog = screen.getByRole("dialog");
    // Pusta wersja robocza: brak obu nazw.
    expect(within(dialog).getByText("adminEvents.types.errors.names")).toBeTruthy();
    expect(
      within(dialog)
        .getByText("adminEvents.types.dialog.saveAction")
        .closest("button")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(h.upsertInputs).toEqual([]);
  });

  it("odmowa zapisu ZOSTAWIA dialog otwarty z wpisaną treścią", () => {
    h.upsertFails = "duplicate key value violates unique constraint";
    render(<EventTypesManager />);
    fireEvent.click(screen.getByText("adminEvents.types.addAction"));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("adminEvents.types.dialog.namePlLabel"), {
      target: { value: "Panel" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEvents.types.dialog.nameEnLabel"), {
      target: { value: "Panel" },
    });
    fireEvent.click(within(dialog).getByText("adminEvents.types.dialog.saveAction"));

    expect(h.toastError).toHaveBeenCalledWith("adminEvents.types.errors.duplicate");
    dialog = screen.getByRole("dialog");
    expect(
      (within(dialog).getByLabelText("adminEvents.types.dialog.namePlLabel") as HTMLInputElement)
        .value,
    ).toBe("Panel");
  });
});
