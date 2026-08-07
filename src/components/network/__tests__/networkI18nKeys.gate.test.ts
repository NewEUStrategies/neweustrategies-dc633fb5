// Bramka CI: żaden klucz i18n używany na powierzchni SIECI KONTAKTÓW nie może
// istnieć wyłącznie w kodzie.
//
// Dlaczego osobna bramka obok parytetu PL/EN: parytet porównuje słowniki ze
// sobą, więc klucz nieobecny w OBU jest dla niego niewidzialny. Dokładnie tak
// wyglądał rozjazd, który już raz przeszedł tu przez review -
// `t("network.mutualLinkAria", { defaultValue: "Zobacz ... wspólnych kontaktów" })`:
// PL renderował polski `defaultValue`, EN renderował ten sam polski tekst,
// a bramka parytetu świeciła na zielono, bo w słownikach nie było czego
// porównać. Ta bramka patrzy od strony KODU i traktuje `defaultValue` jako
// obciążenie, nie jako zabezpieczenie.
//
// Zakres: komponenty i warstwa danych sieci + trasy, które je montują.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import type { ResourceTree } from "@/lib/ci/i18nParity";
import {
  auditKeyUsage,
  keyUsageFailed,
  renderKeyUsageReport,
  scanKeyUsage,
  type KeyUsage,
} from "@/lib/ci/i18nKeyUsage";

// Skanowane katalogi: UI sieci + hooki RPC (komunikaty błędów żyją tam).
const SCANNED_DIRS = ["src/components/network", "src/lib/network"] as const;

// Korzenie, w których gołe literały w kodzie są referencją do klucza
// (mapy kodów RPC -> klucz, propsy `emptyKey`, ternary z nazwą toasta).
const REFERENCE_PREFIXES = ["network", "directMessage", "expertRequest", "people"] as const;

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Nakładki i18n rejestrują zasoby jako efekt uboczny importu. */
function loadOverlays(): void {
  const modules = import.meta.glob("/src/lib/i18n-*.ts", { eager: true });
  expect(Object.keys(modules).length).toBeGreaterThan(0);
}

function deepMerge(base: ResourceTree, overlay: ResourceTree): ResourceTree {
  const out: ResourceTree = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    out[key] = isTree(value) && isTree(existing) ? deepMerge(existing, value) : value;
  }
  return out;
}

function bundle(lang: "pl" | "en", core: ResourceTree): ResourceTree {
  const registered = i18n.getResourceBundle(lang, "translation");
  return deepMerge(core, isTree(registered) ? registered : {});
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // Pliki testowe są poza skanem - to one deklarują klucze-atrapy.
      if (entry === "__tests__") continue;
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

function collectUsage(): KeyUsage[] {
  const out: KeyUsage[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of sourceFiles(dir)) {
      out.push(
        ...scanKeyUsage(file, readFileSync(file, "utf8"), {
          referencePrefixes: [...REFERENCE_PREFIXES],
        }),
      );
    }
  }
  return out;
}

describe("słownik sieci kontaktów - bramka rozjazdu kod <-> PL/EN", () => {
  it("każdy klucz użyty w kodzie sieci istnieje w PL i w EN", () => {
    loadOverlays();
    const usage = collectUsage();
    // Skan musi realnie coś znaleźć - inaczej zielona bramka nic nie dowodzi.
    expect(usage.length).toBeGreaterThan(60);

    const audit = auditKeyUsage(usage, {
      pl: bundle("pl", corePl as ResourceTree),
      en: bundle("en", coreEn as ResourceTree),
    });

    expect(keyUsageFailed(audit), renderKeyUsageReport(audit)).toBe(false);
  });

  it("skan pokrywa maszynę stanów ConnectButton (kanarek zasięgu)", () => {
    const keys = new Set(collectUsage().map((u) => u.key));
    // Po jednym kluczu na każdy stan relacji + bramkę zaproszenia: gdyby skaner
    // przestał widzieć wywołania `t()` w tym pliku, bramka wyżej zrobiłaby się
    // pusta i zielona. Ten test tego nie pozwala przeoczyć.
    for (const key of [
      "network.connect",
      "network.pendingOut",
      "network.accept",
      "network.connected",
      "network.inviteBlocked",
      "network.rateLimited",
      "network.reportReasons",
      "network.introductions.status",
      "network.recommendations.errors.notConnected",
    ]) {
      expect(keys, `brak klucza ${key} w skanie`).toContain(key);
    }
  });

  it("żadne wywołanie t() w sieci nie polega na defaultValue", () => {
    // `defaultValue` w tej warstwie zawsze był polskim tekstem, więc dla EN
    // działał jak cichy fallback na PL. Słownik jest jedynym źródłem prawdy.
    const masked = collectUsage().filter((u) => u.defaultValue !== null);
    expect(masked.map((u) => `${u.file}:${u.line} ${u.key} -> "${u.defaultValue}"`)).toEqual([]);
  });
});
