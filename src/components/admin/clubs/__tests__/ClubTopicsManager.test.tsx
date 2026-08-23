// Katalog obszarów tematycznych - SKLEJENIE listy, dialogu i trzech mutacji.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY LISTY MAJĄ TRZY WIDOKI (w locie / awaria / pustka), a czwarty
//      to lista. Wczytywanie, które wygląda jak pustka, kończy się drugim
//      obszarem o tej samej nazwie.
//   2. WPIS SYSTEMOWY I WPIS W UŻYCIU MAJĄ ODCIĘTY KOSZ, a kliknięcie NIE otwiera
//      pytania o usunięcie i NIE woła mutacji. To reguła danych: obszar
//      przypisany do klubów i wątków zabrałby ze sobą etykietę z archiwum.
//   3. CO IDZIE DO MUTACJI ZAPISU: klucz znormalizowany (nowy wpis) albo
//      zamrożony (edycja), etykiety przycięte, kolejność z ostatniego wiersza
//      listy. Asercja jest na OBIEKCIE przekazanym do `mutate`, nie na DOM-ie.
//   4. WALIDACJA ODRZUCA BEZ ŻĄDANIA: brak nazwy w jednym języku i klucz
//      niezgodny z CHECK-iem bazy nie mają jak wyjść z tego dialogu.
//   5. KLUCZ PODĄŻA ZA NAZWĄ TYLKO DO PIERWSZEGO TKNIĘCIA POLA, a przy edycji
//      jest zablokowany - klucz zmieniony po zapisie osierociłby wiersze.
//   6. ODMOWA BAZY MA DWIE DROGI: duplikat i „w użyciu” jadą zdaniem ze
//      słownika, każdy inny błąd - surowym tekstem z bazy. Dialog po odmowie
//      ZOSTAJE otwarty z wpisaną treścią.
//   7. PRZEŁĄCZNIK WIERSZA WYSYŁA NOWĄ WARTOŚĆ i jest zablokowany na czas zapisu;
//      awaria przełączenia mówi treścią z bazy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł katalogu (wersja robocza, walidacja,
// payload, odcięcie kosza, mapowanie odmowy) - tabele przypadków są
// w `lib/clubs/__tests__/adminTaxonomyCatalog.test.ts`; tutaj dowodzimy, że
// organizm ich UŻYWA i co robi z wynikiem. (2) Molekuł `AdminCatalogToolbar`,
// `AdminCatalogListState` i `AdminCatalogRow` - mają własne pliki. (3) Normalizacji
// klucza (`slugifyTopicKey` - `topics.test.ts`). (4) Samych hooków katalogu
// (unieważnianie cache, `staleTime`) - są zamockowane na poziomie MODUŁU, bo
// przedmiotem dowodu jest to, CO organizm do nich wysyła.
//
// Radix Dialog i AlertDialog nie działają pod happy-dom bez pełnego pointer API
// - oba są podmienione na natywne odpowiedniki, w których TREŚĆ istnieje
// wyłącznie przy otwartym dialogu (tak jak portal Radixa).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubTopicAdminRow } from "@/lib/clubs/topicCatalog";
import type { ClubTopicUpsertInput } from "@/lib/clubs/topicsApi";

/** Kształt drugiego argumentu `mutate` - tylko to, co organizm przekazuje. */
interface Wynik<T> {
  onSuccess: (value: T) => void;
  onError: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  rows: undefined as ClubTopicAdminRow[] | undefined,
  isLoading: false,
  isError: false,
  listError: "permission denied for function admin_club_topics_list",
  upsertInputs: [] as ClubTopicUpsertInput[],
  upsertFails: null as string | null,
  upsertPending: false,
  activeCalls: [] as { id: string; isActive: boolean }[],
  activeFails: null as string | null,
  activePending: false,
  removeIds: [] as string[],
  removeFails: null as string | null,
  removePending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Atrapa Radixa: `Root` renderuje dzieci zawsze, ale `Content` istnieje tylko
// przy otwartym dialogu (portal nie jest montowany). Dwa przyciski oddają
// `onOpenChange` w OBIE strony - to jedyna droga do zamknięcia dialogu klawiszem
// albo kliknięciem w tło.
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      return (
        <div data-testid="dialog" data-open={String(open)}>
          <button
            type="button"
            data-testid="dialog-zamknij-z-zewnatrz"
            onClick={() => onOpenChange?.(false)}
          />
          <button
            type="button"
            data-testid="dialog-otworz-z-zewnatrz"
            onClick={() => onOpenChange?.(true)}
          />
          {children}
        </div>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="dialog-content">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});
vi.mock("@/components/ui/alert-dialog", () => {
  const stan = { open: false };
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      return (
        <div data-testid="alert" data-open={String(open)}>
          <button
            type="button"
            data-testid="alert-zamknij-z-zewnatrz"
            onClick={() => onOpenChange?.(false)}
          />
          <button
            type="button"
            data-testid="alert-otworz-z-zewnatrz"
            onClick={() => onOpenChange?.(true)}
          />
          {children}
        </div>
      );
    },
    AlertDialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="alert-content">{children}</div> : null,
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
    AlertDialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
      <button type="button" data-testid="alert-anuluj">
        {children}
      </button>
    ),
    AlertDialogAction: ({
      children,
      disabled,
      onClick,
    }: {
      children?: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button type="button" data-testid="alert-potwierdz" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  };
});
vi.mock("@/lib/clubs/useClubTopics", () => ({
  useAdminClubTopics: () => ({
    data: h.rows,
    isLoading: h.isLoading,
    isError: h.isError,
    error: new Error(h.listError),
  }),
  useUpsertClubTopic: () => ({
    mutate: (input: ClubTopicUpsertInput, wynik: Wynik<string>) => {
      h.upsertInputs.push(input);
      if (h.upsertFails === null) wynik.onSuccess("topic-nowy");
      else wynik.onError(new Error(h.upsertFails));
    },
    isPending: h.upsertPending,
  }),
  useSetClubTopicActive: () => ({
    mutate: (vars: { id: string; isActive: boolean }, wynik: Wynik<boolean>) => {
      h.activeCalls.push(vars);
      if (h.activeFails === null) wynik.onSuccess(true);
      else wynik.onError(new Error(h.activeFails));
    },
    isPending: h.activePending,
  }),
  useDeleteClubTopic: () => ({
    mutate: (id: string, wynik: Wynik<boolean>) => {
      h.removeIds.push(id);
      if (h.removeFails === null) wynik.onSuccess(true);
      else wynik.onError(new Error(h.removeFails));
    },
    isPending: h.removePending,
  }),
}));

import { ClubTopicsManager } from "@/components/admin/clubs/organisms/ClubTopicsManager";
import { clubTopicAdminRow } from "@/test/clubs/catalogFixtures";

function panel() {
  return render(<ClubTopicsManager />);
}

function trzyObszary(): ClubTopicAdminRow[] {
  return [
    clubTopicAdminRow({ id: "t1", key: "energy", label_pl: "Energetyka", sort_order: 10 }),
    clubTopicAdminRow({
      id: "t2",
      key: "transport",
      label_pl: "Transport",
      label_en: "Transport",
      sort_order: 20,
      is_system: true,
    }),
    clubTopicAdminRow({
      id: "t3",
      key: "culture",
      label_pl: "Kultura",
      label_en: "Culture",
      sort_order: 30,
      is_active: false,
      threads_count: 4,
    }),
  ];
}

function dialog(): HTMLElement {
  return screen.getByTestId("dialog-content");
}

function pole(klucz: string): HTMLElement {
  return within(dialog()).getByLabelText(klucz);
}

function kosz(nazwa: string): HTMLElement {
  const wiersz = screen.getByText(nazwa).closest("li");
  if (wiersz === null) throw new Error(`brak wiersza ${nazwa}`);
  return within(wiersz).getByRole("button", { name: "adminClubs.topics.delete" });
}

function otwórzDodawanie(): void {
  fireEvent.click(screen.getByRole("button", { name: "adminClubs.topics.add" }));
}

function zapisz(): void {
  fireEvent.click(within(dialog()).getByRole("button", { name: "adminClubs.topics.save" }));
}

beforeEach(() => {
  h.rows = trzyObszary();
  h.isLoading = false;
  h.isError = false;
  h.upsertInputs = [];
  h.upsertFails = null;
  h.upsertPending = false;
  h.activeCalls = [];
  h.activeFails = null;
  h.activePending = false;
  h.removeIds = [];
  h.removeFails = null;
  h.removePending = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("trzy stany listy katalogu", () => {
  it("zapytanie W LOCIE pokazuje postęp, a nie komunikat pustki", () => {
    h.isLoading = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText("adminClubs.topics.loading")).toBeTruthy();
    expect(screen.queryByText("adminClubs.topics.empty")).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("AWARIA pokazuje treść z bazy, a nie pustkę", () => {
    h.isError = true;
    h.rows = undefined;
    panel();

    expect(screen.getByText(h.listError)).toBeTruthy();
    expect(screen.queryByText("adminClubs.topics.empty")).toBeNull();
  });

  it("pusty katalog mówi to wprost, a licznik pokazuje zero z zera", () => {
    h.rows = [];
    panel();

    expect(screen.getByText("adminClubs.topics.empty")).toBeTruthy();
    expect(screen.getByText("adminClubs.topics.activeSummary(active=0,total=0)")).toBeTruthy();
  });

  it("dane PEŁNE rysują wiersz na obszar, znaczniki i licznik włączonych", () => {
    panel();

    expect(screen.queryAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("adminClubs.topics.activeSummary(active=2,total=3)")).toBeTruthy();
    expect(screen.getByText("adminClubs.topics.system")).toBeTruthy();
    expect(screen.getByText("adminClubs.topics.disabled")).toBeTruthy();
    expect(screen.getByText("Kultura").closest("li")?.textContent).toContain(
      "adminClubs.topics.usage(clubs=0,threads=4)",
    );
  });

  it("dane CZĘŚCIOWE: obszar bez nazwy angielskiej renderuje się bez gołej pustki", () => {
    h.rows = [clubTopicAdminRow({ label_en: "" })];
    const { container } = panel();

    expect(screen.queryAllByRole("listitem")).toHaveLength(1);
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("null");
  });
});

describe("odcięcie kosza jest regułą danych", () => {
  it("obszar SYSTEMOWY ma kosz nieaktywny i nie otwiera pytania o usunięcie", () => {
    panel();
    const przycisk = kosz("Transport");

    expect(przycisk.hasAttribute("disabled")).toBe(true);
    fireEvent.click(przycisk);

    expect(screen.queryByTestId("alert-content")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });

  it("obszar W UŻYCIU ma kosz nieaktywny, choć nie jest systemowy", () => {
    panel();

    expect(kosz("Kultura").hasAttribute("disabled")).toBe(true);
    expect(h.removeIds).toEqual([]);
  });

  it("obszar nieużywany i niesystemowy pyta o potwierdzenie, a potem kasuje", () => {
    panel();

    fireEvent.click(kosz("Energetyka"));
    expect(screen.getByTestId("alert-content")).toBeTruthy();
    expect(screen.getByText("adminClubs.topics.deleteBody")).toBeTruthy();

    fireEvent.click(screen.getByTestId("alert-potwierdz"));

    expect(h.removeIds).toEqual(["t1"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.topics.deleted");
    expect(screen.queryByTestId("alert-content")).toBeNull();
  });

  it("odmowa „obszar w użyciu” jedzie ZDANIEM ze słownika i nie zamyka pytania", () => {
    h.removeFails = "topic_in_use";
    panel();

    fireEvent.click(kosz("Energetyka"));
    fireEvent.click(screen.getByTestId("alert-potwierdz"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.topics.errors.inUse");
    expect(screen.getByTestId("alert-content")).toBeTruthy();
  });

  it("każda inna odmowa kasowania jedzie SUROWYM tekstem z bazy", () => {
    h.removeFails = "deadlock detected";
    panel();

    fireEvent.click(kosz("Energetyka"));
    fireEvent.click(screen.getByTestId("alert-potwierdz"));

    expect(h.toastError).toHaveBeenCalledWith("deadlock detected");
  });

  it("zamknięcie pytania z zewnątrz porzuca wybrany obszar, otwarcie nic nie zmienia", () => {
    panel();
    fireEvent.click(kosz("Energetyka"));

    fireEvent.click(screen.getByTestId("alert-otworz-z-zewnatrz"));
    expect(screen.getByTestId("alert-content")).toBeTruthy();

    fireEvent.click(screen.getByTestId("alert-zamknij-z-zewnatrz"));
    expect(screen.queryByTestId("alert-content")).toBeNull();
    expect(h.removeIds).toEqual([]);
  });

  it("trwające kasowanie blokuje przycisk potwierdzenia", () => {
    h.removePending = true;
    panel();

    fireEvent.click(kosz("Energetyka"));

    expect(screen.getByTestId("alert-potwierdz").hasAttribute("disabled")).toBe(true);
  });
});

describe("przełącznik wiersza", () => {
  it("wysyła NOWĄ wartość dla właściwego obszaru", () => {
    panel();

    fireEvent.click(
      screen.getByRole("switch", { name: "adminClubs.topics.toggleAria(name=Energetyka)" }),
    );

    expect(h.activeCalls).toEqual([{ id: "t1", isActive: false }]);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("wyłączony obszar włącza się z powrotem", () => {
    panel();

    fireEvent.click(
      screen.getByRole("switch", { name: "adminClubs.topics.toggleAria(name=Kultura)" }),
    );

    expect(h.activeCalls).toEqual([{ id: "t3", isActive: true }]);
  });

  it("AWARIA przełączenia mówi treścią z bazy", () => {
    h.activeFails = "row level security violation";
    panel();

    fireEvent.click(
      screen.getByRole("switch", { name: "adminClubs.topics.toggleAria(name=Energetyka)" }),
    );

    expect(h.toastError).toHaveBeenCalledWith("row level security violation");
  });

  it("trwający zapis blokuje wszystkie przełączniki listy", () => {
    h.activePending = true;
    panel();

    for (const przełącznik of screen.getAllByRole("switch")) {
      expect(przełącznik.hasAttribute("disabled")).toBe(true);
    }
  });
});

describe("dodanie obszaru", () => {
  it("dialog jest zamknięty, dopóki nikt nie kliknie dodania", () => {
    panel();

    expect(screen.queryByTestId("dialog-content")).toBeNull();
  });

  it("nowy wpis startuje z kolejnością z OSTATNIEGO wiersza listy", () => {
    panel();
    otwórzDodawanie();

    expect(screen.getByText("adminClubs.topics.dialogCreate")).toBeTruthy();
    expect((pole("adminClubs.topics.order") as HTMLInputElement).value).toBe("40");
    expect((pole("adminClubs.topics.key") as HTMLInputElement).value).toBe("");
  });

  it("klucz PODĄŻA za nazwą polską i jedzie do mutacji znormalizowany", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.labelPl"), {
      target: { value: "  Energetyka jądrowa  " },
    });
    fireEvent.change(pole("adminClubs.topics.labelEn"), { target: { value: "  Nuclear  " } });
    expect((pole("adminClubs.topics.key") as HTMLInputElement).value).toBe("energetyka_jadrowa");

    zapisz();

    expect(h.upsertInputs).toEqual([
      {
        id: null,
        key: "energetyka_jadrowa",
        labelPl: "Energetyka jądrowa",
        labelEn: "Nuclear",
        sortOrder: 40,
        isActive: true,
      },
    ]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.topics.saved");
    expect(screen.queryByTestId("dialog-content")).toBeNull();
  });

  it("klucz TKNIĘTY ręcznie przestaje podążać za nazwą", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.key"), { target: { value: "wlasny_klucz" } });
    fireEvent.change(pole("adminClubs.topics.labelPl"), { target: { value: "Energetyka" } });
    fireEvent.change(pole("adminClubs.topics.labelEn"), { target: { value: "Energy" } });
    zapisz();

    expect(h.upsertInputs[0].key).toBe("wlasny_klucz");
  });

  it("kolejność i przełącznik aktywności jadą z formularza", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.labelPl"), { target: { value: "Energetyka" } });
    fireEvent.change(pole("adminClubs.topics.labelEn"), { target: { value: "Energy" } });
    fireEvent.change(pole("adminClubs.topics.order"), { target: { value: "125" } });
    fireEvent.click(within(dialog()).getByRole("switch"));
    zapisz();

    expect(h.upsertInputs[0]).toMatchObject({ sortOrder: 125, isActive: false });
  });

  it("treść niebędąca liczbą w polu kolejności znaczy zero, nie NaN", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.labelPl"), { target: { value: "Energetyka" } });
    fireEvent.change(pole("adminClubs.topics.labelEn"), { target: { value: "Energy" } });
    fireEvent.change(pole("adminClubs.topics.order"), { target: { value: "abc" } });
    zapisz();

    expect(h.upsertInputs[0].sortOrder).toBe(0);
  });

  it("otwarcie dodawania po edycji CZYŚCI formularz do pustego wpisu", () => {
    panel();
    fireEvent.click(
      within(screen.getByText("Energetyka").closest("li") as HTMLElement).getByRole("button", {
        name: "adminClubs.topics.edit",
      }),
    );
    expect((pole("adminClubs.topics.labelPl") as HTMLInputElement).value).toBe("Energetyka");

    fireEvent.click(screen.getByTestId("dialog-zamknij-z-zewnatrz"));
    otwórzDodawanie();

    expect((pole("adminClubs.topics.labelPl") as HTMLInputElement).value).toBe("");
    expect((pole("adminClubs.topics.labelEn") as HTMLInputElement).value).toBe("");
  });
});

describe("walidacja nie wypuszcza żądania", () => {
  it("brak nazwy angielskiej odrzuca zapis bez wołania mutacji", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.labelPl"), { target: { value: "Energetyka" } });
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.topics.errors.labels");
    expect(h.upsertInputs).toEqual([]);
    expect(screen.getByTestId("dialog-content")).toBeTruthy();
  });

  it("klucz niezgodny z CHECK-iem bazy odrzuca zapis nowego wpisu", () => {
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.labelPl"), { target: { value: "Energetyka" } });
    fireEvent.change(pole("adminClubs.topics.labelEn"), { target: { value: "Energy" } });
    fireEvent.change(pole("adminClubs.topics.key"), { target: { value: "x" } });
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.topics.errors.key");
    expect(h.upsertInputs).toEqual([]);
  });
});

describe("edycja obszaru", () => {
  it("dialog startuje z wartościami wiersza, a KLUCZ jest zablokowany", () => {
    panel();
    fireEvent.click(
      within(screen.getByText("Kultura").closest("li") as HTMLElement).getByRole("button", {
        name: "adminClubs.topics.edit",
      }),
    );

    expect(screen.getByText("adminClubs.topics.dialogEdit")).toBeTruthy();
    expect((pole("adminClubs.topics.labelPl") as HTMLInputElement).value).toBe("Kultura");
    expect((pole("adminClubs.topics.key") as HTMLInputElement).disabled).toBe(true);
  });

  it("zmiana nazwy NIE rusza klucza i jedzie z identyfikatorem wiersza", () => {
    panel();
    fireEvent.click(
      within(screen.getByText("Kultura").closest("li") as HTMLElement).getByRole("button", {
        name: "adminClubs.topics.edit",
      }),
    );

    fireEvent.change(pole("adminClubs.topics.labelPl"), {
      target: { value: "Kultura i historia" },
    });
    zapisz();

    expect(h.upsertInputs).toEqual([
      {
        id: "t3",
        key: "culture",
        labelPl: "Kultura i historia",
        labelEn: "Culture",
        sortOrder: 30,
        isActive: false,
      },
    ]);
  });
});

describe("odmowa zapisu", () => {
  it("duplikat klucza jedzie ZDANIEM ze słownika, a dialog zostaje z treścią", () => {
    h.upsertFails = 'duplicate key value violates unique constraint "club_topics_key_key"';
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.labelPl"), { target: { value: "Energetyka" } });
    fireEvent.change(pole("adminClubs.topics.labelEn"), { target: { value: "Energy" } });
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.topics.errors.duplicate");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect((pole("adminClubs.topics.labelPl") as HTMLInputElement).value).toBe("Energetyka");
  });

  it("każda inna odmowa jedzie SUROWYM tekstem z bazy", () => {
    h.upsertFails = "permission denied for function admin_club_topic_upsert";
    panel();
    otwórzDodawanie();

    fireEvent.change(pole("adminClubs.topics.labelPl"), { target: { value: "Energetyka" } });
    fireEvent.change(pole("adminClubs.topics.labelEn"), { target: { value: "Energy" } });
    zapisz();

    expect(h.toastError).toHaveBeenCalledWith(
      "permission denied for function admin_club_topic_upsert",
    );
  });

  it("trwający zapis blokuje przycisk i pokazuje wskaźnik postępu", () => {
    h.upsertPending = true;
    panel();
    otwórzDodawanie();

    const przycisk = within(dialog()).getByRole("button", { name: "adminClubs.topics.save" });
    expect(przycisk.hasAttribute("disabled")).toBe(true);
    expect(dialog().querySelector(".animate-spin")).toBeTruthy();
  });

  it("anulowanie zamyka dialog bez żądania", () => {
    panel();
    otwórzDodawanie();

    fireEvent.click(within(dialog()).getByRole("button", { name: "adminClubs.topics.cancel" }));

    expect(screen.queryByTestId("dialog-content")).toBeNull();
    expect(h.upsertInputs).toEqual([]);
  });

  it("otwarcie dialogu z zewnątrz nie tworzy wersji roboczej z niczego", () => {
    panel();

    fireEvent.click(screen.getByTestId("dialog-otworz-z-zewnatrz"));

    expect(screen.queryByTestId("dialog-content")).toBeNull();
  });
});
