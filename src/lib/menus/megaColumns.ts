// Reguły układu kolumn mega panelu - wyprowadzone z `MegaColumnsEditor`
// (organizm `MenuManager.tsx`).
//
// DLACZEGO OSOBNY MODUŁ. Edytor kolumn trzymał całą arytmetykę tablic
// (dołóż / zaktualizuj / usuń kolumnę, to samo dla linków w kolumnie,
// derywacja układu z drzewa pozycji) w domknięciach `onChange` wewnątrz JSX-a,
// przeplecionych z `<Input>`, `<Select>` i pickerami. Każda z tych operacji to
// zwykły reduktor na `MegaConfig` i tak też jest tu zapisana - komponent
// zostaje kompozycją pól formularza.
//
// Reduktory NIE MUTUJĄ wejścia i nie sprawdzają limitów schematu (`max(12)`
// kolumn, `max(30)` linków) - egzekwuje je `megaConfigSchema` przy zapisie,
// a UI nie ma prawa zgubić danych, których użytkownik jeszcze nie zapisał.
import type { MegaColumn, MegaColumnLink, MegaConfig } from "./types";
import type { MenuClientItem, MenuTreeNode } from "./tree";

/** Pusta kolumna dokładana przyciskiem „+ Kolumna". */
export const EMPTY_MEGA_COLUMN: MegaColumn = {
  title_pl: "",
  title_en: "",
  href: "",
  links: [],
};

/** Pusty link dokładany przyciskiem „+ Własny link". */
export const EMPTY_MEGA_LINK: MegaColumnLink = {
  label_pl: "",
  label_en: "",
  href: "",
  icon: "",
};

/**
 * Układ kolumn wyprowadzony z DRZEWA pozycji: dziecko pozycji z mega panelem
 * staje się kolumną, a wnuk - linkiem w tej kolumnie. To jest treść przycisku
 * „Importuj z drzewa" i jednocześnie fallback renderu, gdy administrator nie
 * ułożył kolumn ręcznie (patrz `megaColumnsFor` w `siteMenu.ts`).
 */
export function deriveMegaColumns(children: readonly MenuTreeNode<MenuClientItem>[]): MegaColumn[] {
  return children.map((col) => ({
    title_pl: col.item.label_pl,
    title_en: col.item.label_en,
    href: col.item.href,
    links: col.children.map((link) => ({
      label_pl: link.item.label_pl,
      label_en: link.item.label_en,
      href: link.item.href,
      icon: link.item.icon ?? "",
    })),
  }));
}

export function addMegaColumn(config: MegaConfig): MegaConfig {
  return { ...config, columns: [...config.columns, { ...EMPTY_MEGA_COLUMN }] };
}

export function updateMegaColumn(
  config: MegaConfig,
  index: number,
  patch: Partial<MegaColumn>,
): MegaConfig {
  return {
    ...config,
    columns: config.columns.map((col, i) => (i === index ? { ...col, ...patch } : col)),
  };
}

export function removeMegaColumn(config: MegaConfig, index: number): MegaConfig {
  return { ...config, columns: config.columns.filter((_, i) => i !== index) };
}

export function addMegaLink(
  config: MegaConfig,
  columnIndex: number,
  link: MegaColumnLink = EMPTY_MEGA_LINK,
): MegaConfig {
  const column = config.columns[columnIndex];
  if (!column) return config;
  return updateMegaColumn(config, columnIndex, { links: [...column.links, { ...link }] });
}

export function updateMegaLink(
  config: MegaConfig,
  columnIndex: number,
  linkIndex: number,
  patch: Partial<MegaColumnLink>,
): MegaConfig {
  const column = config.columns[columnIndex];
  if (!column) return config;
  return updateMegaColumn(config, columnIndex, {
    links: column.links.map((link, i) => (i === linkIndex ? { ...link, ...patch } : link)),
  });
}

export function removeMegaLink(
  config: MegaConfig,
  columnIndex: number,
  linkIndex: number,
): MegaConfig {
  const column = config.columns[columnIndex];
  if (!column) return config;
  return updateMegaColumn(config, columnIndex, {
    links: column.links.filter((_, i) => i !== linkIndex),
  });
}

/**
 * Powiązanie pola z treścią wewnętrzną (picker). Etykieta wpisana ręcznie
 * WYGRYWA z tytułem wskazanej treści - inaczej wybór strony kasowałby nazwę,
 * którą redaktor przed chwilą ustawił.
 */
export function linkPickedContent(
  current: MegaColumnLink,
  picked: { label_pl: string; label_en: string; href: string },
): MegaColumnLink {
  return {
    ...current,
    label_pl: current.label_pl || picked.label_pl,
    label_en: current.label_en || picked.label_en,
    href: picked.href,
  };
}

/** Ten sam wybór dla nagłówka kolumny (tytuł zamiast etykiety). */
export function columnPickedContent(
  current: MegaColumn,
  picked: { label_pl: string; label_en: string; href: string },
): Pick<MegaColumn, "title_pl" | "title_en" | "href"> {
  return {
    title_pl: current.title_pl || picked.label_pl,
    title_en: current.title_en || picked.label_en,
    href: picked.href,
  };
}
