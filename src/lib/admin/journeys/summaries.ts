// OPISY I ETYKIETY ŚCIEŻEK (S8) - zdanie o kroku, zdanie wyzwalacza, paleta
// kroków, fakty szablonu, etykiety statusów i stan zdrowia silnika.
//
// OPIS = KLUCZ + PARAMETRY, NIE GOTOWY NAPIS. Ten sam opis kroku czytają karta
// kanwy, wiersz listy kroków, `aria-label` („Krok 3 z 7: Wyślij e-mail
// «Dokończ zamówienie»”) i lista problemów - w języku panelu, z liczebnikami
// (`_one/_few/_many/_other`). Moduł zwraca więc `{ labelKey, params, refs }`,
// a `translateSummary(t, …)` składa napis w komponencie. `refs` to parametry,
// które same są tłumaczeniem (nazwa zdarzenia, etap CRM, czas czekania) - bez
// nich komponent sklejałby klucze, czego zabrania bramka słowników.
//
// PALETA SPEC ≠ RODZINY S5. Silnik grupuje typy po sposobie wykonania
// (`JOURNEY_NODE_FAMILY`: action = wszystko z `_journey_exec_action`), a paleta
// edytora po tym, czego szuka administrator (SPEC §6.3): Czas, Komunikacja,
// Logika, CRM, Newsletter, Zakończenie. Lista newslettera jest więc w grupie
// „Newsletter”, a pozostałe akcje i powiadomienie zespołu - w „CRM”.
//
// FAKTY SZABLONU liczymy z katalogu (`listJourneyTemplateCatalog`, bez treści
// maili): kategoria, liczba maili, wymagania, „czego NIE wysyła” i przepis,
// który szablon zastępuje. Wskazówki Insidera to własne zdania słownika
// (parafraza, BEZ liczb benchmarków - liczby daje wyłącznie zestaw S6).
import type { JourneyEngineHealthDto } from "@/lib/journeys/dto";
import { NODE_PARAMS_SCHEMAS, type JourneySettings } from "@/lib/journeys/graph";
import { journeyLabelKey, journeyTriggerLabelKey } from "@/lib/journeys/labels";
import type { JourneyCategory, JourneyReentry } from "@/lib/journeys/limits";
import type { JourneyNodeType } from "@/lib/journeys/nodeTypes";
import type { JourneyTemplateKey } from "@/lib/journeys/templates/types";
import { journeyTrigger } from "@/lib/journeys/triggers";
import type { JourneyStatus } from "@/lib/revenue/search";
import type { JourneyTemplateCatalogEntry } from "./journeyEditor.functions";
import { DEFAULT_WAIT_EVENT, defaultParams, waitUntilEventParams } from "./ops";

// ── Opis kroku ───────────────────────────────────────────────────────────────

export interface JourneySummary {
  labelKey: string;
  params: Record<string, string | number>;
  /** Parametry będące osobnym tłumaczeniem (klucz albo zagnieżdżony opis). */
  refs?: Record<string, string | JourneySummary>;
}

export type JourneyTranslate = (key: string, options?: Record<string, unknown>) => string;

/** Składa napis opisu: najpierw tłumaczy `refs`, potem sam klucz. */
export function translateSummary(t: JourneyTranslate, summary: JourneySummary): string {
  const resolved: Record<string, unknown> = { ...summary.params };
  for (const [name, ref] of Object.entries(summary.refs ?? {})) {
    resolved[name] = typeof ref === "string" ? t(ref) : translateSummary(t, ref);
  }
  return t(summary.labelKey, resolved);
}

/** Klucze opisów - jawna lista (czytelnik każdego klucza dla bramki słowników). */
export const JOURNEY_SUMMARY_KEY = {
  trigger: "adminJourneys.common.summary.trigger",
  triggerSentence: "adminJourneys.common.summary.triggerSentence",
  triggerSentenceCondition: "adminJourneys.common.summary.triggerSentenceCondition",
  waitMinutes: "adminJourneys.common.summary.waitMinutes",
  waitHours: "adminJourneys.common.summary.waitHours",
  waitDays: "adminJourneys.common.summary.waitDays",
  waitUntilTimeDaily: "adminJourneys.common.summary.waitUntilTimeDaily",
  waitUntilTimeWeekdays: "adminJourneys.common.summary.waitUntilTimeWeekdays",
  waitUntilTimeDays: "adminJourneys.common.summary.waitUntilTimeDays",
  waitUntilEvent: "adminJourneys.common.summary.waitUntilEvent",
  sendEmail: "adminJourneys.common.summary.sendEmail",
  sendEmailNoSubject: "adminJourneys.common.summary.sendEmailNoSubject",
  abSplit: "adminJourneys.common.summary.abSplit",
  ifElseAll: "adminJourneys.common.summary.ifElseAll",
  ifElseAny: "adminJourneys.common.summary.ifElseAny",
  setLifecycle: "adminJourneys.common.summary.setLifecycle",
  setCrmStage: "adminJourneys.common.summary.setCrmStage",
  setCrmStageForward: "adminJourneys.common.summary.setCrmStageForward",
  createTask: "adminJourneys.common.summary.createTask",
  createTaskToday: "adminJourneys.common.summary.createTaskToday",
  addTag: "adminJourneys.common.summary.addTag",
  removeTag: "adminJourneys.common.summary.removeTag",
  newsletterAdd: "adminJourneys.common.summary.newsletterAdd",
  newsletterRemove: "adminJourneys.common.summary.newsletterRemove",
  notifyOwner: "adminJourneys.common.summary.notifyOwner",
  notifyAdmins: "adminJourneys.common.summary.notifyAdmins",
  notifyUsers: "adminJourneys.common.summary.notifyUsers",
  goal: "adminJourneys.common.summary.goal",
  goalNoLabel: "adminJourneys.common.summary.goalNoLabel",
  exit: "adminJourneys.common.summary.exit",
  invalid: "adminJourneys.common.summary.invalid",
} as const;

const DAY = 24 * 60;

/** Sam czas („2 dni”) - limit czekania na zdarzenie, terminy w panelu kroku. */
export const JOURNEY_DURATION_KEY = {
  minutes: "adminJourneys.common.duration.minutes",
  hours: "adminJourneys.common.duration.hours",
  days: "adminJourneys.common.duration.days",
} as const;

/**
 * Czas jako opis w największej jednostce, w której wartość jest całkowita:
 * `wait` - zdanie kroku („Czeka 3 dni”), `plain` - sam czas („3 dni”).
 */
export function durationSummary(minutes: number, form: "wait" | "plain" = "wait"): JourneySummary {
  const keys =
    form === "wait"
      ? {
          days: JOURNEY_SUMMARY_KEY.waitDays,
          hours: JOURNEY_SUMMARY_KEY.waitHours,
          minutes: JOURNEY_SUMMARY_KEY.waitMinutes,
        }
      : JOURNEY_DURATION_KEY;
  if (minutes % DAY === 0) return { labelKey: keys.days, params: { count: minutes / DAY } };
  if (minutes % 60 === 0) return { labelKey: keys.hours, params: { count: minutes / 60 } };
  return { labelKey: keys.minutes, params: { count: minutes } };
}

const LIFECYCLE_KEY = (stage: string) => `adminCrm.lifecycle.stages.${stage}`;
const CRM_STAGE_KEY = (stage: string) => `adminCrm.lifecycle.crmStages.${stage}`;

export interface DescribeNodeExtra {
  /** Temat maila (wariant A, PL albo EN wg panelu) - karta pokazuje go w opisie. */
  subject?: string | null;
  /** Ustawienia szkicu - opis wyzwalacza mówi, na jakie zdarzenie startuje. */
  settings?: Pick<JourneySettings, "triggerEventType" | "triggerCondition"> | null;
}

/**
 * Zdanie o kroku. Parametry spoza schematu (szkic uszkodzony albo zapisany
 * przed zmianą schematu) dają opis „parametry do poprawy”, a nie wyjątek.
 */
export function describeNode(
  node: { type: JourneyNodeType; params?: unknown },
  extra: DescribeNodeExtra = {},
): JourneySummary {
  const K = JOURNEY_SUMMARY_KEY;
  if (node.type === "trigger") {
    return extra.settings?.triggerEventType
      ? triggerSentence(extra.settings)
      : { labelKey: K.trigger, params: {} };
  }
  const parsed = NODE_PARAMS_SCHEMAS[node.type].safeParse(node.params ?? {});
  if (!parsed.success) return { labelKey: K.invalid, params: {} };
  const p = parsed.data as Record<string, unknown>;
  switch (node.type) {
    case "wait": {
      if (p.mode === "duration") return durationSummary(p.minutes as number);
      if (p.mode === "until_time") {
        const days = [...(p.weekdays as number[])].sort();
        const time = p.time as string;
        if (days.length === 7) return { labelKey: K.waitUntilTimeDaily, params: { time } };
        if (days.join(",") === "1,2,3,4,5") {
          return { labelKey: K.waitUntilTimeWeekdays, params: { time } };
        }
        return { labelKey: K.waitUntilTimeDays, params: { time, count: days.length } };
      }
      return {
        labelKey: K.waitUntilEvent,
        params: {},
        refs: {
          event: journeyTriggerLabelKey(p.eventType as string),
          limit: durationSummary(p.timeoutMinutes as number, "plain"),
        },
      };
    }
    case "send_email": {
      const subject = extra.subject?.trim();
      return subject
        ? { labelKey: K.sendEmail, params: { subject } }
        : { labelKey: K.sendEmailNoSubject, params: {} };
    }
    case "ab_split": {
      const weights = p.weights as { A: number; B: number };
      return { labelKey: K.abSplit, params: { a: weights.A, b: weights.B } };
    }
    case "if_else": {
      const count = (p.predicates as unknown[]).length;
      return { labelKey: p.match === "any" ? K.ifElseAny : K.ifElseAll, params: { count } };
    }
    case "set_lifecycle_stage":
      return {
        labelKey: K.setLifecycle,
        params: {},
        refs: { stage: LIFECYCLE_KEY(p.stage as string) },
      };
    case "set_crm_stage":
      return {
        labelKey: p.onlyForward ? K.setCrmStageForward : K.setCrmStage,
        params: {},
        refs: { stage: CRM_STAGE_KEY(p.stage as string) },
      };
    case "create_crm_task": {
      const days = p.dueInDays as number;
      const title = p.title as string;
      return days === 0
        ? { labelKey: K.createTaskToday, params: { title } }
        : { labelKey: K.createTask, params: { title, count: days } };
    }
    case "add_tag":
      return { labelKey: K.addTag, params: { tag: p.tag as string } };
    case "remove_tag":
      return { labelKey: K.removeTag, params: { tag: p.tag as string } };
    case "newsletter_list":
      return {
        labelKey: p.op === "remove" ? K.newsletterRemove : K.newsletterAdd,
        params: { list: p.listKey as string },
      };
    case "notify_staff": {
      const recipients = p.recipients;
      if (recipients === "owner") return { labelKey: K.notifyOwner, params: {} };
      if (recipients === "admins") return { labelKey: K.notifyAdmins, params: {} };
      const count = (recipients as { userIds: string[] }).userIds.length;
      return { labelKey: K.notifyUsers, params: { count } };
    }
    case "goal": {
      const label = typeof p.label === "string" ? p.label : "";
      return label
        ? { labelKey: K.goal, params: { label } }
        : { labelKey: K.goalNoLabel, params: {} };
    }
    default:
      return { labelKey: K.exit, params: {} };
  }
}

/**
 * Zdanie wyzwalacza: „Start: gdy {zdarzenie}” (+ liczba warunków i ich treść
 * „klucz = wartość” - klucze ładunku są techniczne, ale to te same, które
 * administrator wybiera w formularzu warunku).
 */
export function triggerSentence(
  settings: Pick<JourneySettings, "triggerEventType" | "triggerCondition">,
): JourneySummary {
  const event = journeyTriggerLabelKey(settings.triggerEventType);
  const entries = Object.entries(settings.triggerCondition ?? {});
  if (entries.length === 0) {
    return { labelKey: JOURNEY_SUMMARY_KEY.triggerSentence, params: {}, refs: { event } };
  }
  return {
    labelKey: JOURNEY_SUMMARY_KEY.triggerSentenceCondition,
    params: {
      count: entries.length,
      conditions: entries.map(([key, value]) => `${key} = ${String(value)}`).join(", "),
    },
    refs: { event },
  };
}

// ── Paleta kroków (SPEC §6.3) ────────────────────────────────────────────────

export const JOURNEY_PALETTE_GROUPS = [
  "time",
  "communication",
  "logic",
  "crm",
  "newsletter",
  "end",
] as const;
export type JourneyPaletteGroup = (typeof JOURNEY_PALETTE_GROUPS)[number];

export const JOURNEY_PALETTE_ITEM_IDS = [
  "wait_duration",
  "wait_until_time",
  "wait_until_event",
  "send_email",
  "if_else",
  "ab_split",
  "set_lifecycle_stage",
  "set_crm_stage",
  "create_crm_task",
  "add_tag",
  "remove_tag",
  "notify_staff",
  "newsletter_list",
  "goal",
  "exit",
] as const;
export type JourneyPaletteItemId = (typeof JOURNEY_PALETTE_ITEM_IDS)[number];

export interface JourneyPaletteItem {
  id: JourneyPaletteItemId;
  type: JourneyNodeType;
  group: JourneyPaletteGroup;
  labelKey: string;
  /** Skutek kroku jednym zdaniem („co się stanie z kontaktem”). */
  effectKey: string;
  /** Parametry startowe (przechodzą `NODE_PARAMS_SCHEMAS`). */
  params: unknown;
  /** Powód niedostępności przy bieżącym wyzwalaczu (mail przy windykacji). */
  disabledReasonKey?: string;
}

export const JOURNEY_PALETTE_GROUP_KEY: Readonly<Record<JourneyPaletteGroup, string>> = {
  time: "adminJourneys.common.palette.time",
  communication: "adminJourneys.common.palette.communication",
  logic: "adminJourneys.common.palette.logic",
  crm: "adminJourneys.common.palette.crm",
  newsletter: "adminJourneys.common.palette.newsletter",
  end: "adminJourneys.common.palette.end",
};

const EFFECT_KEY: Readonly<Record<JourneyPaletteItemId, string>> = {
  wait_duration: "adminJourneys.common.effect.wait_duration",
  wait_until_time: "adminJourneys.common.effect.wait_until_time",
  wait_until_event: "adminJourneys.common.effect.wait_until_event",
  send_email: "adminJourneys.common.effect.send_email",
  if_else: "adminJourneys.common.effect.if_else",
  ab_split: "adminJourneys.common.effect.ab_split",
  set_lifecycle_stage: "adminJourneys.common.effect.set_lifecycle_stage",
  set_crm_stage: "adminJourneys.common.effect.set_crm_stage",
  create_crm_task: "adminJourneys.common.effect.create_crm_task",
  add_tag: "adminJourneys.common.effect.add_tag",
  remove_tag: "adminJourneys.common.effect.remove_tag",
  notify_staff: "adminJourneys.common.effect.notify_staff",
  newsletter_list: "adminJourneys.common.effect.newsletter_list",
  goal: "adminJourneys.common.effect.goal",
  exit: "adminJourneys.common.effect.exit",
};

/** Trzy warianty czekania mają własne nazwy; reszta - nazwę typu z S5. */
const WAIT_LABEL_KEY = {
  wait_duration: "adminJourneys.common.palette.waitDuration",
  wait_until_time: "adminJourneys.common.palette.waitUntilTime",
  wait_until_event: "adminJourneys.common.palette.waitUntilEvent",
} as const;

const PALETTE_SPEC: readonly {
  id: JourneyPaletteItemId;
  type: JourneyNodeType;
  group: JourneyPaletteGroup;
}[] = [
  { id: "wait_duration", type: "wait", group: "time" },
  { id: "wait_until_time", type: "wait", group: "time" },
  { id: "wait_until_event", type: "wait", group: "time" },
  { id: "send_email", type: "send_email", group: "communication" },
  { id: "if_else", type: "if_else", group: "logic" },
  { id: "ab_split", type: "ab_split", group: "logic" },
  { id: "set_lifecycle_stage", type: "set_lifecycle_stage", group: "crm" },
  { id: "set_crm_stage", type: "set_crm_stage", group: "crm" },
  { id: "create_crm_task", type: "create_crm_task", group: "crm" },
  { id: "add_tag", type: "add_tag", group: "crm" },
  { id: "remove_tag", type: "remove_tag", group: "crm" },
  { id: "notify_staff", type: "notify_staff", group: "crm" },
  { id: "newsletter_list", type: "newsletter_list", group: "newsletter" },
  { id: "goal", type: "goal", group: "end" },
  { id: "exit", type: "exit", group: "end" },
];

function paletteParams(id: JourneyPaletteItemId, type: JourneyNodeType): unknown {
  if (id === "wait_until_time")
    return { mode: "until_time", weekdays: [1, 2, 3, 4, 5], time: "09:00" };
  if (id === "wait_until_event") return waitUntilEventParams(DEFAULT_WAIT_EVENT);
  return defaultParams(type);
}

/**
 * Paleta w kolejności grup SPEC. Przy wyzwalaczu, przy którym ścieżka nie
 * wysyła maili (windykacja), pozycja maila zostaje widoczna, ale wyłączona
 * z powodem - administrator dowiaduje się DLACZEGO, zamiast szukać pozycji.
 */
export function journeyPalette(context: { triggerEventType?: string | null } = {}) {
  const emailForbidden =
    context.triggerEventType != null &&
    journeyTrigger(context.triggerEventType)?.emailForbidden === true;
  return JOURNEY_PALETTE_GROUPS.map((group) => ({
    group,
    labelKey: JOURNEY_PALETTE_GROUP_KEY[group],
    items: PALETTE_SPEC.filter((spec) => spec.group === group).map((spec): JourneyPaletteItem => ({
      id: spec.id,
      type: spec.type,
      group: spec.group,
      labelKey:
        spec.id in WAIT_LABEL_KEY
          ? WAIT_LABEL_KEY[spec.id as keyof typeof WAIT_LABEL_KEY]
          : journeyLabelKey("nodeType", spec.type),
      effectKey: EFFECT_KEY[spec.id],
      params: paletteParams(spec.id, spec.type),
      ...(spec.type === "send_email" && emailForbidden
        ? { disabledReasonKey: "adminJourneys.common.palette.emailForbidden" }
        : {}),
    })),
  }));
}

/** Wyszukiwanie bez wielkości liter i polskich znaków („zadanie” = „ZADANIE”, „e-mail” = „email”). */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchesSearch(query: string, ...texts: readonly string[]): boolean {
  const needle = normalizeSearch(query);
  if (needle === "") return true;
  return texts.some((text) => normalizeSearch(text).includes(needle));
}

// ── Etykiety statusów, kategorii i ponownego wejścia (wspólne dla S8 B/C) ───

export const JOURNEY_STATUS_LABEL_KEY: Readonly<Record<JourneyStatus, string>> = {
  draft: "adminJourneys.common.status.draft",
  active: "adminJourneys.common.status.active",
  paused: "adminJourneys.common.status.paused",
  archived: "adminJourneys.common.status.archived",
};

export const JOURNEY_CATEGORY_LABEL_KEY: Readonly<Record<JourneyCategory, string>> = {
  marketing: "adminJourneys.common.category.marketing",
  service: "adminJourneys.common.category.service",
};

export const JOURNEY_CATEGORY_HINT_KEY: Readonly<Record<JourneyCategory, string>> = {
  marketing: "adminJourneys.common.categoryHint.marketing",
  service: "adminJourneys.common.categoryHint.service",
};

export const JOURNEY_REENTRY_LABEL_KEY: Readonly<Record<JourneyReentry, string>> = {
  never: "adminJourneys.common.reentry.never",
  after_exit: "adminJourneys.common.reentry.after_exit",
  cooldown: "adminJourneys.common.reentry.cooldown",
};

/**
 * Licznik paska huba „Ścieżki = aktywne” (Z-S6-08). Definicja w liściu
 * `activeCount.ts`, żeby układ huba nie ciągnął całego modułu opisów.
 */
export { activeJourneyCount } from "./activeCount";

// ── Fakty szablonu (galeria) ─────────────────────────────────────────────────

export const JOURNEY_TEMPLATE_REQUIREMENTS = [
  "marketingConsent",
  "senderName",
  "legalBasis",
  "busEvent",
] as const;
export type JourneyTemplateRequirement = (typeof JOURNEY_TEMPLATE_REQUIREMENTS)[number];

export const JOURNEY_TEMPLATE_EXCLUSIONS = [
  "noEmails",
  "withoutConsent",
  "promotions",
  "dunning",
  "afterPurchase",
  "toPayingMembers",
  "tickets",
  "cancelObstacles",
  "paused",
  "eventReminders",
  "secretClubs",
  "afterDecision",
  "beforeConfirmation",
  "machineOpens",
  "offerFirst",
] as const;
export type JourneyTemplateExclusion = (typeof JOURNEY_TEMPLATE_EXCLUSIONS)[number];

export const JOURNEY_REQUIREMENT_LABEL_KEY: Readonly<Record<JourneyTemplateRequirement, string>> = {
  marketingConsent: "adminJourneys.gallery.requirement.marketingConsent",
  senderName: "adminJourneys.gallery.requirement.senderName",
  legalBasis: "adminJourneys.gallery.requirement.legalBasis",
  busEvent: "adminJourneys.gallery.requirement.busEvent",
};

export const JOURNEY_EXCLUSION_LABEL_KEY: Readonly<Record<JourneyTemplateExclusion, string>> = {
  noEmails: "adminJourneys.gallery.doesNotSend.noEmails",
  withoutConsent: "adminJourneys.gallery.doesNotSend.withoutConsent",
  promotions: "adminJourneys.gallery.doesNotSend.promotions",
  dunning: "adminJourneys.gallery.doesNotSend.dunning",
  afterPurchase: "adminJourneys.gallery.doesNotSend.afterPurchase",
  toPayingMembers: "adminJourneys.gallery.doesNotSend.toPayingMembers",
  tickets: "adminJourneys.gallery.doesNotSend.tickets",
  cancelObstacles: "adminJourneys.gallery.doesNotSend.cancelObstacles",
  paused: "adminJourneys.gallery.doesNotSend.paused",
  eventReminders: "adminJourneys.gallery.doesNotSend.eventReminders",
  secretClubs: "adminJourneys.gallery.doesNotSend.secretClubs",
  afterDecision: "adminJourneys.gallery.doesNotSend.afterDecision",
  beforeConfirmation: "adminJourneys.gallery.doesNotSend.beforeConfirmation",
  machineOpens: "adminJourneys.gallery.doesNotSend.machineOpens",
  offerFirst: "adminJourneys.gallery.doesNotSend.offerFirst",
};

/** Wskazówka Insidera per szablon (parafraza kolumny „Wskazówka”, bez liczb). */
export const JOURNEY_TEMPLATE_TIP_KEY: Readonly<Record<JourneyTemplateKey, string>> = {
  welcome_onboarding: "adminJourneys.gallery.tip.welcome_onboarding",
  newsletter_welcome: "adminJourneys.gallery.tip.newsletter_welcome",
  paywall_nurture: "adminJourneys.gallery.tip.paywall_nurture",
  quota_exhausted_upgrade: "adminJourneys.gallery.tip.quota_exhausted_upgrade",
  abandoned_checkout: "adminJourneys.gallery.tip.abandoned_checkout",
  trial_ending: "adminJourneys.gallery.tip.trial_ending",
  payment_failed_crm: "adminJourneys.gallery.tip.payment_failed_crm",
  cancel_scheduled_save: "adminJourneys.gallery.tip.cancel_scheduled_save",
  winback_30d: "adminJourneys.gallery.tip.winback_30d",
  event_registration_nurture: "adminJourneys.gallery.tip.event_registration_nurture",
  event_attended_upsell: "adminJourneys.gallery.tip.event_attended_upsell",
  club_application_received: "adminJourneys.gallery.tip.club_application_received",
  club_application_followup: "adminJourneys.gallery.tip.club_application_followup",
  pricing_enquiry_b2b: "adminJourneys.gallery.tip.pricing_enquiry_b2b",
};

/**
 * „Czego NIE wysyła” per szablon - z nagłówków plików szablonów
 * (`src/lib/journeys/templates/*.ts`): granice, które szablon świadomie
 * zostawia innym modułom albo regułom. Ogólne wykluczenia (brak zgody dla
 * marketingu, promocje dla usługi, brak maili) dokłada `templateFacts`.
 */
const TEMPLATE_EXCLUSIONS: Readonly<
  Record<JourneyTemplateKey, readonly JourneyTemplateExclusion[]>
> = {
  welcome_onboarding: ["afterPurchase"],
  newsletter_welcome: ["beforeConfirmation", "machineOpens"],
  paywall_nurture: ["offerFirst", "afterPurchase"],
  quota_exhausted_upgrade: ["toPayingMembers"],
  abandoned_checkout: ["tickets", "afterPurchase"],
  trial_ending: [],
  payment_failed_crm: ["dunning"],
  cancel_scheduled_save: ["cancelObstacles"],
  winback_30d: ["paused", "afterPurchase"],
  event_registration_nurture: ["eventReminders"],
  event_attended_upsell: ["toPayingMembers"],
  club_application_received: ["secretClubs"],
  club_application_followup: ["afterDecision"],
  pricing_enquiry_b2b: [],
};

export interface JourneyTemplateFacts {
  key: JourneyTemplateKey;
  category: JourneyCategory;
  available: boolean;
  awaitedEvent: string | null;
  emailCount: number;
  stepCount: number;
  triggerEventType: string;
  goalEventType: string | null;
  reentry: JourneyReentry;
  cooldownDays: number | null;
  requirements: JourneyTemplateRequirement[];
  doesNotSend: JourneyTemplateExclusion[];
  replacesWorkflowTemplate: string | null;
}

export function templateFacts(entry: JourneyTemplateCatalogEntry): JourneyTemplateFacts {
  const available = entry.availability.status === "available";
  const marketing = entry.category === "marketing";
  const requirements: JourneyTemplateRequirement[] = [];
  if (marketing && entry.emailCount > 0) requirements.push("marketingConsent", "senderName");
  if (!marketing) requirements.push("legalBasis");
  if (!available) requirements.push("busEvent");
  const doesNotSend: JourneyTemplateExclusion[] = [];
  if (entry.emailCount === 0) doesNotSend.push("noEmails");
  else if (marketing) doesNotSend.push("withoutConsent");
  else doesNotSend.push("promotions");
  for (const code of TEMPLATE_EXCLUSIONS[entry.key]) {
    if (!doesNotSend.includes(code)) doesNotSend.push(code);
  }
  return {
    key: entry.key,
    category: entry.category,
    available,
    awaitedEvent:
      entry.availability.status === "unavailable" ? entry.availability.awaitedEvent : null,
    emailCount: entry.emailCount,
    stepCount: entry.graph.nodes.length,
    triggerEventType: entry.settings.triggerEventType,
    goalEventType: entry.settings.goal?.eventType ?? null,
    reentry: entry.settings.reentry ?? "never",
    cooldownDays:
      entry.settings.reentry === "cooldown" ? (entry.settings.reentryCooldownDays ?? null) : null,
    requirements,
    doesNotSend,
    replacesWorkflowTemplate: entry.replacesWorkflowTemplate,
  };
}

// ── Zdrowie silnika (pasek listy) ────────────────────────────────────────────

export type JourneyEngineNotice =
  "kill_switch" | "disabled" | "scheduler_pending" | "stalled" | "errors" | null;

/** Krok starszy niż kwadrans przy kontaktach do wykonania = silnik stoi. */
export const ENGINE_STALL_MS = 15 * 60_000;

/**
 * Jeden komunikat paska zdrowia, od najważniejszego. Z-S5-03: runner nie jest
 * jeszcze podpięty do `jobs-tick` (I9), więc włączony silnik z kontaktami
 * „do wykonania” i bez ŻADNEGO wykonanego kroku znaczy „kroki ruszą po
 * podpięciu harmonogramu”, a nie awarię. Gdy znamy poprzedni odczyt, liczba
 * do wykonania musi rosnąć (albo stać) - spadek znaczy, że ktoś je wykonuje.
 */
export function engineHealthNotice(
  health: Pick<
    JourneyEngineHealthDto,
    "enabled" | "killSwitch" | "dueNow" | "lastStepAt" | "failed24h" | "deadSteps24h" | "errors24h"
  >,
  now: number,
  previousDueNow: number | null = null,
): JourneyEngineNotice {
  if (health.killSwitch) return "kill_switch";
  if (!health.enabled) return "disabled";
  const rising = previousDueNow === null || health.dueNow >= previousDueNow;
  if (health.dueNow > 0 && rising) {
    if (health.lastStepAt === null) return "scheduler_pending";
    const last = Date.parse(health.lastStepAt);
    if (Number.isFinite(last) && now - last > ENGINE_STALL_MS) return "stalled";
  }
  const phaseErrors = Object.values(health.errors24h).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  if (health.failed24h > 0 || health.deadSteps24h > 0 || phaseErrors > 0) return "errors";
  return null;
}

export const JOURNEY_ENGINE_NOTICE_KEY: Readonly<
  Record<Exclude<JourneyEngineNotice, null>, string>
> = {
  kill_switch: "adminJourneys.engineStrip.notice.kill_switch",
  disabled: "adminJourneys.engineStrip.notice.disabled",
  scheduler_pending: "adminJourneys.engineStrip.notice.scheduler_pending",
  stalled: "adminJourneys.engineStrip.notice.stalled",
  errors: "adminJourneys.engineStrip.notice.errors",
};
