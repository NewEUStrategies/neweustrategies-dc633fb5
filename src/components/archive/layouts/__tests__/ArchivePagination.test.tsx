// Kontrakt SEO linkowej paginacji archiwów: z `hrefFor` elementy są
// PRAWDZIWYMI <a href> (crawler podąża po ?page=N - przyciski onClick są dla
// niego niewidzialne), lewy klik bez modyfikatorów biegnie przez SPA
// (onPageChange + preventDefault), a klik z modyfikatorem zachowuje natywne
// zachowanie przeglądarki (nowa karta / kopiuj link). Bez `hrefFor`
// (podgląd admina) wariant przyciskowy zostaje bez zmian.
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { ArchivePagination } from "@/components/archive/layouts/ArchivePagination";

const t = ((key: string, opts?: { defaultValue?: string }) =>
  opts?.defaultValue ?? key) as unknown as TFunction;

const hrefFor = (page: number) => (page > 1 ? `/blog?page=${page}` : "/blog");

afterEach(cleanup);

describe("ArchivePagination", () => {
  it("renders crawlable anchors with canonical hrefs and rel prev/next", () => {
    render(
      <ArchivePagination
        page={2}
        totalPages={3}
        onPageChange={() => {}}
        isPending={false}
        lang="pl"
        t={t}
        hrefFor={hrefFor}
      />,
    );
    // Strona 1 linkuje do czystego adresu archiwum - bez duplikatu ?page=1.
    expect(screen.getByRole("link", { name: "Strona 1" })).toHaveAttribute("href", "/blog");
    expect(screen.getByRole("link", { name: "Strona 3" })).toHaveAttribute("href", "/blog?page=3");
    expect(screen.getByRole("link", { name: "Poprzednia strona" })).toHaveAttribute("rel", "prev");
    expect(screen.getByRole("link", { name: "Następna strona" })).toHaveAttribute("rel", "next");
    // Strona bieżąca nie jest linkiem - przycisk z aria-current="page".
    expect(screen.getByRole("button", { name: "Strona 2" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("routes plain left-clicks through onPageChange and keeps modified clicks native", () => {
    const onPageChange = vi.fn();
    render(
      <ArchivePagination
        page={1}
        totalPages={5}
        onPageChange={onPageChange}
        isPending={false}
        lang="en"
        t={t}
        hrefFor={hrefFor}
      />,
    );
    const page2 = screen.getByRole("link", { name: "Page 2" });
    // false = preventDefault: nawigacja idzie przez SPA, nie pełny reload.
    expect(fireEvent.click(page2, { button: 0 })).toBe(false);
    expect(onPageChange).toHaveBeenCalledWith(2);
    onPageChange.mockClear();
    // Ctrl+klik (nowa karta): zero przechwycenia, natywne zachowanie zostaje.
    expect(fireEvent.click(page2, { button: 0, ctrlKey: true })).toBe(true);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("keeps the button-only variant without hrefFor (admin preview contract)", () => {
    render(
      <ArchivePagination
        page={1}
        totalPages={3}
        onPageChange={() => {}}
        isPending={false}
        lang="pl"
        t={t}
      />,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Strona 2" })).toBeEnabled();
  });

  it("renders range edges as disabled buttons, not dead links", () => {
    render(
      <ArchivePagination
        page={1}
        totalPages={3}
        onPageChange={() => {}}
        isPending={false}
        lang="en"
        t={t}
        hrefFor={hrefFor}
      />,
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/blog?page=2");
  });
});
