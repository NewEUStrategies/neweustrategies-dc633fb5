// Server fn edytora ścieżek (S8) - szczegół ścieżki, wersja i katalog galerii.
//
// LUKA API S5 (SPEC §5.2): kontrakt przewidywał `getJourney` i
// `listJourneyVersions`, ale S5 dał wyłącznie RPC listy i zapisów. S8 nie
// dokłada SQL, więc szczegół czytamy z TABEL przez RLS: `journey_definitions`,
// `journey_versions` i `journey_email_contents` mają `GRANT SELECT TO
// authenticated` i politykę `tenant_id = current_tenant_id() AND
// is_admin_or_editor()`. Najemca NIGDY nie przychodzi w parametrach - zawęża go
// polityka po sesji; middleware `requireCrmStaff` (admin/redaktor + aal2 dla
// kont z MFA) odcina wcześniej, baza i tak sprawdza drugi raz.
//
// LITERAŁY TABEL I JAWNE KOLUMNY: bramka `generate:ts-sql-contract` czyta
// `.from("…")` i listę kolumn ze źródła i sprawdza granty w żywej bazie.
//
// STANY ODCZYTU zamiast wyjątków (jak `journeys.functions.ts`): 42501 ->
// `forbidden`; brak relacji/kolumny (42P01, 42703) i błędy pamięci schematu
// PostgREST (PGRST2xx) -> `unavailable` (okno wdrożenia, nie awaria); brak
// wiersza -> `not_found`. Reszta to wyjątek - zła odpowiedź ma być głośna.
//
// SZKIC ŁAGODNIE: `draft` z bazy przechodzi `JourneyDraftSchema`, ale zły
// szkic nie wywraca odczytu - edytor dostaje `draftValid: false` i surowe dane,
// pokazuje problem i pozwala go naprawić (pusty szkic z `createJourney` nie ma
// wyzwalacza, a stary szkic mógł powstać przed zmianą schematu).
//
// DRUT I DTO. Wynik server fn musi być serializowalny w typach Start, a graf
// (`params: unknown`) i dokument maila takie nie są - funkcje oddają więc
// kształt „drutowy” z polami `Json`, a `queryFn` (`journeyQueries.ts`)
// zamienia go w bogate DTO funkcjami `toJourneyDetail`/`toJourneyVersion`
// (parsowanie szkicu tym samym schematem co zapis). Testy przypinają oba kroki.
//
// SZABLONY Z TREŚCIĄ ZOSTAJĄ NA SERWERZE. `templates/index.ts` niesie pełne
// dokumenty maili (kilkadziesiąt KB), więc importujemy go DYNAMICZNIE w ciele
// handlera - kompilator Start wycina handler z paczki klienta razem z tym
// importem. Do przeglądarki jedzie tylko katalog bez `doc` i flaga
// `matchesTemplate` policzona tutaj (blokada publikacji „treść z szablonu”).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import type { Json } from "@/integrations/supabase/types";
import type { JourneyRead } from "@/lib/journeys/dto";
import {
  JourneyDraftSchema,
  JourneyGraphSchema,
  JourneySettingsSchema,
  type JourneyDraft,
  type JourneyEdge,
  type JourneyGraph,
  type JourneySettings,
} from "@/lib/journeys/graph";
import { JOURNEY_CATEGORIES, type JourneyCategory } from "@/lib/journeys/limits";
import type { JourneyNodeType } from "@/lib/journeys/nodeTypes";
import {
  JOURNEY_TEMPLATE_KEYS,
  type JourneyTemplate,
  type JourneyTemplateAvailability,
  type JourneyTemplateKey,
  type JourneyTemplateKnowledge,
} from "@/lib/journeys/templates/types";
import { JOURNEY_STATUSES, type JourneyStatus } from "@/lib/revenue/search";
import { stableStringify } from "./hash";

/** Odczyt szczegółu: stany `JourneyRead` + brak wiersza. */
export type JourneyDetailRead<T> = JourneyRead<T> | { state: "not_found" };

export interface JourneyDefinitionDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: JourneyStatus;
  category: JourneyCategory;
  legalBasis: string | null;
  templateKey: string | null;
  publishedVersionId: string | null;
  createdAt: string;
  /** Token współbieżności (`p_expected_updated_at` zapisów szkicu i publikacji). */
  updatedAt: string;
}

export interface JourneyVersionSummary {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: string | null;
  triggerEventType: string;
  graphChecksum: string;
}

export interface JourneyEmailContentDto {
  nodeId: string;
  variant: string;
  subjectPl: string;
  subjectEn: string | null;
  preheaderPl: string | null;
  preheaderEn: string | null;
  doc: unknown;
  updatedAt: string;
  /** Wariant A identyczny z treścią szablonu (liczone na serwerze). */
  matchesTemplate: boolean;
}

/** Graf w kształcie drutowym (parametry kroków jako `Json`). */
export interface JourneyWireGraph {
  nodes: {
    id: string;
    type: JourneyNodeType;
    params?: Json;
    position?: { x: number; y: number };
  }[];
  edges: JourneyEdge[];
}

/** Treść maila w drucie - dokument jako `Json`. */
export type JourneyEmailContentWire = Omit<JourneyEmailContentDto, "doc"> & { doc: Json };

/** Szczegół w drucie: surowy szkic i treści, bez parsowania (patrz nagłówek). */
export interface JourneyDetailWire {
  definition: JourneyDefinitionDto;
  draftRaw: Json;
  versions: JourneyVersionSummary[];
  contents: JourneyEmailContentWire[];
  templateMatches: Record<string, boolean>;
}

export interface JourneyVersionWire {
  version: JourneyVersionSummary;
  graphRaw: Json;
  /** Kolumny wersji złożone w kształt ustawień szkicu (do `JourneySettingsSchema`). */
  settingsRaw: Json;
  contents: JourneyEmailContentWire[];
}

export interface JourneyDetailDto {
  definition: JourneyDefinitionDto;
  draft: JourneyDraft | null;
  draftValid: boolean;
  /** Surowy szkic z bazy (gdy schemat go odrzucił - do naprawy w edytorze). */
  draftRaw: unknown;
  /** Ścieżka pola, na którym schemat odrzucił szkic (`settings.triggerEventType`). */
  draftIssue: string | null;
  /** Wersje malejąco (szyna nie unieważnia osobnego klucza wersji - są tutaj). */
  versions: JourneyVersionSummary[];
  /** Treści szkicu (`version_id IS NULL`), wszystkie warianty. */
  contents: JourneyEmailContentDto[];
  /** Węzeł `send_email` szablonu -> czy wariant A nadal jest treścią szablonu. */
  templateMatches: Record<string, boolean>;
}

export interface JourneyVersionDto {
  version: JourneyVersionSummary;
  graph: JourneyGraph | null;
  graphValid: boolean;
  graphRaw: unknown;
  settings: JourneySettings | null;
  contents: JourneyEmailContentDto[];
}

/** Pozycja galerii - szablon BEZ treści maili (tylko tematy). */
export interface JourneyTemplateCatalogEntry {
  key: JourneyTemplateKey;
  category: JourneyCategory;
  /** Szablon niesie podstawę prawną (usługa) - formularz jej nie pyta. */
  hasLegalBasis: boolean;
  availability: JourneyTemplateAvailability;
  replacesWorkflowTemplate: string | null;
  settings: JourneySettings;
  graph: JourneyWireGraph;
  emailCount: number;
  emails: { nodeId: string; subject: { pl: string; en: string } }[];
  knowledge: JourneyTemplateKnowledge;
}

type TableError = { message: string; code?: string } | null;

const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(["42P01", "42703", "42883"]);

/** Odmowa albo brak źródła jako stan; reszta błędów rzuca. */
function tableDenial(error: TableError): "forbidden" | "unavailable" | null {
  if (!error) return null;
  if (error.code === "42501") return "forbidden";
  if (
    error.code !== undefined &&
    (UNAVAILABLE_CODES.has(error.code) || /^PGRST2\d\d$/.test(error.code))
  ) {
    return "unavailable";
  }
  throw new Error(error.message);
}

class JourneyRowShapeError extends Error {
  constructor(path: string) {
    super(`journey tables: nieoczekiwany kształt pola ${path}`);
    this.name = "JourneyRowShapeError";
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new JourneyRowShapeError(path);
  }
  return value as T;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new JourneyRowShapeError(path);
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, path);
}

interface ContentRow {
  node_id: unknown;
  variant: unknown;
  subject_pl: unknown;
  subject_en: unknown;
  preheader_pl: unknown;
  preheader_en: unknown;
  doc: unknown;
  updated_at: unknown;
}

function mapContent(row: ContentRow, i: number): JourneyEmailContentWire {
  const p = `contents[${i}].`;
  return {
    nodeId: text(row.node_id, `${p}node_id`),
    variant: text(row.variant, `${p}variant`),
    subjectPl: text(row.subject_pl, `${p}subject_pl`),
    subjectEn: nullableText(row.subject_en, `${p}subject_en`),
    preheaderPl: nullableText(row.preheader_pl, `${p}preheader_pl`),
    preheaderEn: nullableText(row.preheader_en, `${p}preheader_en`),
    doc: row.doc as Json,
    updatedAt: text(row.updated_at, `${p}updated_at`),
    matchesTemplate: false,
  };
}

interface VersionRow {
  id: unknown;
  version: unknown;
  published_at: unknown;
  published_by: unknown;
  trigger_event_type: unknown;
  graph_checksum: unknown;
}

function mapVersion(row: VersionRow, i: number): JourneyVersionSummary {
  const p = `versions[${i}].`;
  if (typeof row.version !== "number" || !Number.isSafeInteger(row.version)) {
    throw new JourneyRowShapeError(`${p}version`);
  }
  return {
    id: text(row.id, `${p}id`),
    version: row.version,
    publishedAt: text(row.published_at, `${p}published_at`),
    publishedBy: nullableText(row.published_by, `${p}published_by`),
    triggerEventType: text(row.trigger_event_type, `${p}trigger_event_type`),
    graphChecksum: text(row.graph_checksum, `${p}graph_checksum`),
  };
}

/** Pusty napis i `null` znaczą to samo („brak” - baza zapisuje puste jako NULL). */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Odcisk treści maila do porównania z szablonem: tematy, preheadery i dokument
 * po TYM SAMYM parserze co zapis (`parseEmailDoc`), więc zapis bez zmian
 * (parser normalizuje styl) nie zdejmuje blokady, a jedna zmieniona litera -
 * tak. Klucze posortowane - kolejność pól jsonb nie ma znaczenia.
 */
export function contentFingerprint(
  content: {
    subjectPl: string | null;
    subjectEn: string | null;
    preheaderPl: string | null;
    preheaderEn: string | null;
    doc: unknown;
  },
  parseDoc: (doc: unknown) => unknown,
): string {
  return stableStringify({
    subjectPl: blankToNull(content.subjectPl),
    subjectEn: blankToNull(content.subjectEn),
    preheaderPl: blankToNull(content.preheaderPl),
    preheaderEn: blankToNull(content.preheaderEn),
    doc: parseDoc(content.doc) ?? content.doc,
  });
}

/** Flagi „treść = szablon” dla wariantu A każdego maila szablonu. */
export function templateMatchesOf(
  template: Pick<JourneyTemplate, "emails"> | null,
  contents: readonly Pick<
    JourneyEmailContentDto,
    "nodeId" | "variant" | "subjectPl" | "subjectEn" | "preheaderPl" | "preheaderEn" | "doc"
  >[],
  parseDoc: (doc: unknown) => unknown,
): Record<string, boolean> {
  if (template === null) return {};
  const out: Record<string, boolean> = {};
  for (const email of template.emails) {
    const content = contents.find((c) => c.nodeId === email.nodeId && c.variant === "A");
    out[email.nodeId] =
      content !== undefined &&
      contentFingerprint(content, parseDoc) ===
        contentFingerprint(
          {
            subjectPl: email.subject.pl,
            subjectEn: email.subject.en,
            preheaderPl: email.preheader.pl,
            preheaderEn: email.preheader.en,
            doc: email.doc,
          },
          parseDoc,
        );
  }
  return out;
}

/** Szablon jako pozycja galerii: bez dokumentów maili, z kopią grafu. */
export function toCatalogEntry(template: JourneyTemplate): JourneyTemplateCatalogEntry {
  return {
    key: template.key,
    category: template.category,
    hasLegalBasis: template.legalBasis !== null,
    availability: structuredClone(template.availability),
    replacesWorkflowTemplate: template.replacesWorkflowTemplate,
    settings: structuredClone(template.settings),
    // Graf szablonu to dane z kodu (bez funkcji i cykli) - jest JSON-em.
    graph: structuredClone(template.graph) as unknown as JourneyWireGraph,
    emailCount: template.emails.length,
    emails: template.emails.map((email) => ({
      nodeId: email.nodeId,
      subject: { pl: email.subject.pl, en: email.subject.en },
    })),
    knowledge: structuredClone(template.knowledge),
  };
}

/** Drut -> DTO szczegółu: szkic przez `JourneyDraftSchema`, łagodnie. */
export function toJourneyDetail(
  read: JourneyDetailRead<JourneyDetailWire>,
): JourneyDetailRead<JourneyDetailDto> {
  if (read.state !== "ready") return read;
  const wire = read.data;
  const parsed = JourneyDraftSchema.safeParse(wire.draftRaw);
  return {
    state: "ready",
    data: {
      definition: wire.definition,
      draft: parsed.success ? parsed.data : null,
      draftValid: parsed.success,
      draftRaw: wire.draftRaw,
      draftIssue: parsed.success ? null : (parsed.error.issues[0]?.path.join(".") ?? ""),
      versions: wire.versions,
      contents: wire.contents,
      templateMatches: wire.templateMatches,
    },
  };
}

/** Drut -> DTO wersji: graf i ustawienia przez schematy, łagodnie. */
export function toJourneyVersion(
  read: JourneyDetailRead<JourneyVersionWire>,
): JourneyDetailRead<JourneyVersionDto> {
  if (read.state !== "ready") return read;
  const wire = read.data;
  const graph = JourneyGraphSchema.safeParse(wire.graphRaw);
  const settings = JourneySettingsSchema.safeParse(wire.settingsRaw);
  return {
    state: "ready",
    data: {
      version: wire.version,
      graph: graph.success ? graph.data : null,
      graphValid: graph.success,
      graphRaw: wire.graphRaw,
      settings: settings.success ? settings.data : null,
      contents: wire.contents,
    },
  };
}

const UUID = z.string().uuid();

const DEFINITION_COLUMNS =
  "id, key, name, description, status, category, legal_basis, template_key, draft, published_version_id, created_at, updated_at";
const VERSION_SUMMARY_COLUMNS =
  "id, version, published_at, published_by, trigger_event_type, graph_checksum";
const CONTENT_COLUMNS =
  "node_id, variant, subject_pl, subject_en, preheader_pl, preheader_en, doc, updated_at";

export const getJourneyDetail = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => z.object({ journeyId: UUID }).parse(input))
  .handler(async ({ data, context }): Promise<JourneyDetailRead<JourneyDetailWire>> => {
    const { data: row, error } = await context.supabase
      .from("journey_definitions")
      .select(
        "id, key, name, description, status, category, legal_basis, template_key, draft, published_version_id, created_at, updated_at",
      )
      .eq("id", data.journeyId)
      .maybeSingle();
    const denied = tableDenial(error);
    if (denied) return { state: denied };
    if (!row) return { state: "not_found" };

    const [versionsRes, contentsRes] = await Promise.all([
      context.supabase
        .from("journey_versions")
        .select("id, version, published_at, published_by, trigger_event_type, graph_checksum")
        .eq("journey_id", data.journeyId)
        .order("version", { ascending: false }),
      context.supabase
        .from("journey_email_contents")
        .select(
          "node_id, variant, subject_pl, subject_en, preheader_pl, preheader_en, doc, updated_at",
        )
        .eq("journey_id", data.journeyId)
        .is("version_id", null)
        .order("node_id", { ascending: true })
        .order("variant", { ascending: true }),
    ]);
    const versionsDenied = tableDenial(versionsRes.error);
    if (versionsDenied) return { state: versionsDenied };
    const contentsDenied = tableDenial(contentsRes.error);
    if (contentsDenied) return { state: contentsDenied };

    const contents = ((contentsRes.data ?? []) as ContentRow[]).map(mapContent);
    const templateKey = nullableText(row.template_key, "template_key");
    let templateMatches: Record<string, boolean> = {};
    if (templateKey !== null) {
      const [{ journeyTemplate }, { parseEmailDoc }] = await Promise.all([
        import("@/lib/journeys/templates"),
        import("@/lib/newsletter/emailDoc"),
      ]);
      templateMatches = templateMatchesOf(journeyTemplate(templateKey), contents, parseEmailDoc);
      for (const content of contents) {
        content.matchesTemplate =
          content.variant === "A" && templateMatches[content.nodeId] === true;
      }
    }

    return {
      state: "ready",
      data: {
        definition: {
          id: text(row.id, "id"),
          key: text(row.key, "key"),
          name: text(row.name, "name"),
          description: nullableText(row.description, "description"),
          status: oneOf(row.status, JOURNEY_STATUSES, "status"),
          category: oneOf(row.category, JOURNEY_CATEGORIES, "category"),
          legalBasis: nullableText(row.legal_basis, "legal_basis"),
          templateKey,
          publishedVersionId: nullableText(row.published_version_id, "published_version_id"),
          createdAt: text(row.created_at, "created_at"),
          updatedAt: text(row.updated_at, "updated_at"),
        },
        draftRaw: row.draft,
        versions: ((versionsRes.data ?? []) as VersionRow[]).map(mapVersion),
        contents,
        templateMatches,
      },
    };
  });

export const getJourneyVersion = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => z.object({ journeyId: UUID, versionId: UUID }).parse(input))
  .handler(async ({ data, context }): Promise<JourneyDetailRead<JourneyVersionWire>> => {
    const { data: row, error } = await context.supabase
      .from("journey_versions")
      .select(
        "id, version, published_at, published_by, trigger_event_type, trigger_condition, entry_filter, reentry, reentry_cooldown_days, goal, exit_events, graph, graph_checksum",
      )
      .eq("id", data.versionId)
      .eq("journey_id", data.journeyId)
      .maybeSingle();
    const denied = tableDenial(error);
    if (denied) return { state: denied };
    if (!row) return { state: "not_found" };

    const contentsRes = await context.supabase
      .from("journey_email_contents")
      .select(
        "node_id, variant, subject_pl, subject_en, preheader_pl, preheader_en, doc, updated_at",
      )
      .eq("journey_id", data.journeyId)
      .eq("version_id", data.versionId)
      .order("node_id", { ascending: true })
      .order("variant", { ascending: true });
    const contentsDenied = tableDenial(contentsRes.error);
    if (contentsDenied) return { state: contentsDenied };

    // Kolumny wersji -> kształt ustawień szkicu (ten sam, który edytor zna).
    const settingsRaw: Json = {
      triggerEventType: row.trigger_event_type,
      triggerCondition: row.trigger_condition ?? {},
      entryFilter: row.entry_filter ?? [],
      reentry: row.reentry,
      ...(row.reentry_cooldown_days === null
        ? {}
        : { reentryCooldownDays: row.reentry_cooldown_days }),
      ...(row.goal === null ? {} : { goal: row.goal }),
      exitEvents: row.exit_events ?? [],
    };
    return {
      state: "ready",
      data: {
        version: mapVersion(row as VersionRow, 0),
        graphRaw: row.graph,
        settingsRaw,
        contents: ((contentsRes.data ?? []) as ContentRow[]).map(mapContent),
      },
    };
  });

/**
 * Katalog galerii: 14 szablonów bez dokumentów maili. Szablony żyją w kodzie
 * (nie w bazie), ale funkcja stoi za tą samą bramką co reszta ścieżek - treść
 * szablonów i plan komunikacji to informacja wewnętrzna panelu.
 */
export const listJourneyTemplateCatalog = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async (): Promise<JourneyTemplateCatalogEntry[]> => {
    const { JOURNEY_TEMPLATES } = await import("@/lib/journeys/templates");
    return JOURNEY_TEMPLATE_KEYS.map((key) => toCatalogEntry(JOURNEY_TEMPLATES[key]));
  });

/** Kolumny odczytu - eksport dla testu kontraktu (lista jawna, bez `*`). */
export const JOURNEY_DETAIL_COLUMNS = {
  definition: DEFINITION_COLUMNS,
  versionSummary: VERSION_SUMMARY_COLUMNS,
  content: CONTENT_COLUMNS,
} as const;
