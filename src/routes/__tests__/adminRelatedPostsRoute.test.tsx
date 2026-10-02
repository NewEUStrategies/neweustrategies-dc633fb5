// Trasa /admin/related-posts - samo sklejenie: panel, ekran „nie znaleziono"
// i granica błędu.
//
// Plik trasy po wyprowadzeniu panelu do `components/admin/postExperience`
// trzyma WYŁĄCZNIE rejestrację, więc to jest cała jego logika - i dokładnie ta
// część, której test panelu nie widzi. Granica błędu ma iść w wariancie
// PANELOWYM: pełnoekranowa strona błędu publicznego serwisu wewnątrz układu
// admina zasłoniłaby nawigację, którą administrator ma z błędu wyjść.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnyRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  fallbackProps: [] as Record<string, unknown>[],
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/admin/postExperience/organisms/RelatedPostsSettingsPanel", () => ({
  RelatedPostsSettingsPanel: () => <h1>panel rekomendacji</h1>,
}));
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: (props: Record<string, unknown>) => {
    h.fallbackProps.push(props);
    return <div role="alert">ekran błędu</div>;
  },
}));

import { Route } from "@/routes/admin.related-posts";
import { RelatedPostsSettingsPanel } from "@/components/admin/postExperience/organisms/RelatedPostsSettingsPanel";

const options = (Route as AnyRoute).options;

beforeEach(() => {
  h.fallbackProps = [];
});

describe("/admin/related-posts", () => {
  it("komponentem trasy jest panel konfiguracji silnika", () => {
    const Component = options.component as () => ReactNode;
    render(<>{Component()}</>);

    expect(options.component).toBe(RelatedPostsSettingsPanel);
    expect(screen.getByRole("heading", { name: "panel rekomendacji" })).toBeInTheDocument();
  });

  it("brak dopasowania ma własny, przetłumaczony ekran", () => {
    const NotFound = options.notFoundComponent as () => ReactNode;
    render(<>{NotFound()}</>);

    expect(screen.getByText("adminRelatedPosts.notFound")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("granica błędu przekazuje błąd i reset w wariancie PANELOWYM", () => {
    const ErrorView = options.errorComponent as (props: {
      error: Error;
      reset: () => void;
    }) => ReactNode;
    const error = new Error("related_posts_config: 500");
    const reset = vi.fn();

    render(<>{ErrorView({ error, reset })}</>);

    expect(screen.getByRole("alert")).toHaveTextContent("ekran błędu");
    expect(h.fallbackProps).toHaveLength(1);
    expect(h.fallbackProps[0]).toMatchObject({ error, reset, variant: "admin" });
  });
});
