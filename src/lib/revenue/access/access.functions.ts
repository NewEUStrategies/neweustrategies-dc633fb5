// Server fn inwentarza dostępu huba (S3, kontrakt §5.2).
//
// Bramka `requireCrmStaff` (admin/editor) = bramka SQL
// (`is_admin_or_editor()`); inwentarz nie ma kwot, więc editor dostaje pełny
// wynik. Najemca wyłącznie z sesji - RPC nie ma parametrów. Nazwa RPC jest
// LITERAŁEM w miejscu wywołania (bramka `generate:ts-sql-contract`).
import { createServerFn } from "@tanstack/react-start";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import type { AccessInventoryRead } from "./dto";
import { parseAccessInventory } from "./parse";

/** „Funkcji jeszcze nie ma w tej bazie" - okno wdrożenia, nie awaria. */
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

export const getRevenueAccessInventory = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<AccessInventoryRead> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_revenue_access_inventory",
    );
    if (error) {
      if (error.code === "42501") return { state: "forbidden" };
      if (error.code !== undefined && MISSING_SOURCE.has(error.code)) {
        return { state: "unavailable" };
      }
      throw new Error(error.message);
    }
    return { state: "ready", inventory: parseAccessInventory(raw) };
  });
