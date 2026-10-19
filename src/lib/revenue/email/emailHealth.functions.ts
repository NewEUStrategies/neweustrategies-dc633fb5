// Server fn zdrowia kanału e-mail huba (S1, kontrakt §4.5).
//
// Bramka `requireCrmStaff` (admin/editor/super_admin) = bramka SQL
// (`is_admin_or_editor()`): agregat nie ma kwot, więc editor dostaje pełny
// wynik, a autor odpada już w middleware. Najemca NIGDY nie idzie
// w parametrach - RPC bierze go z sesji (`current_tenant_id()`), a klient
// użytkownika (`context.supabase`) niesie tę sesję.
//
// Nazwa RPC jest LITERAŁEM w miejscu wywołania: bramka
// `generate:ts-sql-contract` czyta ją ze źródła i sprawdza grant dla roli
// `authenticated`. Rzutowanie na `RpcCallable` - sygnatury funkcji huba
// dopisuje do `types.ts` dopiero I9 (N19).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import type { RevenueEmailHealthRead } from "./dto";
import { parseRevenueEmailHealth } from "./parse";

/**
 * Najdłuższe okno, jakie przyjmuje agregat (SQL: 22023 `window_invalid`).
 * Ta sama wartość co `REVENUE_CUSTOM_COMPARE_MAX_DAYS` (test parytetu) -
 * tu bez importu `window.ts`, bo ten ciągnie arytmetykę pulpitu do modułu,
 * który przeglądarka zna tylko jako zaślepkę wywołania.
 */
export const EMAIL_HEALTH_MAX_WINDOW_DAYS = 400;

const DAY_MS = 86_400_000;

/**
 * Błędy znaczące „funkcji jeszcze nie ma w tej bazie": migracje wdrażają się
 * osobno od aplikacji, więc przez kilka minut każdej publikacji to stan
 * normalny, a nie awaria do ponawiania.
 */
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

const EmailHealthInput = z
  .object({
    sinceIso: z.string().datetime({ offset: true }),
    untilIso: z.string().datetime({ offset: true }),
  })
  .refine((w) => Date.parse(w.untilIso) > Date.parse(w.sinceIso), {
    message: "window_invalid",
  })
  .refine(
    (w) => Date.parse(w.untilIso) - Date.parse(w.sinceIso) <= EMAIL_HEALTH_MAX_WINDOW_DAYS * DAY_MS,
    { message: "window_invalid" },
  );

export type EmailHealthInput = z.infer<typeof EmailHealthInput>;

export const getRevenueEmailHealth = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => EmailHealthInput.parse(input))
  .handler(async ({ data, context }): Promise<RevenueEmailHealthRead> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_revenue_email_health",
      { p_since: data.sinceIso, p_until: data.untilIso },
    );
    if (error) {
      // Odmowa roli to stan karty, nie wyjątek: ponowienie jej nie naprawi,
      // a toast „błąd" sugerowałby awarię tam, gdzie jest decyzja uprawnień.
      if (error.code === "42501") return { state: "forbidden" };
      if (error.code !== undefined && MISSING_SOURCE.has(error.code)) {
        return { state: "unavailable" };
      }
      throw new Error(error.message);
    }
    return { state: "ready", health: parseRevenueEmailHealth(raw) };
  });
