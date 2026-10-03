// Okruszki to nawigacja: `<nav aria-label>` z uporządkowaną listą, w której
// bieżąca strona ma `aria-current="page"`, a separatory są ukryte przed
// czytnikiem (inaczej czytnik czyta „strzałka" między każdą pozycją). Link ma
// dwie gałęzie: natywny `<a>` albo `asChild` (Slot) dla linku routera.
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../breadcrumb";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

function Sample({ customSeparator }: { customSeparator?: string }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Strona główna</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>{customSeparator}</BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <a href="/analizy" data-router-link="">
              Analizy
            </a>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Raport</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

describe("Breadcrumb", () => {
  it("jest nazwanym punktem nawigacji z uporządkowaną listą pozycji", () => {
    render(<Sample />);
    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    const list = within(nav).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(list).toHaveClass("flex", "flex-wrap", "text-muted-foreground");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("oznacza bieżącą stronę jako aktualną i wyłączoną, a nie jako zwykły link", () => {
    render(<Sample />);
    const page = screen.getByRole("link", { name: "Raport" });
    expect(page.tagName).toBe("SPAN");
    expect(page).toHaveAttribute("aria-current", "page");
    expect(page).toHaveAttribute("aria-disabled", "true");
    expect(page).not.toHaveAttribute("href");
    expect(page).toHaveClass("text-foreground");
  });

  it("renderuje natywny link albo przekazuje klasy na link routera przez asChild", () => {
    render(<Sample />);
    const home = screen.getByRole("link", { name: "Strona główna" });
    expect(home.tagName).toBe("A");
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveClass("transition-colors", "hover:text-foreground");
    const routed = screen.getByRole("link", { name: "Analizy" });
    expect(routed).toHaveAttribute("data-router-link", "");
    expect(routed).toHaveClass("hover:text-foreground");
    expect(routed.parentElement?.tagName).toBe("LI");
  });

  it("ukrywa separatory przed czytnikiem i domyślnie rysuje szewron", () => {
    const { container } = render(<Sample />);
    const separators = container.querySelectorAll('li[role="presentation"]');
    expect(separators).toHaveLength(2);
    for (const separator of separators) {
      expect(separator).toHaveAttribute("aria-hidden", "true");
    }
    expect(separators[1].querySelector("svg")).not.toBeNull();
  });

  it("pozwala zastąpić szewron własnym separatorem", () => {
    const { container } = render(<Sample customSeparator="/" />);
    const [custom, fallback] = container.querySelectorAll('li[role="presentation"]');
    expect(custom).toHaveTextContent("/");
    expect(custom.querySelector("svg")).toBeNull();
    expect(fallback.querySelector("svg")).not.toBeNull();
  });

  it("przechodzi audyt dostępności axe", async () => {
    const { container } = render(<Sample />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("przekazuje ref każdego elementu i scala klasy wywołującego", () => {
    const nav = createRef<HTMLElement>();
    const list = createRef<HTMLOListElement>();
    const item = createRef<HTMLLIElement>();
    const link = createRef<HTMLAnchorElement>();
    const page = createRef<HTMLSpanElement>();
    render(
      <Breadcrumb ref={nav}>
        <BreadcrumbList ref={list} className="gap-4">
          <BreadcrumbItem ref={item} className="font-bold">
            <BreadcrumbLink ref={link} href="/x" className="underline">
              X
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="opacity-50" />
          <BreadcrumbItem>
            <BreadcrumbPage ref={page} className="font-semibold">
              Y
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(nav.current?.tagName).toBe("NAV");
    expect(list.current).toHaveClass("gap-4");
    expect(list.current).not.toHaveClass("gap-1.5");
    expect(item.current).toHaveClass("font-bold", "inline-flex");
    expect(link.current).toHaveClass("underline", "transition-colors");
    expect(page.current).toHaveClass("font-semibold");
    expect(page.current).not.toHaveClass("font-normal");
    expect(list.current?.querySelector('[role="presentation"]')).toHaveClass("opacity-50");
  });
});
