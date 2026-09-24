// Publiczne pytanie „czy ten slug należy do osoby bez roli autora" - służy
// wyłącznie do 301 z /author/<slug> na /people/<slug>. Nie ujawnia danych.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export const isNonAuthorMemberSlug = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ slug: z.string().min(1).max(200) }).parse(data))
  .handler(async ({ data }): Promise<boolean> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return false;
    const client = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: result, error } = await client.rpc("member_slug_is_non_author", {
      p_slug: data.slug,
    });
    if (error) return false;
    return result === true;
  });
