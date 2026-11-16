// Ikona z treści CMS po NAZWIE - wspólna rozdzielczość ośmiu miejsc
// publicznego renderu (separator z ikoną, oś czasu: ikona wpisu i ikona
// tytułu, pasek „hot topic", newsletter z ikoną, nagłówek, przycisk, pasek
// ogłoszeń).
//
// PO CO. Do 16.11.2026 każde z tych miejsc indeksowało `import * as` shimu
// (`@/lib/lucide-shim`) nazwą z treści, więc rozpoznawało tylko 134 eksporty
// PascalCase. Wybieraki ikon (`LucideIconPicker` przez `SchemaFieldControl`)
// zapisują nazwy kebab-case z pełnego katalogu - te nigdy nie trafiały, więc
// wybrana ikona zawsze pokazywała zastępnik miejsca. Tak samo `Bell` (lista
// ikon paska ogłoszeń w `ThemeOptionsPane`) i `Flag` (domyślna osi czasu).
//
// KOLEJNOŚĆ (pierwsza trafiona wygrywa):
//  1. eksport shimu pod DOKŁADNIE tą nazwą - dzisiejsze wyszukiwanie, ten sam
//     komponent, więc HTML bajt w bajt jak przed naprawą (bez granicy
//     Suspense, bez nowego atrybutu). Jedyna różnica: tylko WŁASNE klucze
//     przestrzeni nazw - w artefakcie Rolldowna to zwykły obiekt, więc
//     `toString`/`constructor` z treści były metodą prototypu i wywracały
//     render; teraz idą dalej jak każda nieznana nazwa;
//  2. zestaw kuratorowany `DynamicIcon` (bez wielkości liter, kebab-case
//     i PascalCase) - synchronicznie, bez porcji katalogu (`Bell`, `Flag`,
//     `star`, `file-text`...);
//  3. poprawna nazwa wybieraka (małe litery i cyfry rozdzielone pojedynczym
//     `-`, alfabet katalogu `iconNames.generated.json`), której odpowiednik
//     PascalCase jest eksportem shimu (`send` -> `Send`, `trash-2` -> `Trash2`;
//     51 nazw; aliasy innych ikon, `redo-2` i `undo-2`, idą do katalogu) - ten
//     komponent synchronicznie: jest już w chunku startowym,
//     więc porcja katalogu (22-24 KB gzip w renderze czysto klienckim) byłaby
//     tylko kosztem (przegląd naprawy);
//  4. pozostała poprawna nazwa wybieraka - `DynamicIcon`
//     z pełnym katalogiem: serwer czeka na jedną porcję danych `icons-N`,
//     przeglądarka przy hydratacji odtwarza SVG z DOM-u serwera (bez porcji),
//     a porcję pobiera tylko render czysto kliencki (nawigacja SPA, kanwa);
//  5. zastępnik miejsca - jak dotąd.
//
// NAZWA WYBIERAKA, KTÓREJ KATALOG NIE ZNA (literówka w polu tekstowym osi
// czasu, ikona usunięta z lucide): zastępnik miejsca, jak przed naprawą, nie
// znak zapytania `DynamicIcon`. Czy nazwa jest w katalogu, wiadomo dopiero po
// porcji danych (synchroniczny indeks nazw to ~7 KB gzip w chunku startowym),
// więc rozstrzyga to `DynamicIcon` (`missing`): serwer rysuje zastępnik ze
// znacznikiem `data-dyn-missing`, a hydratacja czyta znacznik zamiast porcji.
//
// PUDEŁKO. Czekając na porcję (tylko render czysto kliencki), `DynamicIcon`
// rezerwuje kwadrat `size`. Miejsca, które wymiarują ikonę klasą (`w-4 h-4`,
// `size-4`...), podają tu ten sam wymiar w px (`boxSize`), więc rezerwacja
// = pudełko gotowej ikony; ikona z katalogu dostaje go też jako `size`
// (atrybuty `width`/`height`), a klasy miejsca nadal go nadpisują.
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import * as ShimIcons from "@/lib/lucide-shim";
import { curatedIcon, DynamicIcon } from "./DynamicIcon";

export type ContentIconComponent = ComponentType<LucideProps>;

const SHIM = ShimIcons as unknown as Readonly<Record<string, ContentIconComponent | undefined>>;

/** Alfabet nazw wybieraka: `alarm-clock-check`, `grid-2x2`, `x`. */
const PICKER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

/** Nazwa wybieraka -> PascalCase eksportu: `trash-2` -> `Trash2`, `grid-2x2` -> `Grid2x2`. */
const pickerToPascal = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

// Stała tożsamość komponentu na (zastępnik, pudełko, nazwa): nowy typ przy
// każdym renderze przemontowywałby ikonę (nowy węzeł SVG, utrata granicy).
const catalogIcons = new Map<ContentIconComponent | null, Map<string, ContentIconComponent>>();

function catalogIcon(
  name: string,
  fallback: ContentIconComponent | null,
  boxSize: number,
): ContentIconComponent {
  let byName = catalogIcons.get(fallback);
  if (!byName) {
    byName = new Map();
    catalogIcons.set(fallback, byName);
  }
  const cacheKey = `${boxSize}:${name}`;
  let Icon = byName.get(cacheKey);
  if (!Icon) {
    Icon = function CatalogContentIcon(props: LucideProps) {
      return <DynamicIcon size={boxSize} {...props} name={name} missing={fallback} />;
    };
    byName.set(cacheKey, Icon);
  }
  return Icon;
}

/**
 * Komponent ikony dla nazwy z treści CMS (kolejność w nagłówku modułu).
 *
 * @param name     nazwa z treści (dowolna wartość - nie-string to „brak nazwy")
 * @param fallback zastępnik miejsca (`null` - miejsce bez ikony)
 * @param boxSize  wymiar (px), w jakim miejsce rysuje ikonę - rezerwacja na
 *                 czas dociągania porcji katalogu
 */
export function contentIcon(
  name: unknown,
  fallback: ContentIconComponent,
  boxSize: number,
): ContentIconComponent;
export function contentIcon(
  name: unknown,
  fallback: ContentIconComponent | null,
  boxSize: number,
): ContentIconComponent | null;
export function contentIcon(
  name: unknown,
  fallback: ContentIconComponent | null,
  boxSize: number,
): ContentIconComponent | null {
  const value = typeof name === "string" ? name : "";
  const Shim = hasOwn(SHIM, value) ? SHIM[value] : undefined;
  if (Shim) return Shim;
  const Curated = curatedIcon(value);
  if (Curated) return Curated;
  if (PICKER_NAME.test(value) && !hasOwn(Object.prototype, value)) {
    const pascal = pickerToPascal(value);
    const ShimByPicker = hasOwn(SHIM, pascal) ? SHIM[pascal] : undefined;
    // Tylko gdy eksport shimu JEST ikoną lucide tej nazwy (`displayName`
    // z `createLucideIcon`): shim ma aliasy innych ikon (`Redo2` = `Redo`,
    // `Undo2` = `Undo`), a nazwa z wybieraka ma rysować glif z katalogu.
    if (ShimByPicker && (ShimByPicker as { displayName?: string }).displayName === pascal) {
      return ShimByPicker;
    }
    return catalogIcon(value, fallback, boxSize);
  }
  return fallback;
}
