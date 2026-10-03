// PASEK FILTRÓW LIST PANELU - wyszukiwanie, status, język, autor.
//
// CO DOWODZI TEN PLIK. Pasek stoi nad każdą listą treści panelu (wpisy, strony,
// media), a jego „Wyczyść" nie miał ani jednego wywołania. Kontrakty:
//   * „Wyczyść" pojawia się TYLKO przy aktywnym filtrze i zeruje WSZYSTKIE
//     filtry naraz (pojedyncze zerowanie zostawiało listę przefiltrowaną
//     po czymś, czego już nie widać);
//   * filtr ukryty (`hide*`) nie liczy się jako aktywny - inaczej przycisk
//     wisiałby nad listą bez widocznego powodu;
//   * licznik pokazuje „wynik / całość" tylko wtedy, gdy się różnią.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

import { AdminListToolbar } from "../AdminListToolbar";

afterEach(cleanup);

const AUTHORS = [
  { id: "a1-uuid-0000", display_name: "Anna", slug: "anna" },
  { id: "a2-uuid-0000", display_name: "", slug: "bartek" },
  { id: "a3-uuid-0000", display_name: "", slug: "" },
] as never;

function renderBar(props: Partial<Parameters<typeof AdminListToolbar>[0]> = {}) {
  const handlers = {
    onSearch: vi.fn(),
    onStatus: vi.fn(),
    onLang: vi.fn(),
    onAuthor: vi.fn(),
  };
  render(<AdminListToolbar search="" authors={AUTHORS} {...handlers} {...props} />);
  return handlers;
}

describe("AdminListToolbar", () => {
  it("bez filtrów nie ma przycisku „Wyczyść”", () => {
    renderBar();
    expect(screen.queryByRole("button", { name: /admin\.list\.clear/ })).toBeNull();
  });

  it("„Wyczyść” zeruje WSZYSTKIE filtry naraz", () => {
    const h = renderBar({
      search: "nato",
      status: "draft",
      lang: "pl_only",
      author: "a1-uuid-0000",
    });
    fireEvent.click(screen.getByRole("button", { name: /admin\.list\.clear/ }));
    expect(h.onSearch).toHaveBeenCalledWith("");
    expect(h.onStatus).toHaveBeenCalledWith("all");
    expect(h.onLang).toHaveBeenCalledWith("all");
    expect(h.onAuthor).toHaveBeenCalledWith("all");
  });

  it.each([
    ["status", { status: "draft", hideStatus: true }],
    ["język", { lang: "en_only", hideLang: true }],
    ["autor", { author: "a1-uuid-0000", hideAuthor: true }],
  ] as const)("ukryty filtr (%s) nie liczy się jako aktywny", (_label, props) => {
    renderBar(props);
    expect(screen.queryByRole("button", { name: /admin\.list\.clear/ })).toBeNull();
  });

  it("wpisywanie i wybory filtrów oddają wartości wołającemu", () => {
    const h = renderBar();
    fireEvent.change(screen.getByPlaceholderText("admin.list.search"), {
      target: { value: "unia" },
    });
    expect(h.onSearch).toHaveBeenCalledWith("unia");

    const [status, lang, author] = screen.getAllByRole("combobox");
    fireEvent.change(status as HTMLElement, { target: { value: "scheduled" } });
    fireEvent.change(lang as HTMLElement, { target: { value: "missing_any" } });
    fireEvent.change(author as HTMLElement, { target: { value: "a2-uuid-0000" } });
    expect(h.onStatus).toHaveBeenCalledWith("scheduled");
    expect(h.onLang).toHaveBeenCalledWith("missing_any");
    expect(h.onAuthor).toHaveBeenCalledWith("a2-uuid-0000");
  });

  it("autor bez nazwy pokazuje slug, a bez sluga - początek identyfikatora", () => {
    renderBar();
    const author = screen.getAllByRole("combobox")[2] as HTMLSelectElement;
    expect(Array.from(author.options).map((o) => o.textContent)).toEqual([
      "admin.list.author.all",
      "Anna",
      "bartek",
      "a3-uui",
    ]);
  });

  it("bez listy autorów nie ma filtra autora, a własny placeholder wygrywa", () => {
    render(
      <AdminListToolbar
        search=""
        onSearch={() => {}}
        onStatus={() => {}}
        searchPlaceholder="Szukaj stron"
      />,
    );
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByPlaceholderText("Szukaj stron")).toBeTruthy();
  });

  it("licznik: sam wynik, gdy równy całości; „wynik / całość”, gdy filtr coś ukrył", () => {
    const { rerender } = render(
      <AdminListToolbar search="" onSearch={() => {}} resultsCount={12} totalCount={12} />,
    );
    expect(screen.getByText("12")).toBeTruthy();
    rerender(
      <AdminListToolbar
        search="x"
        onSearch={() => {}}
        resultsCount={3}
        totalCount={12}
        extraRight={<span>dodatek</span>}
      />,
    );
    expect(screen.getByText("3 / 12")).toBeTruthy();
    expect(screen.getByText("dodatek")).toBeTruthy();
  });
});
