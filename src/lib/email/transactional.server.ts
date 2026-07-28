import * as React from "react";

import { render } from "@react-email/render";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { TxEmail, type TxDetail } from "@/lib/email-templates/transactional";
import { txCopy, txSubject, type TxEmailType } from "@/lib/email-templates/tx-copy";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import { resolveRecipientName } from "@/lib/email/recipient-name.server";

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
  ctaLabel?: string;
  extra?: string | null;
  /** Imię z metadanych (gdy znane) - inaczej rozwiązywane ze słownika. */
  metaName?: string | null;
  /** Klucz idempotencji - ten sam klucz nie wyśle maila dwa razy. */
  idempotencyKey: string;
}

export interface TxSendResult {
  ok: boolean;
  skipped?: "duplicate" | "suppressed" | "no_recipient";
  error?: string;
}

function serviceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Kwota w groszach/centach -> czytelny zapis w języku odbiorcy. */
export function formatMoney(amountCents: number, currency: string, lang: EmailLang): string {
  return new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(amountCents / 100);
}

/** Data ISO -> czytelny zapis w języku odbiorcy. */
export function formatDate(iso: string, lang: EmailLang, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", {
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
    // Twardy zatrzask na adresy wypisane / odbite - suppression obowiązuje
    // także maile transakcyjne poza rozliczeniowymi potwierdzeniami płatności.
    const { data: suppressed } = await supabase
      .from("suppressed_emails")
      .select("email")
      .eq("email", to)
      .maybeSingle();
    if (suppressed && input.type === "newsletter_confirmed") {
      return { ok: false, skipped: "suppressed" };
    }

    const messageId = await deterministicId(input.idempotencyKey);

    const { data: already } = await supabase
      .from("email_send_log")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle();
    if (already) return { ok: true, skipped: "duplicate" };

    const name = await resolveRecipientName(supabase, to, input.metaName ?? null);

    const element = React.createElement(TxEmail, {
      type: input.type,
      lang,
      siteUrl: SITE_URL,
      ctaUrl: input.ctaPath ? `${SITE_URL}${input.ctaPath}` : undefined,
      ctaLabel: input.ctaLabel,
      details: input.details ?? [],
      extra: input.extra ?? null,
      firstName: name.firstName,
      gender: name.gender,
      vocativePl: name.vocativePl,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject = txSubject(input.type, lang, { subject: input.subjectName ?? null });

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

export const __txCopyForTests = txCopy;
