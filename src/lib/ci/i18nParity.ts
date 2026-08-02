// Czysta logika bramki parytetu tłumaczeń PL/EN.
//
// Używana przez test-bramkę (src/__tests__/i18nParity.gate.test.ts), która
// ładuje wszystkie nakładki `src/lib/i18n-*.ts` oraz rdzenne słowniki i
// porównuje pełne zbiory kluczy dla PL i EN. Moduł nie zna i18next - dostaje
// gotowe drzewa zasobów, więc jest w pełni testowalny.
export type ResourceTree = Record<string, unknown>;

/** Spłaszcza zagnieżdżone drzewo zasobów do listy kluczy `a.b.c`. */
export function flattenKeys(tree: ResourceTree, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenKeys(value as ResourceTree, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/** Odczytuje wartość spod klucza `a.b.c` (null, gdy brak). */
export function readKey(tree: ResourceTree, path: string): unknown {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return null;
    node = (node as ResourceTree)[part];
  }
  return node ?? null;
}

export interface ParityDiff {
  /** Klucze obecne w PL, brakujące w EN. */
  readonly missingEn: readonly string[];
  /** Klucze obecne w EN, brakujące w PL. */
  readonly missingPl: readonly string[];
  /** Klucze, których wartość EN jest pusta lub identyczna z PL (nieprzetłumaczone). */
  readonly untranslated: readonly string[];
}

export interface ParityOptions {
  /** Tylko klucze zaczynające się od jednego z prefiksów są bramkowane. */
  readonly gatedPrefixes?: readonly string[];
  /** Klucze (pełne ścieżki), dla których identyczność PL/EN jest poprawna. */
  readonly identicalAllowlist?: readonly string[];
}

function isGated(key: string, prefixes: readonly string[] | undefined): boolean {
  if (prefixes === undefined || prefixes.length === 0) return true;
  return prefixes.some((p) => key === p || key.startsWith(`${p}.`));
}

/**
 * Kategorie liczby mnogiej CLDR występujące tylko w polskim (`few`, `many`).
 * Angielski ma wyłącznie `one`/`other`, więc brak takiego wariantu po stronie
 * EN nie jest luką w tłumaczeniu, tylko cechą języka.
 */
const PL_ONLY_PLURAL = /_(few|many)$/;

function isPlOnlyPluralVariant(key: string): boolean {
  return PL_ONLY_PLURAL.test(key);
}

/** Porównuje drzewa PL i EN i zwraca różnice ograniczone do bramkowanych prefiksów. */
export function diffParity(
  pl: ResourceTree,
  en: ResourceTree,
  options: ParityOptions = {},
): ParityDiff {
  const plKeys = flattenKeys(pl);
  const enKeys = new Set(flattenKeys(en));
  const plSet = new Set(plKeys);

  const missingEn: string[] = [];
  const untranslated: string[] = [];
  const allow = new Set(options.identicalAllowlist ?? []);

  for (const key of plKeys) {
    if (!isGated(key, options.gatedPrefixes)) continue;
    if (!enKeys.has(key)) {
      if (!isPlOnlyPluralVariant(key)) missingEn.push(key);
      continue;
    }
    const plValue = readKey(pl, key);
    const enValue = readKey(en, key);
    if (typeof plValue !== "string" || typeof enValue !== "string") continue;
    if (allow.has(key)) continue;
    const enTrimmed = enValue.trim();
    if (enTrimmed === "" || (enTrimmed === plValue.trim() && /\p{L}{4,}/u.test(enTrimmed))) {
      untranslated.push(key);
    }
  }

  const missingPl = [...enKeys].filter(
    (key) => isGated(key, options.gatedPrefixes) && !plSet.has(key),
  );

  return {
    missingEn: missingEn.sort(),
    missingPl: missingPl.sort(),
    untranslated: untranslated.sort(),
  };
}

/** Czy różnica powinna zablokować CI. */
export function parityFailed(diff: ParityDiff): boolean {
  return diff.missingEn.length > 0 || diff.missingPl.length > 0;
}

/** Czytelny raport dla logu CI. */
export function renderParityReport(diff: ParityDiff, limit = 40): string {
  const section = (title: string, keys: readonly string[]): string[] =>
    keys.length === 0
      ? []
      : [
          "",
          `### ${title} (${keys.length})`,
          ...keys.slice(0, limit).map((k) => `- \`${k}\``),
          ...(keys.length > limit ? [`- … i ${keys.length - limit} więcej`] : []),
        ];

  return [
    "## Parytet tłumaczeń PL/EN",
    ...section("Brak tłumaczenia EN", diff.missingEn),
    ...section("Brak klucza PL", diff.missingPl),
    ...section("Wartość EN identyczna z PL / pusta", diff.untranslated),
  ].join("\n");
}
