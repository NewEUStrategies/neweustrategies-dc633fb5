// Karta „Tagi" edytora wpisu: przełączniki-żetony (chip toggles) + tworzenie
// tagu w miejscu.
//
// CO TU DOWODZIMY:
//   * żeton przełącza tag w OBU kierunkach i nie rusza pozostałych wyborów,
//   * przycisk „dodaj tag" jest zablokowany bez nazwy (także dla samych spacji),
//   * blokada „w toku" jest ZAKRESOWA - trwające dodawanie KATEGORII nie
//     zamraża dodawania tagu,
//   * Enter w polu nazwy dodaje tag i wstrzymuje domyślną akcję zdarzenia.
//
// DLACZEGO TO WAŻNE: tagi budują strony tematyczne i powiązania „podobne wpisy".
// Żeton, który po drugim kliknięciu nie odznacza tagu, zostawia wpis w temacie,
// z którego redakcja go właśnie zdjęła (a czytelnik trafia na wpis nie w temacie).
// Puste nazwy tworzą w publicznym słowniku tagi bez etykiety.
//
// Asercje po KLUCZACH i18n, nie po copy - patrz `reactI18nextStub`.
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { tagOpt } from "@/test/post-editor/fixtures";
import type { TagOpt } from "@/components/admin/post-editor/types";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

import { TagsCard } from "../TagsCard";

const TAGS: TagOpt[] = [
  tagOpt({ id: "t1", name: "fundusze" }),
  tagOpt({ id: "t2", name: "klimat" }),
  tagOpt({ id: "t3", name: "migracje" }),
];

function Harness({
  allTags,
  initialSelected = [],
  initialName = "",
  taxonomyBusy = null,
  onAddTag = () => {},
}: {
  allTags: TagOpt[] | undefined;
  initialSelected?: string[];
  initialName?: string;
  taxonomyBusy?: "cat" | "tag" | null;
  onAddTag?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [name, setName] = useState(initialName);
  return (
    <div>
      <output data-testid="wybrane">{selected.join(",")}</output>
      <TagsCard
        allTags={allTags}
        selectedTags={selected}
        onSelectedTagsChange={setSelected}
        newTagName={name}
        onNewTagNameChange={setName}
        taxonomyBusy={taxonomyBusy}
        onAddTag={onAddTag}
      />
    </div>
  );
}

const chip = (name: string) => screen.getByRole("button", { name });
const selected = () => screen.getByTestId("wybrane").textContent;
const nameInput = () =>
  screen.getByPlaceholderText("adminPostPanes.taxonomy.tagNamePlaceholder") as HTMLInputElement;
const addButton = () =>
  screen.getByRole("button", {
    name: /adminPostPanes\.taxonomy\.(addTagShort|addingShort)/,
  }) as HTMLButtonElement;

describe("TagsCard - lista żetonów", () => {
  it("nazywa kartę kluczem nawigacji i wystawia żeton na każdy tag", () => {
    render(<Harness allTags={TAGS} />);

    expect(screen.getByText("admin.nav.tags")).toBeInTheDocument();
    expect(chip("fundusze")).toBeInTheDocument();
    expect(chip("klimat")).toBeInTheDocument();
    expect(chip("migracje")).toBeInTheDocument();
  });

  it("informuje o pustym słowniku tagów - przy braku danych i przy pustej liście", () => {
    const { unmount } = render(<Harness allTags={undefined} />);
    expect(screen.getByText("admin.posts.noTags")).toBeInTheDocument();
    unmount();

    render(<Harness allTags={[]} />);
    expect(screen.getByText("admin.posts.noTags")).toBeInTheDocument();
  });

  it("nie pokazuje komunikatu o pustym słowniku, gdy tagi są", () => {
    render(<Harness allTags={TAGS} />);

    expect(screen.queryByText("admin.posts.noTags")).not.toBeInTheDocument();
  });
});

describe("TagsCard - przełączanie tagów", () => {
  it("klik w nieaktywny żeton DOPISUJE tag, zachowując wcześniejsze", () => {
    render(<Harness allTags={TAGS} initialSelected={["t2"]} />);

    fireEvent.click(chip("fundusze"));

    expect(selected()).toBe("t2,t1");
  });

  it("klik w aktywny żeton USUWA tylko ten tag", () => {
    render(<Harness allTags={TAGS} initialSelected={["t1", "t2", "t3"]} />);

    fireEvent.click(chip("klimat"));

    expect(selected()).toBe("t1,t3");
  });

  it("dwuklik w ten sam żeton wraca do stanu wyjściowego", () => {
    render(<Harness allTags={TAGS} initialSelected={[]} />);

    fireEvent.click(chip("migracje"));
    expect(selected()).toBe("t3");
    fireEvent.click(chip("migracje"));

    expect(selected()).toBe("");
  });

  it("SWIADEK DEFEKTU: żeton nie ma stanu dostępnego programowo (aria-pressed)", () => {
    // Aktywny tag odróżnia dziś WYŁĄCZNIE kolor tła. Dla czytnika ekranu oba
    // żetony są identyczne, więc osoba niewidząca nie wie, które tagi wpis ma
    // przypisane - i nie ma jak tego sprawdzić inaczej niż zapisując wpis.
    // Test opisuje stan OBECNY; po dodaniu aria-pressed ma pęknąć i zostać
    // przepisany na asercję stanu.
    render(<Harness allTags={TAGS} initialSelected={["t1"]} />);

    expect(chip("fundusze").getAttribute("aria-pressed")).toBeNull();
    expect(chip("klimat").getAttribute("aria-pressed")).toBeNull();
  });
});

describe("TagsCard - tworzenie tagu w miejscu", () => {
  it("pokazuje nagłówek sekcji dodawania i etykietę przycisku po kluczach", () => {
    render(<Harness allTags={TAGS} />);

    expect(screen.getByText("adminPostPanes.taxonomy.addTagHeading")).toBeInTheDocument();
    expect(addButton()).toHaveTextContent("adminPostPanes.taxonomy.addTagShort");
  });

  it("przepisuje wpisywaną nazwę do rodzica", () => {
    render(<Harness allTags={TAGS} />);

    fireEvent.change(nameInput(), { target: { value: "energetyka" } });

    expect(nameInput().value).toBe("energetyka");
  });

  it("blokuje dodawanie bez nazwy i przy samych spacjach", () => {
    const { unmount } = render(<Harness allTags={TAGS} />);
    expect(addButton().disabled).toBe(true);
    unmount();

    render(<Harness allTags={TAGS} initialName="   " />);
    expect(addButton().disabled).toBe(true);
  });

  it("odblokowuje dodawanie po wpisaniu nazwy", () => {
    render(<Harness allTags={TAGS} />);

    fireEvent.change(nameInput(), { target: { value: "energetyka" } });

    expect(addButton().disabled).toBe(false);
  });

  it("klik w przycisk woła akcję dodania dokładnie raz", () => {
    const onAddTag = vi.fn();
    render(<Harness allTags={TAGS} initialName="energetyka" onAddTag={onAddTag} />);

    fireEvent.click(addButton());

    expect(onAddTag).toHaveBeenCalledTimes(1);
  });
});

describe("TagsCard - stan dodawania w toku", () => {
  it("podczas dodawania TAGU przycisk jest zablokowany i mówi o pracy w toku", () => {
    render(<Harness allTags={TAGS} initialName="energetyka" taxonomyBusy="tag" />);

    expect(addButton().disabled).toBe(true);
    expect(addButton()).toHaveTextContent("adminPostPanes.taxonomy.addingShort");
  });

  it("dodawanie KATEGORII nie zamraża dodawania tagu (blokada jest zakresowa)", () => {
    render(<Harness allTags={TAGS} initialName="energetyka" taxonomyBusy="cat" />);

    expect(addButton().disabled).toBe(false);
    expect(addButton()).toHaveTextContent("adminPostPanes.taxonomy.addTagShort");
  });
});

describe("TagsCard - klawiatura", () => {
  it("Enter w polu nazwy dodaje tag i wstrzymuje domyślną akcję zdarzenia", () => {
    const onAddTag = vi.fn();
    render(<Harness allTags={TAGS} initialName="energetyka" onAddTag={onAddTag} />);

    const notCancelled = fireEvent.keyDown(nameInput(), { key: "Enter" });

    expect(onAddTag).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(false);
  });

  it("inne klawisze nie tworzą tagu", () => {
    const onAddTag = vi.fn();
    render(<Harness allTags={TAGS} initialName="energetyka" onAddTag={onAddTag} />);

    fireEvent.keyDown(nameInput(), { key: "e" });

    expect(onAddTag).not.toHaveBeenCalled();
  });
});
