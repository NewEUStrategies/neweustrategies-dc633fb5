// Macierz karty „Kategorie" edytora wpisu: wybór wielokrotny + tworzenie
// kategorii w miejscu (PL/EN).
//
// CO TU DOWODZIMY:
//   * wybór jest KUMULATYWNY (zaznaczenie nie zjada wcześniejszych kategorii,
//     odznaczenie zdejmuje tylko swoją),
//   * przycisk „dodaj" jest zablokowany, dopóki nie ma nazwy PL (sama nazwa EN
//     ani same spacje nie wystarczą),
//   * blokada „w toku" jest ZAKRESOWA: trwające dodawanie TAGU nie zamraża
//     dodawania kategorii,
//   * Enter w obu polach dodaje kategorię i NIE wysyła formularza edytora.
//
// DLACZEGO TO WAŻNE: kategoria jest wymagana do publikacji (checklista) i
// decyduje o tym, w jakim dziale wpis się pojawi. Zgubione zaznaczenie oznacza
// wpis, którego czytelnik nie znajdzie w dziale; odblokowany przycisk przy
// pustej nazwie tworzy w słowniku puste kategorie widoczne publicznie; Enter bez
// `preventDefault` wysyłałby formularz i przerywał pisanie w środku dodawania.
//
// Asercje idą po KLUCZACH i18n (stub `reactI18nextStub`) - copy poprawia
// redakcja, a test ma pękać od zmiany ZACHOWANIA, nie od korekty tekstu.
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { categoryOpt } from "@/test/post-editor/fixtures";
import type { CategoryOpt } from "@/components/admin/post-editor/types";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

import { CategoriesCard } from "../CategoriesCard";

const CATS: CategoryOpt[] = [
  categoryOpt({ id: "c1", name_pl: "Analizy", name_en: "Analyses" }),
  categoryOpt({ id: "c2", name_pl: "Wywiady", name_en: "Interviews" }),
];

function Harness({
  allCats,
  initialSelected = [],
  initialPl = "",
  initialEn = "",
  taxonomyBusy = null,
  onAddCategory = () => {},
}: {
  allCats: CategoryOpt[] | undefined;
  initialSelected?: string[];
  initialPl?: string;
  initialEn?: string;
  taxonomyBusy?: "cat" | "tag" | null;
  onAddCategory?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [pl, setPl] = useState(initialPl);
  const [en, setEn] = useState(initialEn);
  return (
    <div>
      <output data-testid="wybrane">{selected.join(",")}</output>
      <CategoriesCard
        allCats={allCats}
        selectedCats={selected}
        onSelectedCatsChange={setSelected}
        newCatPl={pl}
        onNewCatPlChange={setPl}
        newCatEn={en}
        onNewCatEnChange={setEn}
        taxonomyBusy={taxonomyBusy}
        onAddCategory={onAddCategory}
      />
    </div>
  );
}

const boxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];
const selected = () => screen.getByTestId("wybrane").textContent;
const addButton = () => screen.getByRole("button") as HTMLButtonElement;
const plInput = () =>
  screen.getByPlaceholderText("adminPostPanes.taxonomy.namePlPlaceholder") as HTMLInputElement;
const enInput = () =>
  screen.getByPlaceholderText("adminPostPanes.taxonomy.nameEnPlaceholder") as HTMLInputElement;

describe("CategoriesCard - lista do wyboru", () => {
  it("nazywa kartę kluczem nawigacji panelu i daje checkbox na kategorię", () => {
    render(<Harness allCats={CATS} />);

    expect(screen.getByText("admin.nav.categories")).toBeInTheDocument();
    expect(boxes()).toHaveLength(2);
  });

  it("pokazuje kategorię dwujęzycznie (PL / EN), żeby redakcja EN wiedziała, co wybiera", () => {
    render(<Harness allCats={CATS} />);

    expect(screen.getByText("Analizy / Analyses")).toBeInTheDocument();
    expect(screen.getByText("Wywiady / Interviews")).toBeInTheDocument();
  });

  it("odzwierciedla aktualne zaznaczenie w checkboksach", () => {
    render(<Harness allCats={CATS} initialSelected={["c2"]} />);

    expect(boxes()[0].checked).toBe(false);
    expect(boxes()[1].checked).toBe(true);
  });

  it("informuje o pustym słowniku - i przy braku danych, i przy pustej liście", () => {
    const { unmount } = render(<Harness allCats={undefined} />);
    expect(screen.getByText("admin.posts.noCats")).toBeInTheDocument();
    unmount();

    render(<Harness allCats={[]} />);
    expect(screen.getByText("admin.posts.noCats")).toBeInTheDocument();
  });

  it("nie pokazuje komunikatu o pustym słowniku, gdy kategorie są", () => {
    render(<Harness allCats={CATS} />);

    expect(screen.queryByText("admin.posts.noCats")).not.toBeInTheDocument();
  });
});

describe("CategoriesCard - wybór wielokrotny", () => {
  it("zaznaczenie DOPISUJE kategorię do już wybranych", () => {
    render(<Harness allCats={CATS} initialSelected={["c2"]} />);

    fireEvent.click(boxes()[0]);

    expect(selected()).toBe("c2,c1");
  });

  it("odznaczenie zdejmuje TYLKO odklikaną kategorię", () => {
    render(<Harness allCats={CATS} initialSelected={["c1", "c2"]} />);

    fireEvent.click(boxes()[0]);

    expect(selected()).toBe("c2");
    expect(boxes()[1].checked).toBe(true);
  });
});

describe("CategoriesCard - tworzenie kategorii w miejscu", () => {
  it("pokazuje nagłówek sekcji dodawania i etykietę przycisku po kluczach", () => {
    render(<Harness allCats={CATS} />);

    expect(screen.getByText("adminPostPanes.taxonomy.addCategoryHeading")).toBeInTheDocument();
    expect(addButton()).toHaveTextContent("adminPostPanes.taxonomy.addCategory");
  });

  it("przepisuje wpisywane nazwy do rodzica (PL i EN osobno)", () => {
    render(<Harness allCats={CATS} />);

    fireEvent.change(plInput(), { target: { value: "Nowa kategoria" } });
    fireEvent.change(enInput(), { target: { value: "New category" } });

    expect(plInput().value).toBe("Nowa kategoria");
    expect(enInput().value).toBe("New category");
  });

  it("blokuje dodawanie bez nazwy PL - także gdy jest tylko nazwa EN", () => {
    render(<Harness allCats={CATS} initialEn="New category" />);

    expect(addButton().disabled).toBe(true);
  });

  it("blokuje dodawanie, gdy nazwa PL to same spacje (puste kategorie w słowniku)", () => {
    render(<Harness allCats={CATS} initialPl="   " />);

    expect(addButton().disabled).toBe(true);
  });

  it("odblokowuje dodawanie po wpisaniu nazwy PL", () => {
    render(<Harness allCats={CATS} />);
    expect(addButton().disabled).toBe(true);

    fireEvent.change(plInput(), { target: { value: "Nowa" } });

    expect(addButton().disabled).toBe(false);
  });

  it("klik w przycisk woła akcję dodania dokładnie raz", () => {
    const onAddCategory = vi.fn();
    render(<Harness allCats={CATS} initialPl="Nowa" onAddCategory={onAddCategory} />);

    fireEvent.click(addButton());

    expect(onAddCategory).toHaveBeenCalledTimes(1);
  });
});

describe("CategoriesCard - stan dodawania w toku", () => {
  it("podczas dodawania KATEGORII przycisk jest zablokowany i mówi o pracy w toku", () => {
    render(<Harness allCats={CATS} initialPl="Nowa" taxonomyBusy="cat" />);

    expect(addButton().disabled).toBe(true);
    expect(addButton()).toHaveTextContent("adminPostPanes.taxonomy.adding");
  });

  it("dodawanie TAGU nie zamraża dodawania kategorii (blokada jest zakresowa)", () => {
    render(<Harness allCats={CATS} initialPl="Nowa" taxonomyBusy="tag" />);

    expect(addButton().disabled).toBe(false);
    expect(addButton()).toHaveTextContent("adminPostPanes.taxonomy.addCategory");
  });
});

describe("CategoriesCard - klawiatura", () => {
  it("Enter w polu PL dodaje kategorię i wstrzymuje domyślną akcję (bez wysyłki formularza)", () => {
    const onAddCategory = vi.fn();
    render(<Harness allCats={CATS} initialPl="Nowa" onAddCategory={onAddCategory} />);

    // fireEvent zwraca false, gdy zdarzenie zostało anulowane (preventDefault).
    const notCancelled = fireEvent.keyDown(plInput(), { key: "Enter" });

    expect(onAddCategory).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
  });

  it("Enter w polu EN też dodaje kategorię (redaktor kończy wpisywanie w drugim polu)", () => {
    const onAddCategory = vi.fn();
    render(<Harness allCats={CATS} initialPl="Nowa" onAddCategory={onAddCategory} />);

    const notCancelled = fireEvent.keyDown(enInput(), { key: "Enter" });

    expect(onAddCategory).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
  });

  it("inne klawisze nie dodają kategorii (pisanie nazwy nie może niczego tworzyć)", () => {
    const onAddCategory = vi.fn();
    render(<Harness allCats={CATS} initialPl="Nowa" onAddCategory={onAddCategory} />);

    fireEvent.keyDown(plInput(), { key: "a" });
    fireEvent.keyDown(enInput(), { key: "Tab" });

    expect(onAddCategory).not.toHaveBeenCalled();
  });
});
