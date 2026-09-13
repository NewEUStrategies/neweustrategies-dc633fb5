// Skrzynka wysyłek panelu admina - warstwa serwerowa /admin/newsletter/outbox.
//
// PRZYCZYNA ŹRÓDŁOWA. `email_send_log` jest jedynym źródłem prawdy o tym, co
// platforma faktycznie wysłała, ale operator nie miał gdzie do niego zajrzeć:
// diagnoza „czy zaproszenie doszło?" wymagała zapytania SQL. Bez tego widoku
// cicha awaria wysyłki (403 dostawcy, adres na liście wykluczeń, wiadomość w
// DLQ) wygląda z panelu dokładnie tak samo jak sukces.
//
// DEDUPLIKACJA. Jedna wiadomość zostawia w dzienniku KILKA wierszy o tym samym
// `message_id` ('pending' -> 'sent' albo 'dlq'). Liczenie wierszy zawyżałoby
// statystyki dwu-, trzykrotnie, więc wszystkie liczby i tabela biorą wyłącznie
// NAJNOWSZY wiersz dla danego `message_id`.
//
// AUTORYZACJA. `email_send_log` ma RLS dopuszczający wyłącznie `service_role`
// (dziennik zawiera adresy odbiorców i treść błędów dostawcy), więc odczyt idzie
// klientem serwisowym - ale dopiero PO potwierdzeniu roli admina/edytora przez
// `requireAdminEditor`. Klient serwisowy jest importowany wewnątrz handlera:
// moduł `*.functions.ts` trafia do grafu klienta, importy modułowe nie.
//
// ZAKRES DANYCH - GRANICA NAJEMCY STAWIANA JAWNIE. Rola jest liczona
// w TENANCIE WYWOŁUJĄCEGO (`requireAdminEditor` sprawdza `user_roles` po
// `profiles.tenant_id`), ale potwierdzenie roli w tenancie X nie jest zgodą na
// dane tenanta Y - a odczyt niżej idzie kluczem serwisowym, który RLS OMIJA.
// Filtr `.eq("tenant_id", …)` w zapytaniu JEST tu więc jedyną granicą.
// Bez niego admin albo edytor jednego najemcy widział w tym panelu adresy
// odbiorców, nazwy szablonów i komunikaty błędów dostawcy WSZYSTKICH najemców.
//
// Domknięcie wymagało trzech kroków; dwa pierwsze są poza tym plikiem i już
// weszły: (1) `email_send_log.tenant_id` z backfillem i indeksem
// `(tenant_id, created_at DESC)` - 20260913101000_email_log_tenant_scope.sql,
// (2) wypełnianie kolumny przez producentów, a dla tych, którzy najemcy nie
// znają, trigger `email_send_log_bind_tenant` rozstrzygający go z adresu
// odbiorcy - 20260913140000_email_send_log_tenant_producers.sql. Krok (3) to
// filtr w tym pliku. Kolejność była wiążąca: sam filtr przed migracjami
// wyczyściłby operatorowi panel z całej historii.
//
// ŻADNEJ GAŁĘZI WYJĄTKU DLA `super_admin`. `super_admin` jest w tym schemacie
// rolą PER NAJEMCA (`user_roles.tenant_id` NOT NULL od 20260531181120), a
// `is_super_admin()` jest zawężone do `current_tenant_id()`. Wyjątek „super
// admin widzi wszystkich" nie byłby więc udogodnieniem dla operatora
// platformy, tylko odtworzeniem dokładnie tej dziury - dla każdego, kto ma
// `super_admin` we własnym obszarze roboczym. Ten sam wybór i to samo
// uzasadnienie co w `accountAdmin.functions.ts`, `impersonation.functions.ts`
// i `callerTenant.server.ts`, oraz co w polityce `email_send_log_admin_select`.
//
// Wiersz z `tenant_id IS NULL` (adres nierozstrzygalny albo obecny w dwóch
// organizacjach) nie spełnia `.eq(...)` i jest tu świadomie NIEWIDOCZNY - ta
// sama decyzja „fail closed, nie pokaż wszystkim", co w obu migracjach wyżej.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminEditor } from "@/integrations/supabase/require-staff";
import { resolveUserTenantId } from "@/lib/server/userTenant.server";

/** Statusy, na które filtruje panel (reszta trafia do kubełka „inne"). */
export const OUTBOX_STATUSES = [
  "sent",
  "pending",
  "failed",
  "dlq",
  "suppressed",
  "bounced",
  "complained",
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export interface OutboxRow {
  id: string;
  messageId: string | null;
  templateName: string;
  recipientEmail: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface OutboxStats {
  total: number;
  sent: number;
  pending: number;
  failed: number;
  suppressed: number;
}

export interface OutboxResult {
  rows: OutboxRow[];
  stats: OutboxStats;
  templates: string[];
  total: number;
  page: number;
  pageSize: number;
  /** Dziennik był dłuższy niż okno odczytu - liczby są przybliżeniem. */
  truncated: boolean;
}

/** Maksymalna liczba wierszy dziennika czytana na jedno zapytanie. */
const MAX_SCAN_ROWS = 5000;
const PAGE_SIZE = 50;

const inputSchema = z
  .object({
    from: z.string().datetime().nullable().default(null),
    to: z.string().datetime().nullable().default(null),
    days: z.number().int().min(1).max(365).nullable().default(7),
    template: z.string().max(200).nullable().default(null),
    status: z.string().max(40).nullable().default(null),
    search: z.string().max(200).nullable().default(null),
    page: z.number().int().min(1).max(1000).default(1),
  })
  .default({
    from: null,
    to: null,
    days: 7,
    template: null,
    status: null,
    search: null,
    page: 1,
  });

export type OutboxQuery = z.infer<typeof inputSchema>;

/** Granice okna czasu: jawny zakres ma pierwszeństwo przed presetem dni. */
function resolveWindow(data: OutboxQuery): { from: string; to: string } {
  const to = data.to ?? new Date().toISOString();
  if (data.from) return { from: data.from, to };
  const days = data.days ?? 7;
  return { from: new Date(Date.parse(to) - days * 86_400_000).toISOString(), to };
}

/**
 * Najnowszy wiersz na `message_id`. Wiersze bez `message_id` (wpis nigdy nie
 * dotarł do dostawcy) są własnymi, osobnymi wiadomościami - kluczem jest wtedy
 * identyfikator wiersza, żeby nie skleić ich w jedną pozycję.
 */
function latestPerMessage(rows: OutboxRow[]): OutboxRow[] {
  const byKey = new Map<string, OutboxRow>();
  for (const row of rows) {
    const key = row.messageId ?? `row:${row.id}`;
    const current = byKey.get(key);
    if (!current || Date.parse(row.createdAt) > Date.parse(current.createdAt)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function statsOf(rows: OutboxRow[]): OutboxStats {
  const stats: OutboxStats = { total: rows.length, sent: 0, pending: 0, failed: 0, suppressed: 0 };
  for (const row of rows) {
    if (row.status === "sent") stats.sent += 1;
    else if (row.status === "pending") stats.pending += 1;
    else if (row.status === "suppressed") stats.suppressed += 1;
    else if (row.status === "failed" || row.status === "dlq" || row.status === "bounced")
      stats.failed += 1;
  }
  return stats;
}

export const getEmailOutbox = createServerFn({ method: "GET" })
  .middleware([requireAdminEditor])
  .validator((data: unknown) => inputSchema.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<OutboxResult> => {
    // Najemca rozstrzygnięty PRZED dotknięciem dziennika: brak najemcy ma być
    // odmową, a nie zapytaniem bez filtra. Zakres pochodzi WYŁĄCZNIE z profilu
    // wołającego, nigdy z ładunku żądania, a `resolveUserTenantId` rzuca, gdy
    // profil najemcy nie ma (fail closed).
    //
    // Ten sam helper co w `fetchSystemEmailReport` (`system-emails.functions.ts`)
    // - to drugi panel czytający TEN SAM dziennik tym samym kluczem serwisowym,
    // więc granica ma tu mieć jedną definicję, a nie dwie. Mocniejszy wariant
    // `assertCallerTenantMatchesHost` (dokładający kontrolę spójności z hostem)
    // istnieje i jest używany w ścieżkach płatności; gdyby dziennik poczty miał
    // go dostać, powinny go dostać OBA panele naraz.
    const tenantId = await resolveUserTenantId(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const window = resolveWindow(data);

    const { data: raw, error } = await supabaseAdmin
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", window.from)
      .lte("created_at", window.to)
      .order("created_at", { ascending: false })
      .limit(MAX_SCAN_ROWS);

    if (error) throw new Error(error.message);

    const scanned: OutboxRow[] = (raw ?? []).map((row) => ({
      id: row.id,
      messageId: row.message_id,
      templateName: row.template_name,
      recipientEmail: row.recipient_email,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    }));

    const deduped = latestPerMessage(scanned);
    const templates = [...new Set(deduped.map((r) => r.templateName))].sort();

    const needle = data.search?.trim().toLowerCase() ?? "";
    const filtered = deduped.filter((row) => {
      if (data.template && row.templateName !== data.template) return false;
      if (data.status && row.status !== data.status) return false;
      if (needle && !row.recipientEmail.toLowerCase().includes(needle)) return false;
      return true;
    });

    const start = (data.page - 1) * PAGE_SIZE;
    return {
      rows: filtered.slice(start, start + PAGE_SIZE),
      stats: statsOf(filtered),
      templates,
      total: filtered.length,
      page: data.page,
      pageSize: PAGE_SIZE,
      truncated: scanned.length >= MAX_SCAN_ROWS,
    };
  });
