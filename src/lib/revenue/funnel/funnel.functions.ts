// Server fn lejka czytelnika huba (S3, kontrakt §5.2).
//
// Bramka `requireCrmStaff` (admin/editor + aal2 dla kont z MFA) = bramka SQL
// (`is_admin_or_editor()`): autor odpada już w middleware, a tor `sales`
// (dane CRM) dostaje drugi czynnik tym samym middleware. Kwoty rozstrzyga
// SQL (`paid_amount` = NULL dla editora) - serwer niczego nie dopisuje.
// Najemca NIGDY nie idzie w parametrach - RPC bierze go z sesji
// (`current_tenant_id()`), a klient użytkownika (`context.supabase`) niesie
// tę sesję.
//
// Nazwa RPC jest LITERAŁEM w miejscu wywołania: bramka
// `generate:ts-sql-contract` czyta ją ze źródła i sprawdza grant dla roli
// `authenticated`. Rzutowanie na `RpcCallable` - sygnatury funkcji huba
// dopisuje do `types.ts` dopiero I9 (N19).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { REVENUE_SEGMENTS, REVENUE_TRACKS } from "@/lib/revenue/search";
import type { RevenueFunnelRead } from "./dto";
import { parseRevenueFunnel } from "./parse";

/**
 * Najdłuższe okno, jakie przyjmuje agregat (SQL: 22023 `window_invalid`).
 * Ta sama wartość co `REVENUE_CUSTOM_COMPARE_MAX_DAYS` (test parytetu) -
 * tu bez importu `window.ts`, bo ten ciągnie arytmetykę pulpitu do modułu,
 * który przeglądarka zna tylko jako zaślepkę wywołania.
 */
export const FUNNEL_MAX_WINDOW_DAYS = 400;

const DAY_MS = 86_400_000;

/** „Funkcji jeszcze nie ma w tej bazie" - okno wdrożenia, nie awaria. */
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

const FunnelInput = z
  .object({
    sinceIso: z.string().datetime({ offset: true }),
    untilIso: z.string().datetime({ offset: true }),
    segment: z.enum(REVENUE_SEGMENTS).default("all"),
    track: z.enum(REVENUE_TRACKS).default("all"),
  })
  .refine((w) => Date.parse(w.untilIso) > Date.parse(w.sinceIso), {
    message: "window_invalid",
  })
  .refine(
    (w) => Date.parse(w.untilIso) - Date.parse(w.sinceIso) <= FUNNEL_MAX_WINDOW_DAYS * DAY_MS,
    { message: "window_invalid" },
  );

export type FunnelInput = z.input<typeof FunnelInput>;

export const getRevenueFunnel = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => FunnelInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueFunnelRead> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_revenue_funnel",
      {
        p_since: data.sinceIso,
        p_until: data.untilIso,
        p_segment: data.segment,
        p_track: data.track,
      },
    );
    if (error) {
      // Odmowa roli to stan karty, nie wyjątek: ponowienie jej nie naprawi.
      if (error.code === "42501") return { state: "forbidden" };
      if (error.code !== undefined && MISSING_SOURCE.has(error.code)) {
        return { state: "unavailable" };
      }
      throw new Error(error.message);
    }
    return { state: "ready", funnel: parseRevenueFunnel(raw) };
  });
