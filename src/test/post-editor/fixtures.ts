// Fixture'y powierzchni MODUŁU 2 („Edytor wpisów i workflow redakcyjny").
//
// Ten plik istnieje z tego samego powodu, co `src/test/network/fixtures.ts`
// i `src/test/profile/fixtures.ts`: `PostForm` ma 60 pól, a `PostEditorData`
// i `PostEditorFormApi` po kilkanaście. Bez wspólnej fabryki każdy z ~40 plików
// testowych edytora budowałby własną - i przy następnym dodaniu kolumny trzeba
// by poprawić czterdzieści miejsc, a testy, które ktoś przeoczy, zaczęłyby
// dowodzić kształtu, którego już nie ma.
//
// Plik jest importowany także z wnętrza fabryk `vi.mock` (przez dynamiczny
// import, patrz `reactI18nextStub`), więc musi być tani i wolny od
// side-effectów - żadnych importów rejestrujących zasoby i18n ani klienta
// Supabase.
import { vi } from "vitest";
import type { PublishChecklist } from "@/lib/content/publishChecklist";
import type { PostWorkflowStatus } from "@/lib/content/workflow";
import type { SeoIssue } from "@/lib/seo/validation";
import type {
  WorkflowDefinitionRow,
  WorkflowRunStats,
  WorkflowRunWithDefinition,
  WorkflowTemplateRow,
} from "@/lib/admin/workflows";
import type { CategoryOpt, PostForm, TagOpt } from "@/components/admin/post-editor/types";

/**
 * Identyfikatory testowe. Tenant jest jawny, bo cała warstwa danych edytora
 * filtruje po `tenant_id` - testy izolacji najemców mają się odwoływać do tych
 * stałych, nie do literałów rozsypanych po plikach.
 */
export const EDITOR_IDS = {
  tenant: "11111111-1111-4111-8111-111111111111",
  foreignTenant: "99999999-9999-4999-8999-999999999999",
  post: "22222222-2222-4222-8222-222222222222",
  user: "33333333-3333-4333-8333-333333333333",
  author: "44444444-4444-4444-8444-444444444444",
  workflow: "55555555-5555-4555-8555-555555555555",
  revision: "66666666-6666-4666-8666-666666666666",
  correlation: "6f1e0c1a-8b2d-4e3f-9a5c-2d7b8e9f0a1b",
  category: "77777777-7777-4777-8777-777777777777",
  tag: "88888888-8888-4888-8888-888888888888",
} as const;

/** Stabilna data odniesienia - żaden fixture nie woła `Date.now()`. */
export const BASE_ISO = "2026-08-18T10:00:00.000Z";

export function isoOffset(minutes: number): string {
  return new Date(Date.parse(BASE_ISO) + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Formularz wpisu
// ---------------------------------------------------------------------------

/**
 * Kompletny `PostForm` - WSZYSTKIE pola jawnie. Brak pola w tej fabryce
 * oznaczałby, że testy zapisu nie widzą kolumny, która realnie jedzie do bazy.
 */
export function postForm(overrides: Partial<PostForm> = {}): PostForm {
  return {
    id: EDITOR_IDS.post,
    slug: "moj-wpis",
    updated_at: BASE_ISO,
    status: "draft",
    author_id: EDITOR_IDS.author,
    editor: "blocks",
    title_pl: "Polski tytuł wpisu",
    title_en: "English post title",
    excerpt_pl: "Polska zajawka wpisu.",
    excerpt_en: "English excerpt of the post.",
    content_pl: "<p>Polska treść</p>",
    content_en: "<p>English body</p>",
    cover_image_url: "https://example.com/cover.jpg",
    audio_url_pl: null,
    audio_url_en: null,
    tts_voice_pl: null,
    tts_voice_en: null,
    read_minutes: 5,
    published_at: null,
    publish_at: null,
    builder_data: null,
    blocks_data: null,
    parent_page_id: "",
    post_format: "standard",
    layout_overrides: null,
    takeaways_pl: ["Pierwszy wniosek", "Drugi wniosek", "Trzeci wniosek"],
    takeaways_en: ["First takeaway", "Second takeaway", "Third takeaway"],
    takeaways_variant: "card",
    toc_override: null,
    custom_meta: null,
    related_override: null,
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: "Polski opis SEO wpisu, wystarczająco długi.",
    seo_description_en: "English SEO description of the post, long enough.",
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    organization_id: null,
    organization_name: null,
    organization_logo_url: null,
    organization_website: null,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_advertiser_name: null,
    sponsored_advertiser_url: null,
    sponsored_payer_name: null,
    sponsored_note_pl: null,
    sponsored_note_en: null,
    sponsored_affiliate: false,
    sponsored_political: false,
    sponsored_political_process: null,
    sponsored_sponsor_controller: null,
    sponsored_order_ref: null,
    sponsored_marked_at: null,
    ...overrides,
  };
}

export function categoryOpt(overrides: Partial<CategoryOpt> = {}): CategoryOpt {
  return {
    id: EDITOR_IDS.category,
    name_pl: "Polityka spójności",
    name_en: "Cohesion policy",
    ...overrides,
  };
}

export function tagOpt(overrides: Partial<TagOpt> = {}): TagOpt {
  return { id: EDITOR_IDS.tag, name: "fundusze", ...overrides };
}

// ---------------------------------------------------------------------------
// Warstwa danych i API formularza edytora
// ---------------------------------------------------------------------------

/** Kształt zwracany przez `usePostEditorData` - atrapa dla organizmów edytora. */
export function postEditorData(
  overrides: Partial<{
    tenantId: string;
    post: PostForm | undefined;
    isLoading: boolean;
    id: string;
    allCats: CategoryOpt[];
    allTags: TagOpt[];
    allPrograms: Array<{ id: string; name_pl: string; name_en: string }>;
    allRegions: Array<{ id: string; name_pl: string; name_en: string }>;
    postCats: Array<{ category_id: string }>;
    postTags: Array<{ tag_id: string }>;
    postPrograms: Array<{ program_id: string }>;
    postRegions: Array<{ region_id: string }>;
  }> = {},
) {
  return {
    tenantId: EDITOR_IDS.tenant,
    post: postForm(),
    isLoading: false,
    id: EDITOR_IDS.post,
    allCats: [categoryOpt()],
    allTags: [tagOpt()],
    allPrograms: [],
    allRegions: [],
    postCats: [],
    postTags: [],
    postPrograms: [],
    postRegions: [],
    ...overrides,
  };
}

/** Checklista publikacji w stanie „wszystko wypełnione". */
export function publishChecklist(overrides: Partial<PublishChecklist> = {}): PublishChecklist {
  const items: PublishChecklist["items"] = [
    { id: "titlePl", level: "required", ok: true },
    { id: "cover", level: "required", ok: true },
    { id: "category", level: "required", ok: true },
    { id: "descriptionPl", level: "recommended", ok: true },
  ];
  return {
    items,
    missingRequired: [],
    missingRecommended: [],
    requiredOk: true,
    score: 100,
    ...overrides,
  };
}

export function seoIssue(overrides: Partial<SeoIssue> = {}): SeoIssue {
  return {
    lang: "pl",
    kind: "title",
    severity: "warning",
    chars: 70,
    charLimit: 60,
    px: 600,
    pxLimit: 580,
    ...overrides,
  };
}

/**
 * Atrapa `PostEditorFormApi` - kształt, który organizmy edytora dostają
 * propem. Wszystkie akcje to `vi.fn()`, więc test może sprawdzić, że klik
 * w przycisk wywołał WŁAŚCIWĄ akcję, a nie tylko że coś się wyrenderowało.
 */
export function postEditorFormApi(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  const form = postForm();
  return {
    form,
    history: {
      state: form,
      set: vi.fn(),
      reset: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
    },
    set: vi.fn(),
    canPublish: true,
    busy: false,
    seoIssues: [] as SeoIssue[],
    setSeoIssues: vi.fn(),
    selectedCats: [] as string[],
    setSelectedCats: vi.fn(),
    selectedTags: [] as string[],
    setSelectedTags: vi.fn(),
    selectedPrograms: [] as string[],
    setSelectedPrograms: vi.fn(),
    selectedRegions: [] as string[],
    setSelectedRegions: vi.fn(),
    autosave: {
      status: "idle" as "idle" | "saving" | "saved" | "error",
      isDirty: false,
      lastSaved: { form, cats: [], tags: [], programs: [], regions: [] },
      flush: vi.fn(async () => undefined),
      error: null,
    },
    save: vi.fn(async () => undefined),
    discardToSaved: vi.fn(),
    del: vi.fn(async () => undefined),
    applyStatus: vi.fn(async () => undefined),
    confirmPublishGaps: vi.fn(async () => true),
    publishChecklist: publishChecklist(),
    onRevisionRestored: vi.fn(),
    statusOptions: statusOptions(),
    scheduledInPast: false,
    ...overrides,
  };
}

/** Opcje statusu workflow w wariancie wydawcy (nic nie jest zablokowane). */
export function statusOptions(canPublish = true) {
  const all: PostWorkflowStatus[] = [
    "draft",
    "pending_review",
    "scheduled",
    "published",
    "archived",
  ];
  return all.map((value) => ({
    value,
    publisherOnly: !canPublish && (value === "scheduled" || value === "published"),
  }));
}

// ---------------------------------------------------------------------------
// Automatyzacje (workflow)
// ---------------------------------------------------------------------------

export function workflowDefinition(
  overrides: Partial<WorkflowDefinitionRow> = {},
): WorkflowDefinitionRow {
  return {
    id: EDITOR_IDS.workflow,
    tenant_id: EDITOR_IDS.tenant,
    name: "Zgłoszenie do recenzji -> powiadom redakcję",
    template_key: null,
    enabled: true,
    trigger_event_type: "post.status_changed.v1",
    condition: { new_status: "pending_review" },
    steps: [{ action: "notify_staff", params: { roles: ["editor"] } }],
    created_by: EDITOR_IDS.user,
    created_at: BASE_ISO,
    updated_at: BASE_ISO,
    ...overrides,
  } as WorkflowDefinitionRow;
}

export function workflowRun(
  overrides: Partial<WorkflowRunWithDefinition> = {},
): WorkflowRunWithDefinition {
  return {
    id: "run-1",
    tenant_id: EDITOR_IDS.tenant,
    workflow_id: EDITOR_IDS.workflow,
    event_id: "event-1",
    // Typ zdarzenia, ktore wyzwolilo przebieg - tabela historii renderuje go
    // jako chip, wiec bez tego pola wiersz pokazywalby pusty identyfikator.
    event_type: "post.published.v1",
    correlation_id: EDITOR_IDS.correlation,
    status: "succeeded",
    steps_completed: 1,
    error: null,
    created_at: BASE_ISO,
    workflow_definitions: { name: "Zgłoszenie do recenzji -> powiadom redakcję" },
    ...overrides,
  } as WorkflowRunWithDefinition;
}

export function workflowTemplate(
  overrides: Partial<WorkflowTemplateRow> = {},
): WorkflowTemplateRow {
  return {
    key: "comment-pending-notify-staff",
    name_pl: "Komentarz do moderacji",
    name_en: "Comment awaiting moderation",
    description_pl: "Powiadom redakcję o komentarzu czekającym na moderację.",
    description_en: "Notify staff about a comment awaiting moderation.",
    trigger_event_type: "comment.created.v1",
    condition: { status: "pending" },
    steps: [{ action: "notify_staff", params: { roles: ["admin", "editor"] } }],
    created_at: BASE_ISO,
    ...overrides,
  } as WorkflowTemplateRow;
}

export function workflowRunStats(overrides: Partial<WorkflowRunStats> = {}): WorkflowRunStats {
  return { total: 3, failed: 1, lastRunAt: BASE_ISO, lastStatus: "failed", ...overrides };
}

/** Zdarzenie domenowe w kształcie, w jakim czyta je panel śladu korelacji. */
export function domainEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    tenant_id: EDITOR_IDS.tenant,
    event_type: "post.published.v1",
    aggregate_type: "post",
    aggregate_id: EDITOR_IDS.post,
    actor_id: EDITOR_IDS.user,
    correlation_id: EDITOR_IDS.correlation,
    payload: { slug: "moj-wpis" },
    created_at: BASE_ISO,
    ...overrides,
  };
}

/** Dostawa webhooka outboxu przypięta do zdarzenia śladu. */
export function traceDelivery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "delivery-1",
    event_id: "event-1",
    event_type: "post.published.v1",
    status: "delivered",
    attempts: 1,
    last_error: null,
    delivered_at: isoOffset(1),
    created_at: BASE_ISO,
    integration_endpoints: { name: "Slack redakcji" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Historia wersji
// ---------------------------------------------------------------------------

/** Lekki wpis listy rewizji (projekcja z `listRevisions`). */
export function revisionListItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EDITOR_IDS.revision,
    created_at: BASE_ISO,
    author_id: EDITOR_IDS.author,
    note: "autosave",
    title_pl: "Polski tytuł wpisu",
    title_en: "English post title",
    status: "draft",
    editor: "blocks",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

/**
 * Tłumaczenie zwracające KLUCZ (plus serializowane parametry). Asercje idą po
 * kluczach, nie po polskim copy - istnienia i parytetu kluczy PL/EN pilnują
 * osobne bramki i18n, a test przywiązany do copy pękałby przy każdej korekcie
 * redakcyjnej.
 */
export function translateKey(key: string, options?: Record<string, unknown>): string {
  if (options === undefined) return key;
  const entries = Object.entries(options);
  return entries.length === 0 ? key : `${key} ${JSON.stringify(Object.fromEntries(entries))}`;
}

/**
 * Stub `react-i18next` wołany z fabryki `vi.mock`. Język czytamy przez getter,
 * bo fabryka mocka wykonuje się RAZ, a testy formatowania dat (PL vs EN) muszą
 * móc przełączyć język między przypadkami.
 */
export function reactI18nextStub(getLanguage: () => string = () => "pl") {
  return {
    useTranslation: () => ({
      t: translateKey,
      i18n: { language: getLanguage(), changeLanguage: vi.fn() },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: ({ children }: { children?: unknown }) => children,
  };
}

/** Atrapa `sonner` - toasty jako szpiedzy, żeby dało się na nich asercjować. */
export function toastStub() {
  return {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  };
}
