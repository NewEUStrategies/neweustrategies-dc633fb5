import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterestsCustomizer } from "@/components/interests/InterestsCustomizer";
import type { InterestCatalog, InterestItem } from "@/hooks/useInterests";

const fixture = vi.hoisted(() => ({
  catalog: {
    data: { categories: [], tags: [] } as InterestCatalog,
    isLoading: false,
  },
  my: {
    data: { categoryIds: [] as string[], tagIds: [] as string[] },
    isLoading: false,
    isAnonymous: false,
    save: vi.fn(),
  },
}));

vi.mock("@/hooks/useInterests", () => ({
  useInterestCatalog: () => fixture.catalog,
  useMyInterests: () => fixture.my,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
    i18n: { language: "pl" },
  }),
}));

vi.mock("@/lib/i18n-interests", () => ({ ensureI18n: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const category: InterestItem = {
  id: "cat-1",
  type: "category",
  slug: "security",
  label: "Bezpieczeństwo",
};
const tag: InterestItem = {
  id: "tag-1",
  type: "tag",
  slug: "europe",
  label: "Europa",
};

describe("InterestsCustomizer", () => {
  beforeEach(() => {
    fixture.catalog = {
      data: { categories: [category], tags: [tag] },
      isLoading: false,
    };
    fixture.my = {
      data: { categoryIds: [], tagIds: [] },
      isLoading: false,
      isAnonymous: false,
      save: vi.fn().mockResolvedValue({ ok: true, anon: false }),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("pokazuje stan ładowania i blokuje zapis", () => {
    fixture.catalog.isLoading = true;
    render(<InterestsCustomizer />);

    expect(screen.getByText("interests.loading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "interests.save" })).toBeDisabled();
  });

  it("pokazuje puste grupy i wezwanie do logowania anonimowego użytkownika", () => {
    fixture.catalog.data = { categories: [], tags: [] };
    fixture.my.isAnonymous = true;
    render(<InterestsCustomizer />);

    expect(screen.getAllByText("interests.empty")).toHaveLength(2);
    expect(screen.getByText("interests.loginRequired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /interests.loginCta/ })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("hydratuje wybór, przełącza pozycję i zapisuje oba typy", async () => {
    fixture.my.data = { categoryIds: [category.id], tagIds: [] };
    render(<InterestsCustomizer />);
    const categoryButton = screen.getByRole("button", { name: "Bezpieczeństwo" });
    const tagButton = screen.getByRole("button", { name: "Europa" });

    await waitFor(() => expect(categoryButton).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(tagButton);
    expect(tagButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("interests.selectedCount:2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "interests.save" }));
    await waitFor(() =>
      expect(fixture.my.save).toHaveBeenCalledWith({
        categoryIds: [category.id],
        tagIds: [tag.id],
      }),
    );
    expect(screen.getByText("interests.saved")).toBeInTheDocument();
  });

  it("po nieudanym zapisie pokazuje błąd i odblokowuje przycisk", async () => {
    fixture.my.save.mockResolvedValue({ ok: false, error: "Awaria zapisu" });
    render(<InterestsCustomizer />);

    fireEvent.click(screen.getByRole("button", { name: "interests.save" }));

    expect(await screen.findByText("Awaria zapisu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "interests.save" })).not.toBeDisabled();
    expect(fixture.my.save).toHaveBeenCalledTimes(1);
  });

  it("utrzymuje stan zapisywania do rozstrzygnięcia obietnicy", async () => {
    let release: ((value: { ok: true; anon: false }) => void) | undefined;
    fixture.my.save.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<InterestsCustomizer />);
    const save = screen.getByRole("button", { name: "interests.save" });

    fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(fixture.my.save).toHaveBeenCalledTimes(1);

    release?.({ ok: true, anon: false });
    expect(await screen.findByText("interests.saved")).toBeInTheDocument();
  });

  it("wariant kompaktowy bez nagłówka zachowuje formularz", () => {
    const { container } = render(
      <InterestsCustomizer variant="compact" showHeader={false} className="test-class" />,
    );

    expect(screen.queryByText("interests.title")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("p-4", "test-class");
    expect(screen.getByRole("button", { name: "interests.save" })).toBeInTheDocument();
  });
});
