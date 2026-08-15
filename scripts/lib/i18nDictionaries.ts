// Scalone drzewa zasobów PL/EN - rdzeń plus WSZYSTKIE nakładki `i18n-*.ts`.
//
// PO CO OSOBNY MODUŁ. Bramki żyjące w vitest dostają nakładki przez
// `import.meta.glob` (Vite zamienia go na statyczne importy). Skrypty w
// `scripts/` chodzą pod `bun` bez Vite, więc glob nie istnieje - a bramka
// porównująca kod z SAMYM RDZENIEM jest zielona i ślepa naraz (rdzeń ma 19
// kluczy najwyższego poziomu, komplet ma 114). Ten moduł jest jedynym miejscem,
// które wie, jak złożyć komplet pod bunem.
//
// KANAREK WARTOŚCI DOWODOWEJ. `loadDictionaries()` sprawdza klucz żyjący
// WYŁĄCZNIE w nakładce i wywala się, gdy go nie widzi. Bez tego cicha zmiana
// konwencji nakładek (inna nazwa pliku, rejestracja przez funkcję zamiast
// efektu ubocznego) zamieniłaby każdą korzystającą bramkę w atrapę.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import type { ResourceTree } from "@/lib/ci/i18nParity";

const OVERLAY_DIR = "src/lib";
const OVERLAY_PATTERN = /^i18n-[\w-]+\.ts$/;

/** Klucz obecny w nakładce `i18n-admin-extras.ts`, nigdy w `locale/pl.ts`. */
const OVERLAY_ONLY_KEY = ["admin", "autosave", "saving"] as const;

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base: ResourceTree, overlay: ResourceTree): ResourceTree {
  const out: ResourceTree = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    out[key] = isTree(value) && isTree(existing) ? deepMerge(existing, value) : value;
  }
  return out;
}

export function overlayFiles(): string[] {
  return readdirSync(OVERLAY_DIR)
    .filter((entry) => OVERLAY_PATTERN.test(entry))
    .sort()
    .map((entry) => join(OVERLAY_DIR, entry));
}

export interface Dictionaries {
  readonly pl: ResourceTree;
  readonly en: ResourceTree;
  readonly overlays: number;
}

/** Rejestruje nakładki (efekt uboczny importu) i zwraca scalone drzewa. */
export async function loadDictionaries(): Promise<Dictionaries> {
  const files = overlayFiles();
  for (const file of files) {
    await import(join(process.cwd(), file));
  }

  const bundle = (lang: "pl" | "en", core: ResourceTree): ResourceTree => {
    const registered = i18n.getResourceBundle(lang, "translation");
    return deepMerge(core, isTree(registered) ? registered : {});
  };

  const pl = bundle("pl", corePl as ResourceTree);
  const en = bundle("en", coreEn as ResourceTree);

  for (const [lang, tree] of [
    ["pl", pl],
    ["en", en],
  ] as const) {
    const probe = OVERLAY_ONLY_KEY.reduce<unknown>(
      (node, segment) => (isTree(node) ? node[segment] : undefined),
      tree,
    );
    if (typeof probe !== "string") {
      throw new Error(
        `[i18n] Nakładki nie weszły dla ${lang}: klucz ${OVERLAY_ONLY_KEY.join(".")} żyje tylko` +
          ` w nakładce, a scalone drzewo go nie widzi. Każda bramka na tych drzewach byłaby atrapą.`,
      );
    }
  }

  return { pl, en, overlays: files.length };
}
