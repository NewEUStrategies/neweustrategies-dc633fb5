// Model domenowy panelu „Bramki i limity" warstwy członkostwa.
//
// Panel admina pokazywał surową listę kluczy `features` w foncie maszynowym,
// bez podziału na obszary i bez informacji, co dana flaga realnie otwiera.
// Ten moduł zamienia rejestr capabilities w strukturę czytelną dla redakcji:
// grupy po obszarze bramki, licznik włączonych, rozdzielenie flag
// egzekwowanych od deklaracji marketingowych i osobna lista limitów liczbowych.
//
// Cała logika jest CZYSTA (string JSON -> struktura -> string JSON), żeby
// przełączniki, pole surowego JSON-a i zapis do bazy nigdy się nie rozjechały.
import {
  NUMERIC_FEATURE_KEYS,
  TIER_CAPABILITIES,
  type CapabilityGate,
  type CapabilityMeta,
} from "@/lib/billing/capabilities";

export type FeatureFlags = Record<string, unknown>;

/** Kolejność obszarów w panelu: najpierw to, co realnie bramkuje treść. */
export const GATE_ORDER: readonly CapabilityGate[] = [
  "content",
  "events",
  "chat",
  "qa",
  "tracker",
  "none",
] as const;

/** Limity liczbowe z własnym polem (poza `expert_request_quota`, ma edytor). */
export const TIER_LIMIT_KEYS: readonly string[] = NUMERIC_FEATURE_KEYS.filter(
  (key) => key !== "expert_request_quota",
);

export interface CapabilityItem {
  key: string;
  enabled: boolean;
  enforced: boolean;
  gate: CapabilityGate;
  /** Opis punktu egzekwowania w języku panelu. */
  where: string;
}

export interface CapabilityGroup {
  gate: CapabilityGate;
  items: CapabilityItem[];
  /** Ile flag w grupie jest włączonych. */
  enabledCount: number;
  /** Ile flag grupa ma łącznie. */
  totalCount: number;
}

export interface CapabilitySummary {
  enabled: number;
  enforced: number;
  decorative: number;
  total: number;
}

/** Bezpieczny parse draftu `features` - błędny JSON daje pusty obiekt. */
export function parseFeatureFlags(value: string): FeatureFlags {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as FeatureFlags) }
      : {};
  } catch {
    return {};
  }
}

/** Serializacja z powrotem do draftu (jedno miejsce, żeby format był stały). */
export function serializeFeatureFlags(flags: FeatureFlags): string {
  return JSON.stringify(flags);
}

function itemFrom(meta: CapabilityMeta, flags: FeatureFlags, lang: "pl" | "en"): CapabilityItem {
  return {
    key: meta.key,
    enabled: flags[meta.key] === true,
    enforced: meta.enforced,
    gate: meta.gate,
    where: lang === "en" ? meta.where_en : meta.where_pl,
  };
}

/**
 * Rejestr capabilities pogrupowany po obszarze bramki. Grupy puste są
 * pomijane, kolejność wynika z `GATE_ORDER`, a wewnątrz grupy flagi
 * egzekwowane idą przed dekoracyjnymi (najpierw realne uprawnienia).
 */
export function groupCapabilities(featuresJson: string, lang: "pl" | "en"): CapabilityGroup[] {
  const flags = parseFeatureFlags(featuresJson);
  return GATE_ORDER.map((gate) => {
    const items = TIER_CAPABILITIES.filter((meta) => meta.gate === gate)
      .map((meta) => itemFrom(meta, flags, lang))
      .sort((a, b) => Number(b.enforced) - Number(a.enforced));
    return {
      gate,
      items,
      enabledCount: items.filter((i) => i.enabled).length,
      totalCount: items.length,
    };
  }).filter((group) => group.totalCount > 0);
}

/** Podsumowanie stanu flag warstwy (nagłówek sekcji). */
export function summarizeCapabilities(featuresJson: string): CapabilitySummary {
  const flags = parseFeatureFlags(featuresJson);
  const enabledMetas = TIER_CAPABILITIES.filter((meta) => flags[meta.key] === true);
  const enforced = enabledMetas.filter((meta) => meta.enforced).length;
  return {
    enabled: enabledMetas.length,
    enforced,
    decorative: enabledMetas.length - enforced,
    total: TIER_CAPABILITIES.length,
  };
}

/** Przełączenie flagi boolowskiej - wyłączona flaga znika z JSON-a. */
export function toggleCapability(featuresJson: string, key: string): string {
  const flags = parseFeatureFlags(featuresJson);
  if (flags[key] === true) delete flags[key];
  else flags[key] = true;
  return serializeFeatureFlags(flags);
}

/** Odczyt limitu liczbowego (0 = brak). */
export function readLimit(featuresJson: string, key: string): number {
  const raw = parseFeatureFlags(featuresJson)[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Zapis limitu liczbowego; 0 / wartość niepoprawna usuwa klucz z JSON-a. */
export function writeLimit(featuresJson: string, key: string, next: number): string {
  const flags = parseFeatureFlags(featuresJson);
  if (!Number.isFinite(next) || next <= 0) delete flags[key];
  else flags[key] = Math.min(Math.floor(next), 9999);
  return serializeFeatureFlags(flags);
}

/**
 * Flagi spoza rejestru (eksperymentalne / historyczne). Redakcja musi je
 * widzieć, bo inaczej „znikają" po przejściu na przełączniki, a zostają w bazie.
 */
export function unknownFlagKeys(featuresJson: string): string[] {
  const known = new Set<string>([
    ...TIER_CAPABILITIES.map((c) => c.key),
    ...NUMERIC_FEATURE_KEYS,
  ]);
  return Object.keys(parseFeatureFlags(featuresJson))
    .filter((key) => !known.has(key))
    .sort();
}
