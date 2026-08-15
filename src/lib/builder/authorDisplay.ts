// Kanoniczny kontrakt prezentacji AUTORA w widgetach buildera (warstwa domeny).
//
// PROBLEM, KTÓRY TEN MODUŁ LIKWIDUJE
// Każdy widget z bylinem miał WŁASNĄ kopię reguły "jak pokazać autora":
//   * `postListQuery.postListAuthorDisplay` - trójstan avatar/label/none,
//   * `sliderVariants.SliderRender`         - trójstan + `authorSizePx`,
//   * `PostListView.AuthorMeta`             - sztywne 20 px awatara, brak rozmiaru czcionki,
//   * `RatedListView` / `TailoredMustReadsView` / `DynamicTagWidgets` - `AuthorInline`
//     z zaszytymi domyślnymi wartościami, bez żadnej możliwości edycji.
// Efekt: ten sam autor renderował się w czterech różnych rozmiarach, a redakcja
// mogła zmienić rozmiar WYŁĄCZNIE w sliderze. Trójstan dodatkowo NIE POTRAFIŁ
// wyrazić "sam awatar bez nazwiska" - wymiary i widoczność były sklejone.
//
// ROZWIĄZANIE: DWIE NIEZALEŻNE OSIE + JEDEN REZOLWER
//   widoczność: `showAuthorName` ⟂ `showAuthorAvatar` (chowane osobno),
//   wymiary:    `authorSizePx` (12 px) ⟂ `authorAvatarSizePx` (20 px).
// Trójstan `authorDisplay` zostaje jako klucz HISTORYCZNY (czytany, nigdy
// zapisywany jako jedyne źródło prawdy), więc dokumenty sprzed ujednolicenia
// renderują się bez zmian.
//
// Moduł jest CZYSTY (bez Reacta, DOM-u i I/O) - tę samą regułę czyta panel
// właściwości, kanwa buildera, SSR strony publicznej i warstwa zapytań
// (`withAuthors`), więc "panel obiecuje / renderer nie czyta" nie ma jak wrócić.
import {
  asBool,
  asNumInRange,
  asStr,
  isContentValueSet,
  type ContentLang,
} from "@/lib/content-model/contentValue";

/**
 * Strukturalny kontrakt wejścia rezolwera.
 *
 * Świadomie NIE `Record<string, unknown>`: config slidera jest interfejsem, a
 * nie workiem, więc worek wymusiłby rzutowanie w miejscu wywołania (a każde
 * rzutowanie to miejsce, w którym literówka w nazwie klucza przestaje boleć).
 * Wartości są `unknown`, bo to samo ustawienie bywa zapisane jako `boolean`,
 * `"1"` albo `1` - koercję robi `contentValue`, nie wołający. Worek treści
 * (`ContentBag`) jest przypisywalny do tego typu bez żadnego rzutowania.
 */
export interface AuthorDisplayContent {
  readonly showAuthor?: unknown;
  readonly authorDisplay?: unknown;
  readonly showAuthorLabel?: unknown;
  readonly showAuthorName?: unknown;
  readonly showAuthorAvatar?: unknown;
  readonly authorSizePx?: unknown;
  readonly authorAvatarSizePx?: unknown;
  readonly authorLabel_pl?: unknown;
  readonly authorLabel_en?: unknown;
  /** Historyczny przełącznik zdjęcia w karcie autora (`post-author-card`). */
  readonly showAvatar?: unknown;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Kontrakt wymiarów (jedno źródło prawdy dla panelu, renderera i testów)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Domyślny rozmiar czcionki imienia i nazwiska autora (px). */
export const AUTHOR_NAME_SIZE_PX_DEFAULT = 12;
/** Domyślny rozmiar zdjęcia profilowego eksperta (px). */
export const AUTHOR_AVATAR_SIZE_PX_DEFAULT = 20;
/** Domyślne zaokrąglenie awatara (px). Kwadrat z lekkim promieniem. */
export const AUTHOR_AVATAR_RADIUS_PX_DEFAULT = 6;

/** Zakres rozmiaru czcionki autora oferowany w panelu. */
export const AUTHOR_NAME_SIZE_PX_MIN = 8;
export const AUTHOR_NAME_SIZE_PX_MAX = 24;
/** Zakres rozmiaru awatara oferowany w panelu. */
export const AUTHOR_AVATAR_SIZE_PX_MIN = 8;
export const AUTHOR_AVATAR_SIZE_PX_MAX = 64;

/* ────────────────────────────────────────────────────────────────────────────
 * Klucze treści
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Klucze KANONICZNE - te i tylko te zapisuje panel.
 * Wystawione, bo bramka wierności ustawień i testy jednostkowe muszą mówić
 * o tym samym zbiorze co implementacja.
 */
export const AUTHOR_DISPLAY_KEYS = {
  showName: "showAuthorName",
  showAvatar: "showAuthorAvatar",
  nameSizePx: "authorSizePx",
  avatarSizePx: "authorAvatarSizePx",
  /** Baza pary i18n `authorLabel_pl` / `authorLabel_en`. */
  label: "authorLabel",
} as const;

/**
 * Klucze HISTORYCZNE, czytane wyłącznie jako wartość domyślna (nigdy jako
 * jedyne źródło prawdy). Panel utrzymuje je w spójności zapisem, żeby dokument
 * otwarty w starszej wersji aplikacji nadal wyglądał tak samo:
 *
 *   `showAuthor`      - jeden włącznik gaszący całą sekcję autora,
 *   `authorDisplay`   - trójstan avatar | label | none,
 *   `showAuthorLabel` - para z `showAuthorAvatar`: czy pokazać prefiks „Autor:”,
 *   `showAvatar`      - przełącznik zdjęcia karty autora (`post-author-card`).
 *
 * Ich odczyt żyje w `resolveAuthorDisplay` - jednym miejscu, po nazwie pola,
 * więc literówka jest błędem typów, a nie cichą regresją.
 */
const AUTHOR_DISPLAY_MODES = ["avatar", "label", "none"] as const;

/** Trójstan historyczny - nadal używany przez warstwę zapytań i atrybuty DOM. */
export type AuthorDisplayMode = (typeof AUTHOR_DISPLAY_MODES)[number];

/* ────────────────────────────────────────────────────────────────────────────
 * Rezolwer
 * ──────────────────────────────────────────────────────────────────────────── */

/** Baseline widgetu: czym różni się jego domyślna prezentacja od globalnej. */
export interface AuthorDisplayDefaults {
  readonly showName?: boolean;
  readonly showAvatar?: boolean;
  readonly nameSizePx?: number;
  readonly avatarSizePx?: number;
  readonly avatarRadiusPx?: number;
}

/** Rozstrzygnięta prezentacja autora - gotowa do przekazania do komponentu. */
export interface AuthorDisplay {
  /** Czy sekcja autora renderuje się w ogóle (nazwisko LUB awatar). */
  readonly visible: boolean;
  readonly showName: boolean;
  readonly showAvatar: boolean;
  readonly nameSizePx: number;
  readonly avatarSizePx: number;
  readonly avatarRadiusPx: number;
  /**
   * Prefiks przed nazwiskiem, gdy zdjęcie jest schowane („Autor: ” / „By: ”).
   * Pusty, gdy awatar jest widoczny - wtedy zdjęcie samo pełni rolę etykiety.
   */
  readonly labelPrefix: string;
  /** Trójstan historyczny wyliczony z dwóch osi (dla zapytań i `data-*`). */
  readonly mode: AuthorDisplayMode;
}

/** Domyślna etykieta prefiksu, gdy redakcja nie wpisała własnej. */
export function defaultAuthorLabel(lang: ContentLang): string {
  return lang === "en" ? "By" : "Autor";
}

/**
 * Etykieta autora wpisana przez redakcję (bez dwukropka), pusta gdy nie ustawiono.
 * Ten sam klucz obsługuje prefiks bylinu i nadtytuł karty autora, więc redakcja
 * zmienia „Autor” na np. „Redakcja” w JEDNYM miejscu.
 */
export function authorLabelText(content: AuthorDisplayContent, lang: ContentLang): string {
  return asStr(lang === "en" ? content.authorLabel_en : content.authorLabel_pl)
    .trim()
    .replace(/\s*:\s*$/, "");
}

/**
 * Domyka etykietę dwukropkiem DOKŁADNIE RAZ, więc redakcja może wpisać zarówno
 * „Autor”, jak i „Autor:” - nigdy nie powstanie „Autor: : Jan Kowalski”.
 */
export function formatAuthorLabelPrefix(label: string): string {
  const trimmed = label.trim().replace(/\s*:\s*$/, "");
  return trimmed ? `${trimmed}: ` : "";
}

/** Trójstan historyczny z dwóch osi widoczności. */
function toMode(showName: boolean, showAvatar: boolean): AuthorDisplayMode {
  if (!showName && !showAvatar) return "none";
  return showAvatar ? "avatar" : "label";
}

/**
 * Rozstrzyga prezentację autora dla dowolnego worka treści widgetu.
 *
 * PRECEDENCJA (od najsłabszej do najsilniejszej):
 *   1. baseline widgetu (`defaults`) - domyślnie 12 px / 20 px, oba włączone,
 *   2. `showAuthor` (historyczny wyłącznik całej sekcji),
 *   3. `authorDisplay` (historyczny trójstan),
 *   4. para `showAuthorAvatar` + `showAuthorLabel` (historyczna, tylko gdy nie
 *      ma ani `authorDisplay`, ani kanonicznego `showAuthorName`),
 *   5. klucze kanoniczne `showAuthorName` / `showAuthorAvatar`.
 *
 * WSZYSTKIE klucze są odczytywane BEZWARUNKOWO, zanim zaczną się rozgałęzienia.
 * To nie jest kosmetyka: bramka wierności ustawień mierzy odczyty przez Proxy,
 * więc odczyt schowany za `if`-em zmieniałby mierzalny zbiór ustawień zależnie
 * od danych i potrafiłby zgłosić żywe ustawienie jako martwe.
 */
export function resolveAuthorDisplay(
  content: AuthorDisplayContent,
  lang: ContentLang,
  defaults: AuthorDisplayDefaults = {},
): AuthorDisplay {
  const rawShowAuthor = content.showAuthor;
  const rawAuthorDisplay = content.authorDisplay;
  const rawShowAuthorLabel = content.showAuthorLabel;
  const rawShowName = content.showAuthorName;
  const rawShowAvatar = content.showAuthorAvatar;
  const rawNameSize = content.authorSizePx;
  const rawAvatarSize = content.authorAvatarSizePx;
  const rawLabel = authorLabelText(content, lang);

  const baseName = defaults.showName ?? true;
  const baseAvatar = defaults.showAvatar ?? true;
  let showName = baseName;
  let showAvatar = baseAvatar;

  // (2) Historyczny wyłącznik całej sekcji. Tylko wyłącza - włączenie zostawia
  //     baseline widgetu nietknięty.
  if (isContentValueSet(rawShowAuthor) && !asBool(rawShowAuthor, true)) {
    showName = false;
    showAvatar = false;
  }

  // (3) Historyczny trójstan. Wygrywa z `showAuthor` (tak samo jak dotąd
  //     w `postListAuthorDisplay` i w sliderze).
  const legacyMode = asStr(rawAuthorDisplay).trim();
  if (legacyMode === "none") {
    showName = false;
    showAvatar = false;
  } else if (legacyMode === "avatar") {
    showName = true;
    showAvatar = true;
  } else if (legacyMode === "label") {
    showName = true;
    showAvatar = false;
  }

  // (4) Historyczna para avatar/etykieta post-listy: OBA wyłączone = brak autora.
  //     Czytana wyłącznie wtedy, gdy nic nowszego nie rozstrzygnęło sprawy.
  const legacyModeKnown =
    legacyMode === "none" || legacyMode === "avatar" || legacyMode === "label";
  if (!legacyModeKnown && !isContentValueSet(rawShowName)) {
    const legacyAvatar = asBool(rawShowAvatar, baseAvatar);
    const legacyLabel = asBool(rawShowAuthorLabel, true);
    if (!legacyAvatar && !legacyLabel) {
      showName = false;
      showAvatar = false;
    }
  }

  // (5) Klucze kanoniczne - najsilniejsze, bo to jedyne, które zapisuje panel.
  if (isContentValueSet(rawShowAvatar)) showAvatar = asBool(rawShowAvatar, showAvatar);
  if (isContentValueSet(rawShowName)) showName = asBool(rawShowName, showName);

  const nameSizePx = asNumInRange(
    rawNameSize,
    defaults.nameSizePx ?? AUTHOR_NAME_SIZE_PX_DEFAULT,
    AUTHOR_NAME_SIZE_PX_MIN,
    AUTHOR_NAME_SIZE_PX_MAX,
  );
  const avatarSizePx = asNumInRange(
    rawAvatarSize,
    defaults.avatarSizePx ?? AUTHOR_AVATAR_SIZE_PX_DEFAULT,
    AUTHOR_AVATAR_SIZE_PX_MIN,
    AUTHOR_AVATAR_SIZE_PX_MAX,
  );

  // Prefiks „Autor: ” pojawia się DOKŁADNIE wtedy, gdy zdjęcie jest schowane,
  // a nazwisko zostaje - inaczej byline byłby gołym imieniem bez kontekstu.
  const labelPrefix =
    showName && !showAvatar ? formatAuthorLabelPrefix(rawLabel || defaultAuthorLabel(lang)) : "";

  return {
    visible: showName || showAvatar,
    showName,
    showAvatar,
    nameSizePx,
    avatarSizePx,
    avatarRadiusPx: defaults.avatarRadiusPx ?? AUTHOR_AVATAR_RADIUS_PX_DEFAULT,
    labelPrefix,
    mode: toMode(showName, showAvatar),
  };
}

/**
 * Sam trójstan, bez wymiarów. Dla warstwy zapytań (`withAuthors`) i atrybutów
 * `data-*`, które nie potrzebują reszty kontraktu.
 *
 * Język nie wpływa na widoczność, więc wołający, który zna tylko treść (klucz
 * zapytania jest wspólny dla PL i EN), nie musi go znać.
 */
export function authorDisplayMode(
  content: AuthorDisplayContent,
  defaults: AuthorDisplayDefaults = {},
): AuthorDisplayMode {
  return resolveAuthorDisplay(content, "pl", defaults).mode;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Katalog widgetów z autorem
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Katalog widgetów z bylinem autora: typ -> KTO rysuje kontrolkę w panelu.
 *
 *   "editor" - widget ma własny edytor i wpina kontrolkę w swoją sekcję
 *              „Wyświetlanie" (panel nie może dorysować jej drugi raz,
 *              bo redakcja zobaczyłaby dwa komplety przełączników),
 *   "panel"  - widget jest schematowy, więc kontrolkę dorysowuje zakładka „Treść".
 *
 * JEDNA tabela zamiast dwóch list: „czy widget ma autora" i „gdzie mieszka jego
 * kontrolka" to dwa odczyty tego samego faktu, a rozjazd między nimi znaczyłby
 * albo kontrolkę-widmo, albo dublet. Katalog jest wspólny dla panelu i
 * renderera, więc bramka wierności ustawień pilnuje go w obie strony.
 */
const AUTHOR_DISPLAY_WIDGET_CATALOG: Readonly<Record<string, "panel" | "editor">> = {
  "post-list": "editor",
  carousel: "editor",
  slider: "editor",
  "rated-list": "editor",
  "tailored-must-reads": "panel",
  "post-meta": "panel",
  "post-author-card": "panel",
  testimonial: "panel",
};

/** Typy widgetów z bylinem autora (kolejność katalogu). */
export const AUTHOR_DISPLAY_WIDGETS: ReadonlyArray<string> = Object.freeze(
  Object.keys(AUTHOR_DISPLAY_WIDGET_CATALOG),
);

/** Czy widget danego typu rysuje byline autora (i dostaje kontrolkę w panelu). */
export function widgetHasAuthorDisplay(type: string): boolean {
  return type in AUTHOR_DISPLAY_WIDGET_CATALOG;
}

/** Czy zakładka „Treść" ma dorysować wspólną kontrolkę autora dla tego typu. */
export function needsSharedAuthorControl(type: string): boolean {
  return AUTHOR_DISPLAY_WIDGET_CATALOG[type] === "panel";
}

/**
 * Baseline prezentacji autora dla konkretnego typu widgetu.
 *
 * Czytany przez OBIE strony (panel i renderer), więc historyczny przełącznik
 * widgetu (`post-author-card.showAvatar`) nadal działa jako wartość domyślna
 * osi awatara, a kanoniczny `showAuthorAvatar` może go nadpisać.
 */
export function widgetAuthorDisplayDefaults(
  type: string,
  content: AuthorDisplayContent,
): AuthorDisplayDefaults {
  switch (type) {
    case "post-author-card":
      // Historyczny przełącznik zdjęcia tego widgetu. Panel nie rysuje go już
      // osobno (zastąpiła go wspólna oś „Zdjęcie autora"), ale dokumenty sprzed
      // ujednolicenia muszą dalej chować awatar.
      return { showAvatar: asBool(content.showAvatar, true) };
    default:
      // Reszta widgetów nie ma własnego baselineu - obowiązuje kontrakt
      // globalny: 12 px nazwiska, 20 px zdjęcia, 6 px zaokrąglenia.
      return {};
  }
}

/**
 * Patch treści zapisywany przez panel przy zmianie widoczności.
 *
 * Panel pisze klucze kanoniczne I dosypuje spójne wartości historyczne, żeby
 * dokument otwarty w starszym wydaniu aplikacji (albo przez renderer, który
 * jeszcze nie przeszedł na rezolwer) pokazywał to samo. Bez tego „schowaj
 * zdjęcie” działałoby w kanwie, a na produkcji nie.
 */
export function authorVisibilityPatch(
  showName: boolean,
  showAvatar: boolean,
): Readonly<Record<string, boolean | string>> {
  const mode = toMode(showName, showAvatar);
  return {
    [AUTHOR_DISPLAY_KEYS.showName]: showName,
    [AUTHOR_DISPLAY_KEYS.showAvatar]: showAvatar,
    // Klucze historyczne - patrz komentarz przy `AUTHOR_DISPLAY_MODES`.
    showAuthor: mode !== "none",
    authorDisplay: mode,
    showAuthorLabel: mode === "label",
  };
}
