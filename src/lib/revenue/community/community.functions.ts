// Server fns przekrojów społeczności huba (S4): wydarzenia i kluby.
//
// Bramka `requireCrmStaff` (admin/editor/super_admin) = bramka SQL
// (`is_admin_or_editor()`); kwoty wydarzeń dla editora wyzerowuje do `null`
// SAM SQL (macierz ról huba), więc serwer nie musi i nie może tego
// powtarzać. Najemca NIGDY nie idzie w parametrach - RPC bierze go z sesji
// (`current_tenant_id()`), a klient użytkownika (`context.supabase`) niesie
// tę sesję.
//
// Nazwy RPC są LITERAŁAMI w miejscu wywołania (bramka
// `generate:ts-sql-contract` czyta je ze źródła i sprawdza grant dla
// `authenticated`). Rzutowanie na `RpcCallable` - sygnatury funkcji huba
// dopisuje do `types.ts` dopiero I9 (N19).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import type { RevenueClubsSummaryRead, RevenueEventsSummaryRead } from "./dto";
import { parseRevenueClubsSummary, parseRevenueEventsSummary } from "./parse";

/** Najdłuższe okno przekrojów (SQL: 22023 `window_invalid`). */
export const COMMUNITY_MAX_WINDOW_DAYS = 400;

const DAY_MS = 86_400_000;

/** „Funkcji jeszcze nie ma w tej bazie" - okno wdrożenia, nie awaria. */
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

const WindowInput = z
  .object({
    sinceIso: z.string().datetime({ offset: true }),
    untilIso: z.string().datetime({ offset: true }),
  })
  .refine((w) => Date.parse(w.untilIso) > Date.parse(w.sinceIso), {
    message: "window_invalid",
  })
  .refine(
    (w) => Date.parse(w.untilIso) - Date.parse(w.sinceIso) <= COMMUNITY_MAX_WINDOW_DAYS * DAY_MS,
    { message: "window_invalid" },
  );

export type CommunityWindowInput = z.infer<typeof WindowInput>;

type RpcError = { message: string; code?: string };

/** Odmowa roli i brak funkcji to STAN karty; reszta błędów jest wyjątkiem. */
function stateOf(error: RpcError): { state: "forbidden" } | { state: "unavailable" } {
  if (error.code === "42501") return { state: "forbidden" };
  if (error.code !== undefined && MISSING_SOURCE.has(error.code)) return { state: "unavailable" };
  throw new Error(error.message);
}

export const getRevenueEventsSummary = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => WindowInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueEventsSummaryRead> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_revenue_events_summary",
      { p_since: data.sinceIso, p_until: data.untilIso },
    );
    if (error) return stateOf(error);
    return { state: "ready", summary: parseRevenueEventsSummary(raw) };
  });

export const getRevenueClubsSummary = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => WindowInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueClubsSummaryRead> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_revenue_clubs_summary",
      { p_since: data.sinceIso, p_until: data.untilIso },
    );
    if (error) return stateOf(error);
    return { state: "ready", summary: parseRevenueClubsSummary(raw) };
  });
