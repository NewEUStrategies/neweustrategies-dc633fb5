// Nawigacja po DZIAŁACH klubu: drzewo w szynie (`ClubGroupTree`), pasek
// poziomy na telefonie (`ClubGroupBar`) i panel wybranego działu
// (`ClubGroupPanel`).
//
// CO TEN PLIK DOWODZI.
// (1) HIERARCHIA JEST RESPEKTOWANA, A NIE ODTWARZANA. Drzewo liczy
//     `buildClubGroupTree`, więc tutaj dowodzimy, że komponent to drzewo WOŁA
//     i rysuje: poddział stoi WEWNĄTRZ wiersza rodzica, licznik rodzica niesie
//     sumę z gałęzi, a trzeci poziom nie ląduje przy korzeniu.
// (2) ROZWIJANIE MA DWA KIERUNKI. Klik w dział z podgrupami ZWIJA go, a nie
//     zaznacza (bo zaznaczenie działu-kontenera pokazałoby pustą listę wątków);
//     drugi klik rozwija z powrotem. Dział BEZ podgrup zaznacza od razu.
// (3) ŚCIEŻKA DO ZAZNACZONEGO DZIAŁU WYGRYWA NAD ZWINIĘCIEM. Zwinięcie
//     rodzica, w którym siedzi zaznaczony poddział, nie może schować tego, na
//     co użytkownik właśnie patrzy.
// (4) POWTÓRNY KLIK W ZAZNACZONY DZIAŁ ZDEJMUJE ZAWĘŻENIE (`null`) - to jedyna
//     droga powrotu do całego klubu z poziomu poddziału.
// (5) DZIAŁ BEZ DOSTĘPU dostaje kłódkę, ale ZOSTAJE na liście: dział ukryty
//     zupełnie nie da się o niego poprosić.
// (6) PANEL DZIAŁU odpowiada na cztery pytania (okruszki, temat, materiały,
//     wątki) i KAŻDY jego przycisk realnie przestawia zawężenie - okruszek na
//     przodka, krzyżyk na `null`, chip podgrupy na podgrupę.
// (7) TRZY STANY DANYCH: pełne drzewo, drzewo puste (pasek znika, drzewo
//     zostaje z samym wpisem „wszystkie”) i dział bez pola opcjonalnego
//     (pusty opis, brak ikony, zero wątków) - żaden z nich nie może rzucić
//     ani wypisać gołego `undefined`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `src/lib/clubs/groupTree.ts` - budowa drzewa, wybór rodzica po najdłuższym
//     prefiksie slugu, sumowanie wątków i `clubGroupPath` mają własny test
//     jednostkowy (`src/lib/clubs/__tests__/groupTree.test.ts`). Tu widać ich
//     SKUTEK w DOM-ie.
// (b) `pickLocalized` - polityka „język interfejsu, potem drugi język” ma
//     własny test; tutaj sprawdzamy tylko, że `clubGroupName`
//     i `clubGroupDescription` jej używają (i że opis jest przycięty).
// (c) Atomu `ClubGroupIcon` i `clubGroupAccentVars` - własny plik testowy
//     (`clubAtomIcons.test.tsx`); użyte tu PRAWDZIWE, bo panel ma stać
//     bez wyjątku także dla działu bez ikony.
// (d) Organizmu `ClubHub`, który te trzy molekuły skleja - `clubHubOrganisms`
//     trzyma je jako atrapy i dowodzi przepływu zawężenia w drugą stronę.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import {
  ClubGroupBar,
  ClubGroupTree,
  clubGroupDescription,
  clubGroupName,
} from "@/components/clubs/molecules/ClubGroupTree";
import { ClubGroupPanel } from "@/components/clubs/molecules/ClubGroupPanel";
import {
  buildClubGroupTree,
  clubGroupPath,
  findClubGroupNode,
  type ClubGroupNode,
} from "@/lib/clubs/groupTree";
import { clubGroupRow } from "@/test/clubs/fixtures";
import type { ClubGroupRow } from "@/lib/clubs/types";

/**
 * Cztery działy w układzie, w którym hierarchia SIEDZI W SLUGU (konwencja
 * redakcji): korzeń, poddział, poddział poddziału i drugi korzeń bez dostępu.
 * Ten sam zestaw obsługuje wszystkie trzy komponenty pliku.
 */
const KORZEN: ClubGroupRow = clubGroupRow({
  id: "group-bezp",
  slug: "bezpieczenstwo",
  name_pl: "Bezpieczeństwo",
  name_en: "Security",
  description_pl: "  Sprawy obronne klubu.  ",
  thread_count: 2,
});

const PODDZIAL: ClubGroupRow = clubGroupRow({
  id: "group-cyber",
  slug: "bezpieczenstwo-cyber",
  name_pl: "Cyber",
  name_en: "Cyber",
  thread_count: 3,
});

/** Poddział trzeciego poziomu, do tego zamknięty - kłódka na WIERSZU WCIĘTYM. */
const WNUK: ClubGroupRow = clubGroupRow({
  id: "group-nis2",
  slug: "bezpieczenstwo-cyber-nis2",
  name_pl: "NIS2",
  name_en: "NIS2",
  thread_count: 1,
  can_read: false,
  reason: "tier",
});

/** Dział zamknięty regułą klubu: liczba wątków jest, dostępu nie ma. */
const ZAMKNIETY: ClubGroupRow = clubGroupRow({
  id: "group-energia",
  slug: "energia",
  name_pl: "Energia",
  name_en: "Energy",
  // Kolumny `RETURNS TABLE` są non-null, więc brak ikony to PUSTY NAPIS -
  // i to on musi trafić na wariant zapasowy `ClubGroupIcon`.
  icon: "",
  thread_count: 0,
  can_read: false,
  reason: "tier",
});

const DZIALY: readonly ClubGroupRow[] = [KORZEN, PODDZIAL, WNUK, ZAMKNIETY];

/** Węzeł drzewa dla panelu - liczony PRAWDZIWĄ funkcją, nie ręcznie. */
function wezel(groups: readonly ClubGroupRow[], id: string): ClubGroupNode {
  const node = findClubGroupNode(buildClubGroupTree(groups), id);
  if (node === null) throw new Error(`Brak węzła ${id} w drzewie testowym`);
  return node;
}

beforeEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Nazwa i opis działu
// ---------------------------------------------------------------------------

describe("clubGroupName i clubGroupDescription", () => {
  it("puste pole języka interfejsu sięga po drugi język, a nie pokazuje pustki", () => {
    const bezPolskiego = clubGroupRow({ name_pl: "   ", name_en: "Security" });
    expect(clubGroupName(bezPolskiego, "pl")).toBe("Security");
    expect(clubGroupName(bezPolskiego, "en")).toBe("Security");
  });

  it("opis wraca PRZYCIĘTY, bo o pustce decyduje treść, a nie białe znaki", () => {
    expect(clubGroupDescription(KORZEN, "pl")).toBe("Sprawy obronne klubu.");
    expect(clubGroupDescription(clubGroupRow({ description_pl: "  \n " }), "pl")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Drzewo działów w szynie
// ---------------------------------------------------------------------------

describe("ClubGroupTree - struktura i liczniki", () => {
  it("wpis „wszystkie działy” niesie SUMĘ wątków całego drzewa", () => {
    render(<ClubGroupTree groups={DZIALY} activeGroupId={null} onGroupChange={vi.fn()} />);

    const wszystkie = screen.getByRole("button", { name: /club\.allGroups/ });
    expect(wszystkie).toHaveAttribute("aria-pressed", "true");
    // 2 + 3 + 1 + 0 - liczy `buildClubGroupTree`, nie komponent.
    expect(wszystkie).toHaveTextContent("6");
  });

  it("poddział stoi WEWNĄTRZ wiersza rodzica, a trzeci poziom wewnątrz poddziału", () => {
    render(<ClubGroupTree groups={DZIALY} activeGroupId={null} onGroupChange={vi.fn()} />);

    const wierszKorzenia = screen.getByRole("button", { name: "Bezpieczeństwo" }).closest("li");
    const wierszPoddzialu = screen.getByRole("button", { name: /^Cyber/ }).closest("li");
    const wierszWnuka = screen.getByRole("button", { name: /^NIS2/ }).closest("li");

    expect(wierszKorzenia).not.toBeNull();
    expect(wierszPoddzialu).not.toBeNull();
    expect(wierszWnuka).not.toBeNull();
    expect(wierszKorzenia?.contains(wierszPoddzialu ?? null)).toBe(true);
    expect(wierszPoddzialu?.contains(wierszWnuka ?? null)).toBe(true);
    // Drugi korzeń NIE MOŻE wpaść pod pierwszy - inaczej hierarchia po slugu
    // złapałaby dowolne dwa działy.
    expect(wierszKorzenia?.contains(screen.getByRole("button", { name: /^Energia/ }))).toBe(false);
  });

  it("licznik poddziału niesie sumę z jego gałęzi, a nie własne wątki", () => {
    render(<ClubGroupTree groups={DZIALY} activeGroupId={null} onGroupChange={vi.fn()} />);

    // Cyber ma 3 własne wątki plus 1 z NIS2.
    expect(screen.getByRole("button", { name: /^Cyber/ })).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: /^NIS2/ })).toHaveTextContent("1");
  });

  it("dział bez dostępu zostaje na liście z kłódką - na KAŻDYM poziomie wcięcia", () => {
    const { container } = render(
      <ClubGroupTree groups={DZIALY} activeGroupId={null} onGroupChange={vi.fn()} />,
    );

    const zamknietyKorzen = screen.getByRole("button", { name: /^Energia/ });
    expect(zamknietyKorzen).toHaveTextContent("0");
    expect(zamknietyKorzen.querySelector("svg.lucide-lock")).not.toBeNull();
    // Ten sam fakt na wierszu wciętym - poddział bez dostępu nie może wyglądać
    // jak dostępny tylko dlatego, że stoi głębiej.
    expect(
      screen.getByRole("button", { name: /^NIS2/ }).querySelector("svg.lucide-lock"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /^Cyber/ }).querySelector("svg.lucide-lock"),
    ).toBeNull();
    expect(container.querySelectorAll("svg.lucide-lock")).toHaveLength(2);
  });

  it("drzewo puste zostawia sam wpis „wszystkie działy” z zerem", () => {
    render(<ClubGroupTree groups={[]} activeGroupId={null} onGroupChange={vi.fn()} />);

    const wszystkie = screen.getByRole("button", { name: /club\.allGroups/ });
    expect(wszystkie).toHaveTextContent("0");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("ClubGroupTree - zwijanie i zaznaczanie", () => {
  it("klik w dział z podgrupami ZWIJA go, zamiast zaznaczać; drugi klik rozwija", () => {
    const onGroupChange = vi.fn();
    render(<ClubGroupTree groups={DZIALY} activeGroupId={null} onGroupChange={onGroupChange} />);

    const korzen = screen.getByRole("button", { name: "Bezpieczeństwo" });
    expect(korzen).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(korzen);
    expect(korzen).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Cyber/ })).not.toBeInTheDocument();
    // Zwinięcie NIE JEST zawężeniem strumienia.
    expect(onGroupChange).not.toHaveBeenCalled();

    fireEvent.click(korzen);
    expect(korzen).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Cyber/ })).toBeInTheDocument();
  });

  it("dział BEZ podgrup zaznacza od razu i nie ogłasza rozwinięcia", () => {
    const onGroupChange = vi.fn();
    render(<ClubGroupTree groups={DZIALY} activeGroupId={null} onGroupChange={onGroupChange} />);

    const liscien = screen.getByRole("button", { name: /^Energia/ });
    expect(liscien).not.toHaveAttribute("aria-expanded");
    fireEvent.click(liscien);
    expect(onGroupChange).toHaveBeenCalledWith("group-energia");
  });

  it("powtórny klik w zaznaczony dział ZDEJMUJE zawężenie", () => {
    const onGroupChange = vi.fn();
    render(
      <ClubGroupTree groups={DZIALY} activeGroupId="group-energia" onGroupChange={onGroupChange} />,
    );

    const liscien = screen.getByRole("button", { name: /^Energia/ });
    expect(liscien).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(liscien);
    expect(onGroupChange).toHaveBeenCalledWith(null);
  });

  it("poddział zaznacza się i odznacza tym samym wierszem", () => {
    const onGroupChange = vi.fn();
    const { unmount } = render(
      <ClubGroupTree groups={DZIALY} activeGroupId={null} onGroupChange={onGroupChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^NIS2/ }));
    expect(onGroupChange).toHaveBeenLastCalledWith("group-nis2");
    unmount();

    render(
      <ClubGroupTree groups={DZIALY} activeGroupId="group-nis2" onGroupChange={onGroupChange} />,
    );
    const zaznaczony = screen.getByRole("button", { name: /^NIS2/ });
    expect(zaznaczony).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(zaznaczony);
    expect(onGroupChange).toHaveBeenLastCalledWith(null);
  });

  it("ścieżka do zaznaczonego poddziału trzyma rodzica ROZWINIĘTEGO wbrew zwinięciu", () => {
    render(<ClubGroupTree groups={DZIALY} activeGroupId="group-nis2" onGroupChange={vi.fn()} />);

    const korzen = screen.getByRole("button", { name: "Bezpieczeństwo" });
    fireEvent.click(korzen);
    // Zwinięcie zapisało się w stanie, ale ścieżka do zaznaczenia wygrywa -
    // inaczej klik schowałby to, na co użytkownik patrzy.
    expect(korzen).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^NIS2/ })).toBeInTheDocument();
  });

  it("„wszystkie działy” zdejmuje zawężenie i traci zaznaczenie, gdy dział jest wybrany", () => {
    const onGroupChange = vi.fn();
    render(
      <ClubGroupTree groups={DZIALY} activeGroupId="group-cyber" onGroupChange={onGroupChange} />,
    );

    const wszystkie = screen.getByRole("button", { name: /club\.allGroups/ });
    expect(wszystkie).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(wszystkie);
    expect(onGroupChange).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Pasek poziomy (telefon i tablet)
// ---------------------------------------------------------------------------

describe("ClubGroupBar", () => {
  it("klub bez działów NIE dostaje paska - pusty pasek zajmuje wysokość i nic nie mówi", () => {
    const { container } = render(
      <ClubGroupBar groups={[]} activeGroupId={null} onGroupChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pasek jest PŁASKI: wypisuje wszystkie działy z ich WŁASNYM licznikiem", () => {
    render(<ClubGroupBar groups={DZIALY} activeGroupId={null} onGroupChange={vi.fn()} />);

    const pasek = screen.getByRole("navigation", { name: /club\.groups/ });
    expect(within(pasek).getAllByRole("button")).toHaveLength(DZIALY.length + 1);
    // 3, a nie 4: pasek nie sumuje gałęzi, bo nie pokazuje hierarchii.
    expect(screen.getByRole("button", { name: /^Cyber/ })).toHaveTextContent("3");
  });

  it("chip nieaktywny zawęża, a chip aktywny zdejmuje zawężenie", () => {
    const onGroupChange = vi.fn();
    const { unmount } = render(
      <ClubGroupBar groups={DZIALY} activeGroupId={null} onGroupChange={onGroupChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Energia/ }));
    expect(onGroupChange).toHaveBeenLastCalledWith("group-energia");
    unmount();

    render(
      <ClubGroupBar
        groups={DZIALY}
        activeGroupId="group-energia"
        onGroupChange={onGroupChange}
        className="mt-2"
      />,
    );
    const aktywny = screen.getByRole("button", { name: /^Energia/ });
    expect(aktywny).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(aktywny);
    expect(onGroupChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("navigation", { name: /club\.groups/ })).toHaveClass("mt-2");
  });

  it("chip „wszystkie” zdejmuje zawężenie", () => {
    const onGroupChange = vi.fn();
    render(
      <ClubGroupBar groups={DZIALY} activeGroupId="group-cyber" onGroupChange={onGroupChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /club\.allGroups/ }));
    expect(onGroupChange).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Panel wybranego działu
// ---------------------------------------------------------------------------

describe("ClubGroupPanel", () => {
  const drzewo = () => buildClubGroupTree(DZIALY);

  it("dział w głębi drzewa dostaje okruszki przodków, a każdy z nich zawęża", () => {
    const onGroupChange = vi.fn();
    render(
      <ClubGroupPanel
        node={wezel(DZIALY, "group-nis2")}
        path={clubGroupPath(drzewo(), "group-nis2")}
        documentCount={2}
        onGroupChange={onGroupChange}
      />,
    );

    const okruszki = screen.getByRole("navigation");
    const przodkowie = within(okruszki).getAllByRole("button");
    // Okruszki to ŚCIEŻKA BEZ SIEBIE: Bezpieczeństwo > Cyber (bez NIS2).
    expect(przodkowie.map((node) => node.textContent)).toEqual(["Bezpieczeństwo", "Cyber"]);

    fireEvent.click(przodkowie[1]!);
    expect(onGroupChange).toHaveBeenCalledWith("group-cyber");
  });

  it("dział przy korzeniu nie ma okruszków, ma opis i chipy podgrup", () => {
    const onGroupChange = vi.fn();
    render(
      <ClubGroupPanel
        node={wezel(DZIALY, "group-bezp")}
        path={clubGroupPath(drzewo(), "group-bezp")}
        documentCount={5}
        onGroupChange={onGroupChange}
      />,
    );

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Bezpieczeństwo");
    expect(screen.getByText("Sprawy obronne klubu.")).toBeInTheDocument();

    // Trzy metryki: wątki (2+3+1), materiały (5), podgrupy (1).
    expect(screen.getByText("club.groupPanel.threads").previousSibling).toHaveTextContent("6");
    expect(screen.getByText("club.groupPanel.documents").previousSibling).toHaveTextContent("5");
    expect(screen.getAllByText("club.groupPanel.subgroups")).toHaveLength(2);

    const chip = screen.getByRole("button", { name: /^Cyber/ });
    expect(chip).toHaveTextContent("4");
    fireEvent.click(chip);
    expect(onGroupChange).toHaveBeenCalledWith("group-cyber");
  });

  it("dział bez podgrup, bez opisu i bez ikony rysuje się bez metryki podgrup", () => {
    render(
      <ClubGroupPanel
        node={wezel(DZIALY, "group-energia")}
        path={clubGroupPath(drzewo(), "group-energia")}
        documentCount={0}
        onGroupChange={vi.fn()}
        className="mt-4"
      />,
    );

    const sekcja = screen.getByRole("region", { name: /^Energia/ });
    expect(sekcja).toHaveClass("mt-4");
    expect(screen.queryByText("club.groupPanel.subgroups")).not.toBeInTheDocument();
    expect(screen.getByText("club.groupPanel.threads").previousSibling).toHaveTextContent("0");
    // Opis pusty = brak akapitu, a nie akapit z pustką.
    expect(sekcja.querySelectorAll("p")).toHaveLength(0);
  });

  it("krzyżyk zdejmuje zawężenie do całego klubu", () => {
    const onGroupChange = vi.fn();
    render(
      <ClubGroupPanel
        node={wezel(DZIALY, "group-cyber")}
        path={clubGroupPath(drzewo(), "group-cyber")}
        documentCount={1}
        onGroupChange={onGroupChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "club.groupPanel.clear" }));
    expect(onGroupChange).toHaveBeenCalledWith(null);
  });
});
