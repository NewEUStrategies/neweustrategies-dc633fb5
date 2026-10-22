// Dialog konfliktu szkicu ścieżki (S8.3a) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Różnice lokalny vs serwer: tylko sekcje ze zmianami (nagłówki h3),
//      linie stabilnego JSON-u ze znakiem i opisem dla czytnika („+” moje,
//      „−” z innej karty), niezmienione ciągi zwinięte z liczbą wierszy,
//      data zapisu wersji serwera w opisie; przewijany obszar dostępny z
//      klawiatury. Bez różnic treści - zdanie zamiast pustej listy.
//   2. Wersja serwera jeszcze się wczytuje -> komunikat `status`, decyzje
//      wyłączone (nie ma czego zachować ani wziąć).
//   3. „Zachowaj moje”: stan zapisu, zamknięcie po sukcesie, komunikat
//      `alert` po porażce (dialog zostaje). „Weź wersję z innej karty”
//      woła rozstrzygnięcie i zamyka.
//   4. Dostępny dialog: rola i nazwa z tytułu, fokus wewnątrz po otwarciu,
//      Esc zamyka BEZ rozstrzygnięcia; axe bez naruszeń (PL i EN).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  t: null as unknown,
  lang: "pl" as "pl" | "en",
}));

// Fabryka nic nie importuje (import słownika testowego w fabryce zakleszcza
// `react-i18next`); `t` wpinamy po importach.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t, i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));

import { JourneyConflictDialog, type JourneyConflictDialogProps } from "../JourneyConflictDialog";
import type {
  JourneyEditorConflict,
  JourneyEditorValue,
  JourneyServerSnapshot,
} from "@/lib/admin/journeys/editorSession";
import { emptyJourneyGraph, type JourneyDraft } from "@/lib/journeys/graph";
import { formatDateTime } from "@/lib/i18n/format";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";

const TOKEN = "2026-10-21T10:15:00.123456+00:00";
const T = { pl: realT("pl"), en: realT("en") };

/** Łańcuch `count` kroków czekania - długi graf daje zwinięty kontekst. */
function chain(count: number): JourneyDraft {
  const ids = Array.from({ length: count }, (_, i) => `w${i + 1}`);
  const order = ["trigger", ...ids, "exit"];
  return {
    graph: {
      nodes: [
        ...emptyJourneyGraph().nodes,
        ...ids.map((id) => ({
          id,
          type: "wait" as const,
          params: { mode: "duration", minutes: 60 },
        })),
      ],
      edges: order.slice(1).map((to, i) => ({ from: order[i], to, branch: "next" as const })),
    },
    settings: { triggerEventType: "account.registered.v1" },
  };
}

function value(draft: JourneyDraft, name: string): JourneyEditorValue {
  return { draft, definition: { name, description: "", category: "marketing", legalBasis: "" } };
}

function server(editorValue: JourneyEditorValue): JourneyServerSnapshot {
  return {
    token: TOKEN,
    definition: editorValue.definition,
    draft: editorValue.draft,
    draftRaw: editorValue.draft,
    draftState: "valid",
    draftIssue: null,
    archived: false,
    value: editorValue,
  };
}

const LOCAL = value(chain(9), "Powitanie");
const SERVER = server(value(chain(8), "Powitanie z innej karty"));
const CONFLICT: JourneyEditorConflict = { local: LOCAL, server: SERVER };

function renderDialog(overrides: Partial<JourneyConflictDialogProps> = {}) {
  const props: JourneyConflictDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    conflict: CONFLICT,
    onKeepMine: vi.fn(async () => true),
    onTakeServer: vi.fn(),
    ...overrides,
  };
  render(<JourneyConflictDialog {...props} />);
  return { props, dialog: screen.getByRole("dialog") };
}

beforeEach(() => {
  h.lang = "pl";
  h.t = T.pl;
});

afterEach(() => cleanup());

describe("JourneyConflictDialog", () => {
  it("pokazuje sekcje ze zmianami, znaki i opisy linii, zwinięty kontekst i datę wersji serwera", async () => {
    const t = T.pl;
    const { dialog } = renderDialog();
    expect(dialog).toHaveAccessibleName(t("adminJourneys.editor.conflict.title"));
    expect(dialog).toHaveAccessibleDescription(
      t("adminJourneys.editor.conflict.description", { date: formatDateTime(TOKEN, "pl") }),
    );
    const headings = within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      t("adminJourneys.editor.conflict.sections.definition"),
      t("adminJourneys.editor.conflict.sections.nodes"),
      t("adminJourneys.editor.conflict.sections.edges"),
    ]);

    const definition = within(dialog).getByRole("region", {
      name: t("adminJourneys.editor.conflict.sections.definition"),
    });
    expect(definition).toHaveAttribute("tabindex", "0");
    const lines = within(definition)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(lines).toContain(
      `− ${t("adminJourneys.editor.conflict.legendServer")}: name: "Powitanie z innej karty"`,
    );
    expect(lines).toContain(
      `+ ${t("adminJourneys.editor.conflict.legendMine")}: name: "Powitanie"`,
    );

    const nodes = within(dialog).getByRole("region", {
      name: t("adminJourneys.editor.conflict.sections.nodes"),
    });
    expect(nodes).toHaveTextContent(t("adminJourneys.editor.conflict.unchanged", { count: 8 }));
    expect(nodes).toHaveTextContent(
      '{"id":"w9","params":{"minutes":60,"mode":"duration"},"type":"wait"}',
    );

    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("wersja serwera w drodze: komunikat stanu i wyłączone decyzje", async () => {
    const t = T.pl;
    const { dialog } = renderDialog({ conflict: { local: LOCAL, server: null } });
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      t("adminJourneys.editor.conflict.loading"),
    );
    expect(
      within(dialog).getByRole("button", { name: t("adminJourneys.editor.conflict.keepMine") }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: t("adminJourneys.editor.conflict.takeServer") }),
    ).toBeDisabled();
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("bez różnic treści: zdanie zamiast pustej listy", () => {
    const { dialog } = renderDialog({ conflict: { local: LOCAL, server: server(LOCAL) } });
    expect(dialog).toHaveTextContent(T.pl("adminJourneys.editor.conflict.noDifferences"));
    expect(within(dialog).queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  it("„Zachowaj moje”: stan zapisu, zamknięcie po sukcesie; opis skutku przy przycisku", async () => {
    const t = T.pl;
    let resolve: (saved: boolean) => void = () => {};
    const onKeepMine = vi.fn(() => new Promise<boolean>((done) => (resolve = done)));
    const { props, dialog } = renderDialog({ onKeepMine });
    const keep = within(dialog).getByRole("button", {
      name: t("adminJourneys.editor.conflict.keepMine"),
    });
    expect(keep).toHaveAccessibleDescription(t("adminJourneys.editor.conflict.keepMineHint"));
    fireEvent.click(keep);
    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(
      await within(dialog).findByRole("button", {
        name: t("adminJourneys.editor.conflict.saving"),
      }),
    ).toBeDisabled();
    resolve(true);
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it("„Zachowaj moje” nieudane: komunikat alert, dialog otwarty, decyzje znów dostępne", async () => {
    const t = T.pl;
    const { props, dialog } = renderDialog({ onKeepMine: vi.fn(async () => false) });
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("adminJourneys.editor.conflict.keepMine") }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      t("adminJourneys.editor.conflict.keepFailed"),
    );
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(
      within(dialog).getByRole("button", { name: t("adminJourneys.editor.conflict.keepMine") }),
    ).toBeEnabled();
  });

  it("„Weź wersję z innej karty”: rozstrzygnięcie i zamknięcie", () => {
    const t = T.pl;
    const { props, dialog } = renderDialog();
    const take = within(dialog).getByRole("button", {
      name: t("adminJourneys.editor.conflict.takeServer"),
    });
    expect(take).toHaveAccessibleDescription(t("adminJourneys.editor.conflict.takeServerHint"));
    fireEvent.click(take);
    expect(props.onTakeServer).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onKeepMine).not.toHaveBeenCalled();
  });

  it("fokus wewnątrz po otwarciu, Esc zamyka bez rozstrzygnięcia", async () => {
    const { props, dialog } = renderDialog();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(props.onTakeServer).not.toHaveBeenCalled();
    expect(props.onKeepMine).not.toHaveBeenCalled();
  });

  it("bez konfliktu dialog się nie renderuje, nawet przy open", () => {
    render(
      <JourneyConflictDialog
        open
        onOpenChange={vi.fn()}
        conflict={null}
        onKeepMine={vi.fn(async () => true)}
        onTakeServer={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("po angielsku: tytuł, sekcje i przyciski ze słownika EN, axe bez naruszeń", async () => {
    h.lang = "en";
    h.t = T.en;
    const t = T.en;
    const { dialog } = renderDialog();
    expect(dialog).toHaveAccessibleName(t("adminJourneys.editor.conflict.title"));
    expect(
      within(dialog).getByRole("button", { name: t("adminJourneys.editor.conflict.keepMine") }),
    ).toBeInTheDocument();
    expect(t("adminJourneys.editor.conflict.title")).not.toBe(
      T.pl("adminJourneys.editor.conflict.title"),
    );
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
