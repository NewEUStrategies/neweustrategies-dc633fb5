// Panel źródeł w prawej szynie huba.
//
// CO TEN TEST PILNUJE. Panel składa dwie obietnice, których nie da się sprawdzić
// na czystej funkcji: że tytuł wątku stoi POD swoim działem (a nie pod cudzym)
// i że nazwa działu jest kontrolką zawężającą strumień. Obie łatwo złamać przy
// przestawianiu znaczników, a obie widać dopiero na zrenderowanym drzewie.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pl" } }),
}));

// <Link> czyta kontekst routera - w teście prezentacyjnym podmieniamy go na
// zwykłą kotwicę (współdzielony stub), żeby nie stawiać RouterProvidera.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubThreadSourcesPanel } from "@/components/clubs/molecules/ClubThreadSources";
import type { ClubGroupRow, ClubThreadListRow } from "@/lib/clubs/types";

function group(id: string, namePl: string): ClubGroupRow {
  return {
    id,
    slug: id,
    name_pl: namePl,
    name_en: namePl,
    icon: null,
    accent_color: null,
    thread_count: 1,
    can_read: true,
  } as unknown as ClubGroupRow;
}

function thread(id: string, groupId: string | null, title: string, stamp: string) {
  return {
    id,
    slug: id,
    title,
    group_id: groupId,
    group_name_pl: null,
    group_name_en: null,
    created_at: stamp,
    last_reply_at: null,
    reply_count: 3,
    is_unread: false,
  } as unknown as ClubThreadListRow;
}

const GROUPS = [group("g1", "Architektura bezpieczeństwa"), group("g2", "Kuluary")];

const THREADS = [
  thread("t1", "g2", "Rozmowa kuluarowa", "2026-08-09T10:00:00+00:00"),
  thread("t2", "g1", "Wschodnia flanka", "2026-08-08T10:00:00+00:00"),
  thread("t3", "g1", "Odstraszanie", "2026-08-07T10:00:00+00:00"),
];

function renderPanel(props: Partial<Parameters<typeof ClubThreadSourcesPanel>[0]> = {}) {
  const onGroupChange = vi.fn();
  const view = render(
    <ClubThreadSourcesPanel
      clubSlug="klub"
      threads={THREADS}
      groups={GROUPS}
      activeGroupId={null}
      onGroupChange={onGroupChange}
      isPl
      {...props}
    />,
  );
  return { ...view, onGroupChange };
}

/** Element listy odpowiadający jednemu źródłu - po nazwie działu w nagłówku. */
function sourceBlock(name: string): HTMLElement {
  const heading = screen.getByText(name);
  const block = heading.closest("li");
  expect(block).not.toBeNull();
  return block as HTMLElement;
}

describe("ClubThreadSourcesPanel", () => {
  it("stawia tytuły wątków pod ich własnym działem", () => {
    renderPanel();

    const security = sourceBlock("Architektura bezpieczeństwa");
    expect(within(security).getByText("Wschodnia flanka")).toBeInTheDocument();
    expect(within(security).getByText("Odstraszanie")).toBeInTheDocument();
    expect(within(security).queryByText("Rozmowa kuluarowa")).toBeNull();

    const lobby = sourceBlock("Kuluary");
    expect(within(lobby).getByText("Rozmowa kuluarowa")).toBeInTheDocument();
    expect(within(lobby).queryByText("Wschodnia flanka")).toBeNull();
  });

  it("prowadzi z tytułu do wątku, a nie do klubu", () => {
    renderPanel();
    expect(screen.getByText("Wschodnia flanka").closest("a")).toHaveAttribute(
      "href",
      "/club/klub/t/t2",
    );
  });

  it("porządkuje źródła po świeżości - najnowszy dział pierwszy", () => {
    renderPanel();
    // Bez zawężenia jedynymi przyciskami panelu są nagłówki źródeł.
    const names = screen.getAllByRole("button").map((node) => node.textContent ?? "");
    expect(names[0]).toContain("Kuluary");
    expect(names[1]).toContain("Architektura bezpieczeństwa");
  });

  it("zawęża strumień kliknięciem w nazwę działu i zdejmuje zawężenie ponownym", () => {
    const { onGroupChange, rerender } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Kuluary/ }));
    expect(onGroupChange).toHaveBeenCalledWith("g2");

    rerender(
      <ClubThreadSourcesPanel
        clubSlug="klub"
        threads={THREADS}
        groups={GROUPS}
        activeGroupId="g2"
        onGroupChange={onGroupChange}
        isPl
      />,
    );
    const active = screen.getByRole("button", { name: /Kuluary/ });
    expect(active).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(active);
    expect(onGroupChange).toHaveBeenLastCalledWith(null);
  });

  it("kubełek 'poza działami' nie udaje kontrolki zawężenia", () => {
    renderPanel({
      threads: [thread("t9", null, "Wątek bez działu", "2026-08-09T10:00:00+00:00")],
    });
    // Nagłówek jest, ale nie jako przycisk - nie ma czego zawęzić.
    expect(screen.getByText("club.hub.sources.unassigned")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unassigned/ })).toBeNull();
  });

  it("znika w całości, gdy w klubie nie ma jeszcze wątków", () => {
    const { container } = renderPanel({ threads: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("nie chowa działów po cichu - mówi, ile ich zostało, i pokazuje je na żądanie", () => {
    const many = ["g1", "g2", "g3", "g4", "g5", "g6"].map((id, i) => group(id, `Dział ${i + 1}`));
    // Malejące znaczniki czasu, żeby kolejność źródeł była przewidywalna.
    const threads = many.map((g, i) =>
      thread(`t${i}`, g.id, `Wątek ${i}`, `2026-08-0${9 - i}T10:00:00+00:00`),
    );

    renderPanel({ threads, groups: many });

    // Cztery widoczne, dwa schowane - i to jest NAPISANE, a nie domyślne.
    expect(screen.queryByText("Dział 5")).toBeNull();
    const toggle = screen.getByRole("button", { name: /club.hub.sources.more/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByText("Dział 5")).toBeInTheDocument();
    expect(screen.getByText("Dział 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /club.hub.sources.less/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
