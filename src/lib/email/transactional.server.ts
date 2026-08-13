import * as React from "react";

import { render } from "@react-email/render";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { TxEmail, type TxDetail } from "@/lib/email-templates/transactional";
import { txCopy, txSubject, type TxEmailType } from "@/lib/email-templates/tx-copy";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
// `uiLocale` to jedyne miejsce, w ktorym jezyk zamienia sie na znacznik BCP-47.
// Maile mialy wlasna kopie tej decyzji - ta sama para "pl-PL"/"en-GB", ale
// osobna, wiec zmiana konwencji (np. na en-IE) rozjechalaby maile ze stroną.
// Modul `lib/i18n/format` jest czysty (samo `Intl`), wiec wolno go uzyc na serwerze.
import { uiLocale } from "@/lib/i18n/format";
import { resolveRecipientName } from "@/lib/email/recipient-name.server";
import { txBody, type TxBodyVars } from "@/lib/email-templates/tx-body";
import { loadTxOverrides } from "@/lib/email/txOverrides.server";
import { overrideFor, resolvedField } from "@/lib/email/txOverrides";
import { checkSendAllowed } from "@/lib/email/suppression.server";
import {
  emailCategoryForLabel,
  suppressionSkipReason,
  txEmailCategory,
  type EmailCategory,
} from "@/lib/email/suppressionPolicy";

const SITE_NAME = "New European Strategies";
const SITE_URL = "https://neweuropeanstrategies.com";
const SENDER_DOMAIN = "notify.mail.neweuropeanstrategies.com";
const FROM_DOMAIN = "neweuropeanstrategies.com";
const QUEUE = "transactional_emails";

export interface TxSendInput {
  type: TxEmailType;
  to: string;
  lang?: EmailLang;
  /** Nazwa planu / tytuł wydarzenia - trafia do tematu wiadomości. */
  subjectName?: string | null;
  details?: TxDetail[];
  ctaPath?: string;
  /**
   * Bezwzględny adres CTA (np. jednorazowy link do portalu operatora płatności).
   * Ma pierwszeństwo przed `ctaPath`, bo prowadzi poza domenę serwisu.
   */
  ctaUrl?: string;
  ctaLabel?: string;
  extra?: string | null;
  /**
   * Zmienne personalizacji treści (plan, kwota, daty, prorata, karencja).
   * Na ich podstawie `tx-body` buduje akapity odmienione przez rodzaj
   * gramatyczny odbiorcy - bez nich mail wraca do treści ogólnej.
   */
  bodyVars?: TxBodyVars;
  /** Imię z metadanych (gdy znane) - inaczej rozwiązywane ze słownika. */
  metaName?: string | null;
  /** Klucz idempotencji - ten sam klucz nie wyśle maila dwa razy. */
  idempotencyKey: string;
  /**
   * Tenant odbiorcy, gdy wywołujący go zna (webhook płatności, panel). Bez
   * niego jest rozwiązywany z adresu - lista wykluczeń jest tenant-scoped,
   * a ta ścieżka biegnie na service_role, bez sesji i bez nagłówka hosta.
   */
  tenantId?: string | null;
}

export interface TxSendResult {
  ok: boolean;
  skipped?: "duplicate" | "suppressed" | "no_recipient";
  /** Powód blokady, gdy wysyłka została pominięta (np. "suppressed:complaint"). */
  reason?: string;
  error?: string;
}

/**
 * Klient service-role otypowany schematem (`Database`). Typ jest tu istotny, a
 * nie kosmetyczny: bez niego brama listy wykluczeń musiałaby przyjmować klienta
 * przez rzutowanie, a wtedy literówka w nazwie tabeli logu przeszłaby kompilację.
 */
function serviceClient(): SupabaseClient<Database> | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/**
 * Brama listy wykluczeń dla poczty 1:1 - wspólna dla `sendTxEmail` i
 * `enqueueRawEmail`.
 *
 * PRZYCZYNA ŹRÓDŁOWA: wcześniej ten kod czytał listę wykluczeń, a potem
 * respektował ją WYŁĄCZNIE dla jednego z 19 typów maila
 * (`input.type === "newsletter_confirmed"`). Pozostałe 18 typów wychodziło na
 * adresy po twardym odbiciu i po skardze na spam - najdroższy możliwy błąd,
 * bo reputacja domeny nadawczej jest wspólna dla całej poczty, także tej,
 * której nie wolno stracić.
 *
 * Decyzję podejmuje teraz macierz POWÓD x KATEGORIA (suppressionPolicy):
 * skarga i twarde odbicie zatrzymują wszystko, wypis z newslettera zatrzymuje
 * tylko wysyłkę za zgodą, a potwierdzenie płatności dostarczamy dalej.
 *
 * Pominięcie ZAWSZE zostawia ślad w `email_send_log` ze statusem 'suppressed' -
 * cisza w skrzynce odbiorcy musi być widoczna w panelu, inaczej nie da się
 * odróżnić „nie wysłaliśmy świadomie" od „potok się zepsuł".
 */
async function suppressionGate(
  supabase: SupabaseClient<Database>,
  args: {
    to: string;
    label: string;
    category: EmailCategory;
    /**
     * Identyfikator wiadomości. WYMAGANY, nie opcjonalny: raport poczty
     * systemowej deduplikuje wiersze po `message_id` i POMIJA te bez niego
     * (`fetchSystemEmailReport` → `dedupe`), więc wpis bez identyfikatora byłby
     * dokładnie tą niewidzialnością, którą ta bramka ma usunąć. Wyliczony z
     * klucza idempotencji, więc powtórzona próba nie zawyża licznika pominięć.
     */
    messageId: string;
    tenantId?: string | null;
  },
): Promise<{ allowed: boolean; reason?: string; tenantId: string | null }> {
  const gate = await checkSendAllowed(supabase, {
    email: args.to,
    category: args.category,
    tenantId: args.tenantId ?? null,
  });
  if (gate.allowed) return { allowed: true, tenantId: gate.tenantId };

  const reason = gate.hit ? suppressionSkipReason(gate.hit.reason) : "suppressed";
  await supabase.from("email_send_log").insert({
    message_id: args.messageId,
    template_name: args.label,
    recipient_email: args.to,
    status: "suppressed",
    error_message: reason,
  });
  return { allowed: false, reason, tenantId: gate.tenantId };
}

/**
 * Czy ta wiadomość jest już w obiegu albo dostarczona.
 *
 * Liczą się WYŁĄCZNIE statusy 'pending' i 'sent'. Dwie rzeczy zależą od tej
 * precyzji:
 *
 *  - wiersz 'suppressed' NIE może zamykać sprawy na zawsze. Bramka listy
 *    wykluczeń zapisuje go przy każdym świadomym pominięciu; gdyby liczył się
 *    jako „już obsłużone", zdjęcie blokady nie odblokowałoby wysyłki - mail o
 *    nieudanej płatności zostałby uziemiony na stałe. Przy ponowieniu bramka i
 *    tak sprawdzi listę od nowa i zablokuje ponownie, jeśli powód nadal trwa.
 *  - wiersze 'failed' też się nie liczą - ponowienie po błędzie dostawcy jest
 *    dokładnie tym, czego chcemy (budżet ponowień pilnuje dren kolejki).
 *
 * Zapytanie zwraca listę z LIMIT 1, a nie `maybeSingle()`: log ma z natury
 * WIELE wierszy na `message_id` (pending -> sent, kolejne próby), a
 * `maybeSingle()` traktuje to jako błąd i po cichu degraduje do „nie ma".
 */
async function alreadyHandled(
  supabase: SupabaseClient<Database>,
  messageId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("email_send_log")
    .select("id")
    .eq("message_id", messageId)
    .in("status", ["pending", "sent"])
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

/** Kwota w groszach/centach -> czytelny zapis w języku odbiorcy. */
export function formatMoney(amountCents: number, currency: string, lang: EmailLang): string {
  return new Intl.NumberFormat(uiLocale(lang), {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

/** Data ISO -> czytelny zapis w języku odbiorcy. */
export function formatDate(iso: string, lang: EmailLang, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(uiLocale(lang), {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

/**
 * Wysyła mail transakcyjny w standardzie NES (kolejka `transactional_emails`,
 * ten sam dispatcher co maile autoryzacyjne).
 *
 * - idempotencja: `email_send_log.message_id` z deterministycznego klucza,
 * - fail-soft: błąd wysyłki nigdy nie może wywrócić webhooka płatności.
 */
export async function sendTxEmail(input: TxSendInput): Promise<TxSendResult> {
  const to = input.to?.trim().toLowerCase();
  if (!to) return { ok: false, skipped: "no_recipient" };

  const supabase = serviceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  const lang: EmailLang = input.lang === "en" ? "en" : "pl";

  try {
    const messageId = await deterministicId(input.idempotencyKey);

    // Higiena listy dla KAŻDEGO z 19 typów - patrz suppressionGate.
    const gate = await suppressionGate(supabase, {
      to,
      label: input.type,
      category: txEmailCategory(input.type),
      messageId,
      tenantId: input.tenantId,
    });
    if (!gate.allowed) {
      return { ok: false, skipped: "suppressed", reason: gate.reason };
    }

    if (await alreadyHandled(supabase, messageId)) return { ok: true, skipped: "duplicate" };

    const name = await resolveRecipientName(supabase, to, input.metaName ?? null);

    const body = txBody(input.type, lang, name.gender, input.bodyVars ?? {});

    // Treści edytowalne w panelu (karencja / koniec dostępu zespołowego).
    const override = overrideFor(await loadTxOverrides(supabase), input.type, lang);
    const tokens = {
      planName: input.bodyVars?.planName ?? null,
      orgName: input.bodyVars?.orgName ?? null,
      accessUntil: input.bodyVars?.accessUntil ?? null,
      daysLeft: input.bodyVars?.daysLeft ?? null,
      subject: input.subjectName ?? null,
      firstName: name.firstName ?? null,
    };
    const ov = (key: Parameters<typeof resolvedField>[1]) => resolvedField(override, key, tokens);

    const element = React.createElement(TxEmail, {
      type: input.type,
      lang,
      siteUrl: SITE_URL,
      ctaUrl: input.ctaUrl ?? (input.ctaPath ? `${SITE_URL}${input.ctaPath}` : undefined),
      details: input.details ?? [],
      extra: ov("extra") ?? input.extra ?? body.extra ?? null,
      intro: ov("intro") ?? body.intro ?? null,
      note: ov("note") ?? body.note ?? null,
      preview: ov("preview"),
      eyebrow: ov("eyebrow"),
      heading: ov("heading"),
      ctaLabel: ov("cta") ?? input.ctaLabel,
      firstName: name.firstName,
      gender: name.gender,
      vocativePl: name.vocativePl,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject =
      ov("subject") ?? txSubject(input.type, lang, { subject: input.subjectName ?? null });

    await supabase.from("email_send_log").insert({
      message_id: messageId,
      template_name: input.type,
      recipient_email: to,
      status: "pending",
    });

    const { error } = await supabase.rpc("enqueue_email", {
      queue_name: QUEUE,
      payload: {
        run_id: crypto.randomUUID(),
        message_id: messageId,
        to,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: "transactional",
        label: input.type,
        idempotency_key: input.idempotencyKey,
        // Tenant w ładunku: dren sprawdza listę wykluczeń PONOWNIE w chwili
        // wysyłki (adres mógł w tym czasie odbić), a mając tenanta robi to bez
        // dodatkowego zapytania rozwiązującego.
        tenant_id: gate.tenantId,
        queued_at: new Date().toISOString(),
      },
    });

    if (error) {
      await supabase.from("email_send_log").insert({
        message_id: messageId,
        template_name: input.type,
        recipient_email: to,
        status: "failed",
        error_message: error.message,
      });
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    console.error("[tx-email] send failed", input.type, err);
    return { ok: false, error: String(err) };
  }
}

/** UUID wyliczony z klucza idempotencji (stabilny między próbami/retry). */
async function deterministicId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const b = Array.from(new Uint8Array(digest)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface RawEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Etykieta w logu dostarczalności (np. "digest_daily"). */
  label: string;
  /** Klucz idempotencji - ten sam klucz nie wyśle maila dwa razy. */
  idempotencyKey: string;
  /**
   * Kategoria dla listy wykluczeń. Domyślnie wyprowadzana z etykiety
   * (`emailCategoryForLabel`), z fail-safe na `bulk`: nieznany kanał ma być
   * traktowany ostrożniej, nie luźniej.
   */
  category?: EmailCategory;
  /** Tenant odbiorcy, gdy znany - inaczej rozwiązywany z adresu. */
  tenantId?: string | null;
  /** Adres wypisu -> nagłówki RFC 8058 dla wysyłki masowej. */
  unsubscribeUrl?: string | null;
}

/**
 * Wysyła gotowy HTML tą samą kolejką co maile transakcyjne/autoryzacyjne
 * (`transactional_emails` + `email_send_log`). Używane przez kanały, które
 * budują własny szablon (digest powiadomień) - dzięki temu KAŻDY mail systemu
 * ma jeden nadawca, jedną listę wykluczeń i jeden log dostarczalności.
 */
export async function enqueueRawEmail(input: RawEmailInput): Promise<TxSendResult> {
  const to = input.to?.trim().toLowerCase();
  if (!to) return { ok: false, skipped: "no_recipient" };

  const supabase = serviceClient();
  if (!supabase) return { ok: false, error: "supabase_unavailable" };

  try {
    const messageId = await deterministicId(input.idempotencyKey);

    const gate = await suppressionGate(supabase, {
      to,
      label: input.label,
      category: input.category ?? emailCategoryForLabel(input.label),
      messageId,
      tenantId: input.tenantId,
    });
    if (!gate.allowed) return { ok: false, skipped: "suppressed", reason: gate.reason };

    if (await alreadyHandled(supabase, messageId)) return { ok: true, skipped: "duplicate" };

    await supabase.from("email_send_log").insert({
      message_id: messageId,
      template_name: input.label,
      recipient_email: to,
      status: "pending",
    });

    const { error } = await supabase.rpc("enqueue_email", {
      queue_name: QUEUE,
      payload: {
        run_id: crypto.randomUUID(),
        message_id: messageId,
        to,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: input.subject,
        html: input.html,
        text: input.text ?? "",
        purpose: "transactional",
        label: input.label,
        idempotency_key: input.idempotencyKey,
        tenant_id: gate.tenantId,
        unsubscribe_url: input.unsubscribeUrl ?? null,
        queued_at: new Date().toISOString(),
      },
    });

    if (error) {
      await supabase.from("email_send_log").insert({
        message_id: messageId,
        template_name: input.label,
        recipient_email: to,
        status: "failed",
        error_message: error.message,
      });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.error("[tx-email] raw enqueue failed", input.label, err);
    return { ok: false, error: String(err) };
  }
}

export const __txCopyForTests = txCopy;
