// Kontrakty A11Y atomów artykułu. Każdy z tych atomów powstał ze SCALENIA kopii
// JSX, w których kontrakt dostępności był za każdym razem pisany od nowa - i za
// każdym razem inaczej. Testy pilnują tego, co scalenie miało załatwić na stałe:
// rolę, nazwę dostępną, stan wyłączony i to, że ikona jest DEKORACJĄ.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Download, ThumbsUp } from "lucide-react";
import {
  ARTICLE_ACTION_CLASS,
  ArticleActionButton,
} from "@/components/post/atoms/ArticleActionButton";
import { PostIconButton } from "@/components/post/atoms/PostIconButton";
import { MetaValueItem } from "@/components/post/atoms/MetaValueItem";
import { SectionEyebrow } from "@/components/post/atoms/SectionEyebrow";

describe("ArticleActionButton - kontrakt a11y", () => {
  it("jest przyciskiem o nazwie dostępnej równej etykiecie widocznej", () => {
    render(<ArticleActionButton icon={Download} label="Pobierz artykuł" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Pobierz artykuł" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Pobierz artykuł");
  });

  it("ikona jest DEKORACJĄ - czytnik ekranu nie ogłasza jej osobno", () => {
    const { container } = render(
      <ArticleActionButton icon={Download} label="Pobierz" onClick={() => {}} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden");
  });

  it("wywołuje akcję dokładnie raz na klik", () => {
    const onClick = vi.fn();
    render(<ArticleActionButton icon={Download} label="Pobierz" onClick={onClick} />);
    screen.getByRole("button", { name: "Pobierz" }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    // Atom podaje handlerowi zdarzenie kliknięcia - istotne jest, że NIE woła go
    // dwa razy (dwa `onClick` w scalanych kopiach dawały dwa żądania).
    expect(onClick.mock.calls[0][0]).toBeDefined();
  });

  it("stan `busy` WYŁĄCZA przycisk i ogłasza go przez aria-busy", () => {
    render(<ArticleActionButton icon={Download} label="Generuję audio" onClick={() => {}} busy />);
    const button = screen.getByRole("button", { name: "Generuję audio" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("stan `disabled` wyłącza przycisk, ale NIE ogłasza zajętości", () => {
    render(<ArticleActionButton icon={Download} label="Pobierz" onClick={() => {}} disabled />);
    const button = screen.getByRole("button", { name: "Pobierz" });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("wyłączony przycisk NIE wywołuje akcji", () => {
    const onClick = vi.fn();
    render(<ArticleActionButton icon={Download} label="Pobierz" onClick={onClick} disabled />);
    screen.getByRole("button", { name: "Pobierz" }).click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("`leading` zastępuje ikonę, etykieta zostaje bez zmian", () => {
    render(
      <ArticleActionButton
        icon={Download}
        label="Generuję audio"
        onClick={() => {}}
        leading={<span data-testid="spinner" />}
      />,
    );
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generuję audio" })).toHaveTextContent(
      "Generuję audio",
    );
  });

  it("NIESIE stan wyłączony w klasach - kopia w MobileArticleActions go gubiła", () => {
    // To był realny defekt scalonych kopii: `ACTION_CLASS` w
    // `MobileArticleActions` nie miało `disabled:opacity-60`, więc przycisk
    // pobierania nie wyglądał na wyłączony, gdy był.
    expect(ARTICLE_ACTION_CLASS).toContain("disabled:opacity-60");
    render(<ArticleActionButton icon={Download} label="Pobierz" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Pobierz" }).className).toContain(
      "disabled:opacity-60",
    );
  });

  it("własna klasa NIE zabiera wspólnej geometrii rzędu", () => {
    render(
      <ArticleActionButton
        icon={Download}
        label="Pobierz"
        onClick={() => {}}
        className="col-span-2"
      />,
    );
    const cls = screen.getByRole("button", { name: "Pobierz" }).className;
    expect(cls).toContain("col-span-2");
    expect(cls).toContain("h-8");
  });
});

describe("PostIconButton - kontrakt a11y", () => {
  it("nazwa dostępna i dymek pochodzą z JEDNEGO źródła", () => {
    render(<PostIconButton label="Kopiuj cytat" onClick={() => {}} icon={ThumbsUp} />);
    const button = screen.getByRole("button", { name: "Kopiuj cytat" });
    expect(button).toHaveAttribute("title", "Kopiuj cytat");
    expect(button).toHaveAttribute("aria-label", "Kopiuj cytat");
  });

  it("ikona jest dekoracją, a przycisk nie ma widocznego tekstu", () => {
    const { container } = render(
      <PostIconButton label="Udostępnij na X" onClick={() => {}} icon={ThumbsUp} />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "Udostępnij na X" })).toHaveTextContent("");
  });

  it("przycisk AKCJI nie ogłasza stanu, którego nie ma", () => {
    render(<PostIconButton label="Kopiuj" onClick={() => {}} icon={ThumbsUp} />);
    expect(screen.getByRole("button", { name: "Kopiuj" })).not.toHaveAttribute("aria-pressed");
  });

  it("przycisk PRZEŁĄCZAJĄCY ogłasza stan wciśnięcia", () => {
    render(<PostIconButton label="Zapisz" onClick={() => {}} icon={ThumbsUp} pressed />);
    const button = screen.getByRole("button", { name: "Zapisz", pressed: true });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toBeInTheDocument();
  });

  it("stan wyłączony blokuje akcję", () => {
    const onClick = vi.fn();
    render(<PostIconButton label="Kopiuj" onClick={onClick} icon={ThumbsUp} disabled />);
    const button = screen.getByRole("button", { name: "Kopiuj" });
    expect(button).toBeDisabled();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("`children` zastępuje ikonę bez utraty nazwy dostępnej", () => {
    render(
      <PostIconButton label="Skopiowano cytat" onClick={() => {}}>
        <span data-testid="check" />
      </PostIconButton>,
    );
    expect(screen.getByTestId("check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skopiowano cytat" })).toBeInTheDocument();
  });

  it("bez ikony i bez children renderuje pusty, ale NAZWANY przycisk", () => {
    render(<PostIconButton label="Bez ikony" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Bez ikony" });
    expect(button).toBeEmptyDOMElement();
    expect(button).toHaveAttribute("aria-label", "Bez ikony");
  });
});

describe("MetaValueItem - kontrakt a11y obu wariantów", () => {
  it("wariant `stacked` WIĄŻE nazwę pola z wartością (lista definicji)", () => {
    render(
      <dl>
        <MetaValueItem icon={ThumbsUp} label="Region" value="Europa Środkowa" variant="stacked" />
      </dl>,
    );
    const term = screen.getByText("Region");
    expect(term.tagName).toBe("DT");
    expect(term.nextElementSibling?.tagName).toBe("DD");
  });

  it("wariant `inline` udostępnia nazwę pola czytnikowi ekranu", () => {
    render(
      <ul>
        <MetaValueItem icon={ThumbsUp} label="Region" value="Europa Środkowa" variant="inline" />
      </ul>,
    );
    // Etykieta jest dwa razy: raz dla czytnika (z dwukropkiem), raz widocznie.
    expect(screen.getAllByText(/Region/)).toHaveLength(2);
    expect(screen.getByText("Europa Środkowa")).toBeInTheDocument();
  });

  it("wariant `inline` jest elementem listy, `stacked` NIE jest", () => {
    const { container: inline } = render(
      <ul>
        <MetaValueItem icon={ThumbsUp} label="A" value="1" variant="inline" />
      </ul>,
    );
    expect(inline.querySelector("li")).not.toBeNull();

    const { container: stacked } = render(
      <dl>
        <MetaValueItem icon={ThumbsUp} label="A" value="1" variant="stacked" />
      </dl>,
    );
    expect(stacked.querySelector("li")).toBeNull();
  });

  it("ikona jest dekoracją w OBU wariantach (nazwę niesie etykieta)", () => {
    const { container: inline } = render(
      <ul>
        <MetaValueItem icon={ThumbsUp} label="A" value="1" variant="inline" />
      </ul>,
    );
    const { container: stacked } = render(
      <dl>
        <MetaValueItem icon={ThumbsUp} label="A" value="1" variant="stacked" />
      </dl>,
    );
    expect(inline.querySelector("svg")).toHaveAttribute("aria-hidden");
    expect(stacked.querySelector("svg")).toHaveAttribute("aria-hidden");
  });

  it("wartość jest widoczna w obu wariantach", () => {
    const { container: inline } = render(
      <ul>
        <MetaValueItem icon={ThumbsUp} label="Region" value="CEE" variant="inline" />
      </ul>,
    );
    const { container: stacked } = render(
      <dl>
        <MetaValueItem icon={ThumbsUp} label="Region" value="CEE" variant="stacked" />
      </dl>,
    );
    expect(inline.textContent).toContain("CEE");
    expect(stacked.textContent).toContain("CEE");
  });
});

describe("SectionEyebrow - semantyka nadtytułu", () => {
  it("domyślnie jest napisem OZDOBNYM, poza konspektem strony", () => {
    render(<SectionEyebrow>Następny artykuł</SectionEyebrow>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Następny artykuł").tagName).toBe("P");
  });

  it("z `as=h2` JEST nagłówkiem - czytnik ekranu może po nim nawigować", () => {
    render(<SectionEyebrow as="h2">Powiązane analizy</SectionEyebrow>);
    const heading = screen.getByRole("heading", { name: "Powiązane analizy", level: 2 });
    expect(heading).toBeInTheDocument();
    expect(heading.tagName).toBe("H2");
  });

  it("z `as=h3` daje nagłówek trzeciego poziomu", () => {
    render(<SectionEyebrow as="h3">Dossier</SectionEyebrow>);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Dossier");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("własna klasa nie zabiera wspólnej typografii nadtytułu", () => {
    render(<SectionEyebrow className="mb-3">Nadtytuł</SectionEyebrow>);
    const cls = screen.getByText("Nadtytuł").className;
    expect(cls).toContain("mb-3");
    expect(cls).toContain("uppercase");
  });
});
