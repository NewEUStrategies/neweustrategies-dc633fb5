// Dialog wizualnego porównania rewizji (`RevisionDiffDialog`, 0% przed zmianą).
//
// Sama LOGIKA porównania (`lib/content/revisionDiff`) jest czysta i pokryta na
// 97,9% - nie powtarzamy jej tutaj. Ten plik testuje warstwę, która stoi między
// nią a redaktorem, czyli trzy rzeczy:
//
//   1. WYBÓR STRON PORÓWNANIA. Serwer zwraca rewizje ROSNĄCO po dacie, a strona
//      „po" to albo nowsza rewizja, albo stan bieżący. Pomyłka w tym wyborze
//      pokazuje diff odwrócony - dodany akapit jako usunięty.
//   2. ZBYT MAŁO DANYCH TO BŁĄD, NIE PUSTY DIFF. Gdy jedna z rewizji nie została
//      zwrócona (cichy filtr RLS), „brak zmian" byłby kłamstwem: redaktor
//      uznałby, że wersje są identyczne, i nie przywrócił niczego.
//   3. STANY DIALOGU: ładowanie, błąd, brak różnic, różnice.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { RevisionDiffRequest } from "@/components/admin/molecules/RevisionDiffDialog";

const h = vi.hoisted(() => ({ snapshots: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));

vi.mock("@/lib/revisions.functions", async () => {
  const { vi: v } = await import("vitest");
  h.snapshots = v.fn(async () => ({ revisions: [], current: null }));
  return { getRevisionSnapshots: h.snapshots };
});

import { RevisionDiffDialog } from "@/components/admin/molecules/RevisionDiffDialog";

type Mock = ReturnType<typeof vi.fn>;
const snapshots = () => h.snapshots as Mock;

const OLD_SNAPSHOT = { title_pl: "Stary tytuł", content_pl: "<p>Pierwsza wersja</p>" };
const NEW_SNAPSHOT = { title_pl: "Nowy tytuł", content_pl: "<p>Druga wersja</p>" };

function request(overrides: Partial<RevisionDiffRequest> = {}): RevisionDiffRequest {
  return {
    entityType: "post",
    entityId: "post-1",
    ids: ["rev-older", "rev-newer"],
    withCurrent: false,
    beforeLabel: "18.08.2026, 10:00",
    afterLabel: "18.08.2026, 11:00",
    ...overrides,
  };
}

function render(req: RevisionDiffRequest | null = request()) {
  return renderWithQueryClient(<RevisionDiffDialog request={req} onClose={vi.fn()} />);
}

beforeEach(() => {
  snapshots().mockReset();
  snapshots().mockResolvedValue({
    revisions: [
      {
        id: "rev-older",
        created_at: "2026-08-18T10:00:00.000Z",
        note: null,
        snapshot: OLD_SNAPSHOT,
      },
      {
        id: "rev-newer",
        created_at: "2026-08-18T11:00:00.000Z",
        note: null,
        snapshot: NEW_SNAPSHOT,
      },
    ],
    current: null,
  });
});

describe("RevisionDiffDialog - kiedy w ogóle pyta serwer", () => {
  it("bez żądania NIE pobiera migawek", () => {
    render(null);
    expect(snapshots()).not.toHaveBeenCalled();
  });

  it("z żądaniem przekazuje dokładnie to, o co poprosiła karta wersji", async () => {
    render(request());
    await waitFor(() => expect(snapshots()).toHaveBeenCalled());
    const args = snapshots().mock.calls[0][0] as {
      data: { entityType: string; entityId: string; ids: string[]; withCurrent: boolean };
    };
    expect(args.data).toEqual({
      entityType: "post",
      entityId: "post-1",
      ids: ["rev-older", "rev-newer"],
      withCurrent: false,
    });
  });

  it("„porównaj z bieżącym” zamawia JEDNĄ rewizję plus stan żywy", async () => {
    render(request({ ids: ["rev-older"], withCurrent: true }));
    await waitFor(() => expect(snapshots()).toHaveBeenCalled());
    const args = snapshots().mock.calls[0][0] as { data: { ids: string[]; withCurrent: boolean } };
    expect(args.data.ids).toEqual(["rev-older"]);
    expect(args.data.withCurrent).toBe(true);
  });
});

describe("RevisionDiffDialog - wybór stron porównania", () => {
  it("dwie rewizje: starsza jako „przed”, nowsza jako „po”", async () => {
    render(request());
    // Dwa pola sie zmienily (tytul i tresc), wiec etykiet jest wiecej niz jedna.
    await waitFor(() =>
      expect(screen.getAllByText(/revisionDiff\.fields\./).length).toBeGreaterThan(1),
    );
    // Zmiana tytułu musi być widoczna w kierunku stary -> nowy.
    expect(screen.getByText("Stary tytuł")).toBeInTheDocument();
    expect(screen.getByText("Nowy tytuł")).toBeInTheDocument();
  });

  it("rewizja + stan bieżący: stan bieżący jest stroną „po”", async () => {
    snapshots().mockResolvedValue({
      revisions: [
        {
          id: "rev-older",
          created_at: "2026-08-18T10:00:00.000Z",
          note: null,
          snapshot: OLD_SNAPSHOT,
        },
      ],
      current: { title_pl: "Wersja żywa" },
    });
    render(request({ ids: ["rev-older"], withCurrent: true }));

    await waitFor(() => expect(screen.getByText("Wersja żywa")).toBeInTheDocument());
    expect(screen.getByText("Stary tytuł")).toBeInTheDocument();
  });

  it("migawka `null` w rewizji nie wysypuje porównania", async () => {
    snapshots().mockResolvedValue({
      revisions: [
        { id: "a", created_at: "2026-08-18T10:00:00.000Z", note: null, snapshot: null },
        { id: "b", created_at: "2026-08-18T11:00:00.000Z", note: null, snapshot: NEW_SNAPSHOT },
      ],
      current: null,
    });
    render(request({ ids: ["a", "b"] }));

    // Uszkodzony wiersz historii nadal daje czytelny wynik zamiast wyjątku.
    await waitFor(() => expect(screen.getByText("Nowy tytuł")).toBeInTheDocument());
  });
});

describe("RevisionDiffDialog - stany", () => {
  it("ładowanie: komunikat, nie pusty dialog", async () => {
    snapshots().mockImplementation(() => new Promise(() => {}));
    render();
    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.revisionDiff.loading")).toBeInTheDocument(),
    );
  });

  it("ZBYT MAŁO migawek to BŁĄD, nie „brak zmian”", async () => {
    // Tak wygląda cichy filtr RLS: serwer nic nie zgłasza, tylko zwraca mniej
    // wierszy. „Brak zmian" byłby wtedy kłamstwem - redaktor uznałby, że wersje
    // są identyczne, i nie przywrócił niczego.
    snapshots().mockResolvedValue({
      revisions: [
        {
          id: "rev-older",
          created_at: "2026-08-18T10:00:00.000Z",
          note: null,
          snapshot: OLD_SNAPSHOT,
        },
      ],
      current: null,
    });
    render(request({ ids: ["rev-older", "rev-newer"] }));

    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.revisionDiff.error")).toBeInTheDocument(),
    );
    expect(screen.queryByText("adminPostPanes.revisionDiff.noChanges")).toBeNull();
  });

  it("błąd serwera pokazuje komunikat błędu", async () => {
    snapshots().mockRejectedValue(new Error("access denied"));
    render();
    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.revisionDiff.error")).toBeInTheDocument(),
    );
  });

  it("identyczne migawki: „brak różnic”, nie pusty ekran", async () => {
    snapshots().mockResolvedValue({
      revisions: [
        { id: "a", created_at: "2026-08-18T10:00:00.000Z", note: null, snapshot: OLD_SNAPSHOT },
        { id: "b", created_at: "2026-08-18T11:00:00.000Z", note: null, snapshot: OLD_SNAPSHOT },
      ],
      current: null,
    });
    render(request({ ids: ["a", "b"] }));

    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.revisionDiff.noChanges")).toBeInTheDocument(),
    );
  });

  it("nagłówek dialogu wymienia obie porównywane strony", async () => {
    render(request({ beforeLabel: "wersja A", afterLabel: "wersja B" }));
    await waitFor(() => expect(snapshots()).toHaveBeenCalled());
    // Bez etykiet redaktor nie wie, którą parę wersji właśnie oglada.
    const subtitle = screen.getByText(/revisionDiff\.subtitle/);
    expect(subtitle.textContent).toContain("wersja A");
    expect(subtitle.textContent).toContain("wersja B");
  });
});

describe("RevisionDiffDialog - prezentacja różnic", () => {
  it("pole tekstowe pokazuje diff liniowy z oznaczeniem dodane/usunięte", async () => {
    snapshots().mockResolvedValue({
      revisions: [
        {
          id: "a",
          created_at: "2026-08-18T10:00:00.000Z",
          note: null,
          snapshot: { content_pl: "<p>Linia pierwsza</p>" },
        },
        {
          id: "b",
          created_at: "2026-08-18T11:00:00.000Z",
          note: null,
          snapshot: { content_pl: "<p>Linia pierwsza</p><p>Linia druga</p>" },
        },
      ],
      current: null,
    });
    render(request({ ids: ["a", "b"] }));

    await waitFor(() => expect(screen.getByText(/Linia druga/)).toBeInTheDocument());
  });

  it("puste pole po jednej stronie jest oznaczone jako brak wartości", async () => {
    // Bez tego oznaczenia usunięcie zajawki wyglądałoby jak brak zmiany.
    snapshots().mockResolvedValue({
      revisions: [
        {
          id: "a",
          created_at: "2026-08-18T10:00:00.000Z",
          note: null,
          snapshot: { title_pl: "Był tytuł" },
        },
        { id: "b", created_at: "2026-08-18T11:00:00.000Z", note: null, snapshot: { title_pl: "" } },
      ],
      current: null,
    });
    render(request({ ids: ["a", "b"] }));

    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.revisionDiff.emptyValue")).toBeInTheDocument(),
    );
  });
});
