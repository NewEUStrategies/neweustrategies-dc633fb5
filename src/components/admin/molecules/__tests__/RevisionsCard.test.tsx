// Karta historii wersji wpisu/strony (`RevisionsCard`, 0% przed tą zmianą) -
// wraz z dialogiem porównania (`RevisionDiffDialog`, też 0%).
//
// Audyt 18.08 wymienił „Rewizje i przywracanie" jako funkcjonalność MODUŁU 2
// stojącą na okrągłym zerze: 10 plików, 0 z 105 funkcji. Reguły domenowe
// (limit 50, próg 5 minut, pola przywracalne) i orkiestracja serwerowa mają już
// swoje testy - tutaj testujemy WARSTWĘ, KTÓRĄ WIDZI REDAKTOR.
//
// Dwie rzeczy są tu najważniejsze:
//
//   1. WZORZEC DWÓCH KLIKNIĘĆ przy porównywaniu. Pierwszy klik „uzbraja" bazę
//      porównania, drugi porównuje. Starsza rewizja MUSI trafić na stronę
//      „przed" niezależnie od kolejności klikania - inaczej diff pokazuje
//      zmiany odwrócone (dodane jako usunięte) i redaktor przywraca nie to,
//      co chciał.
//   2. PRZYWRACANIE JEST POTWIERDZANE i nie melduje sukcesu, gdy się nie udało.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { BASE_ISO, isoOffset, revisionListItem } from "@/test/post-editor/fixtures";

const h = vi.hoisted(() => ({
  list: null as unknown,
  restore: null as unknown,
  snapshots: null as unknown,
  toast: null as unknown,
  toastError: null as unknown,
  authors: [] as Array<{ id: string; display_name: string | null; slug: string | null }>,
  confirmState: null as unknown,
  // Przechwycone callbacki dialogow - test wywoluje je tak, jak zrobilby to
  // uzytkownik klikajac w zamkniecie.
  confirmOnOpenChange: null as ((open: boolean) => void) | null,
  diffRequest: null as { ids: string[]; withCurrent: boolean; beforeLabel: string } | null,
  diffOnClose: null as (() => void) | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);

vi.mock("@tanstack/react-start", () => ({
  // Server fn oddajemy wprost - `useServerFn` w produkcji tylko je owija.
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/revisions.functions", async () => {
  const { vi: v } = await import("vitest");
  h.list = v.fn(async () => [] as unknown[]);
  h.restore = v.fn(async () => ({ ok: true as const }));
  h.snapshots = v.fn(async () => ({ revisions: [], current: null }));
  return { listRevisions: h.list, restoreRevision: h.restore, getRevisionSnapshots: h.snapshots };
});

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

vi.mock("@/lib/toastError", async () => {
  const { vi: v } = await import("vitest");
  h.toastError = v.fn();
  return { toastError: h.toastError };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: "tenant-alfa" }) }));

vi.mock("@/components/admin/hooks/useTenantAuthors", () => ({
  useTenantAuthors: () => ({ data: h.authors }),
  authorLabel: (a: { display_name?: string | null } | undefined) => a?.display_name ?? "-",
}));

// ConfirmDialog nie renderuje sie sam bez portalu Radiksa; przechwytujemy STAN,
// zeby test mogl wywolac `onConfirm` tak, jak zrobilby to klik uzytkownika.
vi.mock("@/components/admin/ConfirmDialog", () => ({
  ConfirmDialog: ({
    state,
    onOpenChange,
  }: {
    state: unknown;
    onOpenChange: (o: boolean) => void;
  }) => {
    h.confirmState = state;
    h.confirmOnOpenChange = onOpenChange;
    return null;
  },
}));

vi.mock("@/components/admin/atoms/StatusBadge", () => ({
  StatusBadge: ({ status, label }: { status: string; label: string }) => (
    <span data-testid={`status-${status}`}>{label}</span>
  ),
}));

// Dialog diffa ma wlasny plik testowy; tutaj przechwytujemy PROP, bo to on jest
// kontraktem wzorca dwoch klikniec.
vi.mock("@/components/admin/molecules/RevisionDiffDialog", () => ({
  RevisionDiffDialog: ({
    request,
    onClose,
  }: {
    request: { ids: string[]; withCurrent: boolean; beforeLabel: string } | null;
    onClose: () => void;
  }) => {
    h.diffRequest = request;
    h.diffOnClose = onClose;
    return null;
  },
}));

import { RevisionsCard } from "@/components/admin/molecules/RevisionsCard";

type Mock = ReturnType<typeof vi.fn>;
const list = () => h.list as Mock;
const restore = () => h.restore as Mock;
const toast = () => h.toast as Record<string, Mock>;
const confirmState = () =>
  h.confirmState as { title: string; onConfirm: () => Promise<void> } | null;
const diffRequest = () => h.diffRequest;

const OLDER = revisionListItem({ id: "rev-older", created_at: BASE_ISO });
const NEWER = revisionListItem({ id: "rev-newer", created_at: isoOffset(60) });

function render(props: Partial<Parameters<typeof RevisionsCard>[0]> = {}) {
  return renderWithQueryClient(
    <RevisionsCard entityType="post" entityId="post-1" onRestored={vi.fn()} {...props} />,
  );
}

beforeEach(() => {
  list().mockReset();
  list().mockResolvedValue([NEWER, OLDER]);
  restore().mockReset();
  restore().mockResolvedValue({ ok: true as const });
  (h.toastError as Mock).mockReset();
  for (const fn of Object.values(toast())) fn.mockReset();
  h.authors = [{ id: revisionListItem().author_id as string, display_name: "Anna", slug: "anna" }];
  h.confirmState = null;
  h.diffRequest = null;
  h.confirmOnOpenChange = null;
  h.diffOnClose = null;
});

// ---------------------------------------------------------------------------
// Widoczność i stany
// ---------------------------------------------------------------------------

describe("RevisionsCard - stany", () => {
  it("bez id encji karta w ogóle się nie renderuje", () => {
    // Nowy, niezapisany wpis nie ma historii - pusta karta sugerowałaby, że
    // historia jest, tylko puste.
    const { container } = render({ entityId: null });
    expect(container).toBeEmptyDOMElement();
    expect(list()).not.toHaveBeenCalled();
  });

  it("pobiera historię z LIMITEM widocznej listy, nie całą", async () => {
    render();
    await waitFor(() => expect(list()).toHaveBeenCalled());
    const args = list().mock.calls[0][0] as {
      data: { entityType: string; entityId: string; limit: number };
    };
    expect(args.data.entityType).toBe("post");
    expect(args.data.entityId).toBe("post-1");
    expect(args.data.limit).toBe(30);
  });

  it("pusta historia pokazuje komunikat, nie pustą listę", async () => {
    list().mockResolvedValue([]);
    render();
    await waitFor(() => expect(screen.getByText("admin.revisions.empty")).toBeInTheDocument());
  });

  it("lista wersji pokazuje status, autora i przetłumaczoną notatkę", async () => {
    render();
    await waitFor(() => expect(screen.getAllByTestId("status-draft").length).toBeGreaterThan(0));
    // Notatki techniczne bazy (`autosave`, `pre_restore`) muszą być tłumaczone -
    // redaktor nie ma powodu widzieć wewnętrznych identyfikatorów.
    expect(screen.getAllByText(/admin\.revisions\.note\.autosave/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Anna/).length).toBeGreaterThan(0);
  });

  it("nieznana notatka przechodzi w oryginale (nie gubi informacji)", async () => {
    list().mockResolvedValue([revisionListItem({ note: "import-wordpress" })]);
    render();
    await waitFor(() => expect(screen.getByText(/import-wordpress/)).toBeInTheDocument());
  });

  it("wersja bez statusu nie renderuje plakietki statusu", async () => {
    list().mockResolvedValue([revisionListItem({ status: null })]);
    render();
    await waitFor(() => expect(list()).toHaveBeenCalled());
    expect(screen.queryByTestId(/^status-/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wzorzec dwóch kliknięć przy porównywaniu
// ---------------------------------------------------------------------------

describe("RevisionsCard - porównywanie wersji", () => {
  async function compareButtons() {
    render();
    await waitFor(() => expect(screen.getAllByTitle(/revisionDiff/).length).toBeGreaterThan(0));
    return screen
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("title") ?? "").includes("revisionDiff"));
  }

  it("pierwszy klik UZBRAJA bazę porównania i pokazuje pasek podpowiedzi", async () => {
    const buttons = await compareButtons();
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(screen.getByText(/revisionDiff\.armedHint/)).toBeInTheDocument());
    // Uzbrojony przycisk jest wciśnięty - to jedyny wizualny ślad stanu.
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    // Samo uzbrojenie NIE otwiera jeszcze diffa.
    expect(diffRequest()).toBeNull();
  });

  it("klik w TĘ SAMĄ wersję rozbraja (wyjście z trybu porównania)", async () => {
    const buttons = await compareButtons();
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(buttons[0]).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(buttons[0]);

    await waitFor(() => expect(buttons[0]).toHaveAttribute("aria-pressed", "false"));
    expect(diffRequest()).toBeNull();
  });

  it("STARSZA wersja trafia na stronę „przed” niezależnie od kolejności klikania", async () => {
    // To jest sedno tego bloku. Lista jest posortowana od najnowszej, więc
    // klikając „z góry na dół" redaktor uzbraja NOWSZĄ, a porównuje ze STARSZĄ.
    // Bez normalizacji kolejności diff pokazywałby zmiany odwrócone - dodany
    // akapit jako usunięty - i redaktor przywróciłby nie to, co chciał.
    const buttons = await compareButtons();
    // buttons[0] = NEWER (pierwszy na liście), buttons[1] = OLDER
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(diffRequest()).not.toBeNull());
    expect(diffRequest()?.ids).toEqual(["rev-older", "rev-newer"]);
    expect(diffRequest()?.withCurrent).toBe(false);
  });

  it("kolejność odwrotna daje TEN SAM wynik", async () => {
    const buttons = await compareButtons();
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(diffRequest()).not.toBeNull());
    expect(diffRequest()?.ids).toEqual(["rev-older", "rev-newer"]);
  });

  it("„porównaj z bieżącą” zamawia diff jednej rewizji ze stanem żywym", async () => {
    const buttons = await compareButtons();
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getByText(/armedHint/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("adminPostPanes.revisionDiff.withCurrent"));

    await waitFor(() => expect(diffRequest()).not.toBeNull());
    expect(diffRequest()?.ids).toEqual(["rev-newer"]);
    expect(diffRequest()?.withCurrent).toBe(true);
  });

  it("„anuluj” rozbraja bez otwierania diffa", async () => {
    const buttons = await compareButtons();
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getByText(/armedHint/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("adminPostPanes.revisionDiff.cancel"));

    await waitFor(() => expect(screen.queryByText(/armedHint/)).toBeNull());
    expect(diffRequest()).toBeNull();
  });

  it("podpowiedź przycisku zmienia się, gdy baza porównania jest uzbrojona", async () => {
    const buttons = await compareButtons();
    // Przed uzbrojeniem: „porównaj".
    expect(buttons[1].getAttribute("title")).toBe("adminPostPanes.revisionDiff.compare");

    fireEvent.click(buttons[0]);

    // Po uzbrojeniu INNE wersje zapraszają do porównania z uzbrojoną.
    await waitFor(() =>
      expect(buttons[1].getAttribute("title")).toBe("adminPostPanes.revisionDiff.compareWithArmed"),
    );
  });
});

// ---------------------------------------------------------------------------
// Przywracanie
// ---------------------------------------------------------------------------

describe("RevisionsCard - przywracanie", () => {
  async function restoreButtons() {
    render();
    await waitFor(() => expect(screen.getAllByTitle("admin.revisions.restore").length).toBe(2));
    return screen.getAllByTitle("admin.revisions.restore");
  }

  it("klik NIE przywraca od razu - najpierw pytanie z datą wersji", async () => {
    // Przywracanie nadpisuje treść na żywym wpisie. Brak potwierdzenia znaczyłby,
    // że jedno omyłkowe kliknięcie podmienia opublikowany artykuł.
    const buttons = await restoreButtons();
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(confirmState()).not.toBeNull());
    expect(confirmState()?.title).toBe("admin.revisions.confirmTitle");
    expect(restore()).not.toHaveBeenCalled();
  });

  it("potwierdzenie przywraca WŁAŚCIWĄ wersję i melduje sukces", async () => {
    const onRestored = vi.fn();
    render({ onRestored });
    await waitFor(() => expect(screen.getAllByTitle("admin.revisions.restore").length).toBe(2));
    fireEvent.click(screen.getAllByTitle("admin.revisions.restore")[1]);
    await waitFor(() => expect(confirmState()).not.toBeNull());

    await confirmState()!.onConfirm();

    expect(restore()).toHaveBeenCalledWith({ data: { id: "rev-older" } });
    expect(toast().success).toHaveBeenCalledWith("admin.revisions.restored");
    // Host (edytor) musi się dowiedzieć, żeby przeładować formularz.
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
  });

  it("nieudane przywrócenie: błąd i BRAK meldunku o sukcesie", async () => {
    restore().mockRejectedValue(new Error("odmowa"));
    const onRestored = vi.fn();
    render({ onRestored });
    await waitFor(() => expect(screen.getAllByTitle("admin.revisions.restore").length).toBe(2));
    fireEvent.click(screen.getAllByTitle("admin.revisions.restore")[0]);
    await waitFor(() => expect(confirmState()).not.toBeNull());

    await confirmState()!.onConfirm();

    expect(h.toastError as Mock).toHaveBeenCalled();
    expect(toast().success).not.toHaveBeenCalled();
    // Host NIE przeładowuje formularza - treść w edytorze zostaje bez zmian.
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("odświeża listę wersji po przywróceniu (powstała migawka pre_restore)", async () => {
    render();
    // Czekamy na WYRENDEROWANA liste, nie na samo wywolanie zapytania - inaczej
    // klikamy w przycisk, ktorego jeszcze nie ma.
    await waitFor(() => expect(screen.getAllByTitle("admin.revisions.restore").length).toBe(2));
    const callsBefore = list().mock.calls.length;
    fireEvent.click(screen.getAllByTitle("admin.revisions.restore")[0]);
    await waitFor(() => expect(confirmState()).not.toBeNull());

    await confirmState()!.onConfirm();

    // Serwer robi migawkę bezpieczeństwa PRZED nadpisaniem, więc historia
    // urosła - lista bez odświeżenia byłaby nieaktualna od razu po akcji.
    await waitFor(() => expect(list().mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe("RevisionsCard - zamykanie dialogów", () => {
  it("zamknięcie pytania o przywrócenie CZYŚCI stan (nie zostaje uzbrojone)", async () => {
    // Bez wyzerowania stanu następne otwarcie pokazałoby datę POPRZEDNIEJ
    // wersji - albo dialog otworzyłby się sam przy kolejnym renderze.
    render();
    await waitFor(() => expect(screen.getAllByTitle("admin.revisions.restore").length).toBe(2));
    fireEvent.click(screen.getAllByTitle("admin.revisions.restore")[0]);
    await waitFor(() => expect(confirmState()).not.toBeNull());

    const onOpenChange = (h as { confirmOnOpenChange?: (o: boolean) => void }).confirmOnOpenChange!;
    await waitFor(() => expect(onOpenChange).toBeTypeOf("function"));
    act(() => onOpenChange(false));

    await waitFor(() => expect(confirmState()).toBeNull());
    expect(restore()).not.toHaveBeenCalled();
  });

  it("`onOpenChange(true)` NIE czyści stanu (dialog zostaje otwarty)", async () => {
    render();
    await waitFor(() => expect(screen.getAllByTitle("admin.revisions.restore").length).toBe(2));
    fireEvent.click(screen.getAllByTitle("admin.revisions.restore")[0]);
    await waitFor(() => expect(confirmState()).not.toBeNull());

    const onOpenChange = (h as { confirmOnOpenChange?: (o: boolean) => void }).confirmOnOpenChange!;
    act(() => onOpenChange(true));

    expect(confirmState()).not.toBeNull();
  });

  it("zamknięcie dialogu porównania czyści żądanie diffa", async () => {
    render();
    await waitFor(() => expect(screen.getAllByTitle(/revisionDiff/).length).toBeGreaterThan(0));
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("title") ?? "").includes("revisionDiff"));
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(diffRequest()).not.toBeNull());

    const onClose = h.diffOnClose!;
    act(() => onClose());

    // Bez wyzerowania dialog otwierałby się ponownie przy każdym renderze karty.
    await waitFor(() => expect(diffRequest()).toBeNull());
  });

  it("licznik wersji w nagłówku pojawia się tylko przy niepustej historii", async () => {
    list().mockResolvedValue([]);
    const { unmount } = render();
    await waitFor(() => expect(screen.getByText("admin.revisions.empty")).toBeInTheDocument());
    // Pusta historia: bez „(0)" w nagłówku - zero w nawiasie wygląda jak błąd.
    expect(screen.queryByText("(0)")).toBeNull();
    unmount();

    list().mockResolvedValue([NEWER, OLDER]);
    render();
    await waitFor(() => expect(screen.getByText("(2)")).toBeInTheDocument());
  });

  it("strona `page` pobiera historię tej samej encji, ale innego typu", async () => {
    render({ entityType: "page", entityId: "page-9" });
    await waitFor(() => expect(list()).toHaveBeenCalled());
    const args = list().mock.calls[0][0] as { data: { entityType: string; entityId: string } };
    expect(args.data.entityType).toBe("page");
    expect(args.data.entityId).toBe("page-9");
  });
});
