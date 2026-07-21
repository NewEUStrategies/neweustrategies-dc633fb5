// CRM Companies server functions. Zwracamy dane w formie JSON string, aby
// uniknąć problemów z serializacją Supabase (jsonb) — analogicznie do
// crm.functions.ts. Wszystkie fetche jadą przez `requireStaff`, więc RLS
// (tenant_id = current_tenant_id()) obowiązuje automatycznie.
import { createServerFn } from "@tanstack/react-start";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { z } from "zod";

type AnyQuery = {
  select: (s: string, opts?: { count?: "exact"; head?: boolean }) => AnyQuery;
  order: (c: string, o: { ascending: boolean }) => AnyQuery;
  limit: (n: number) => AnyQuery;
  eq: (c: string, v: unknown) => AnyQuery;
  in: (c: string, v: unknown[]) => AnyQuery;
  or: (f: string) => AnyQuery;
  ilike: (c: string, v: string) => AnyQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
  then: <R>(fn: (r: { data: unknown; error: { message: string } | null }) => R) => Promise<R>;
};
const tbl = (ctx: { supabase: unknown }, name: string): AnyQuery =>
  (ctx.supabase as { from: (t: string) => AnyQuery }).from(name);

const j = (v: unknown): string => JSON.stringify(v ?? null);

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const listCrmCompanies = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    let q = tbl(context, "crm_companies")
      .select("id, name, domain, country, branch, city, website, phone, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.search) {
      const s = `%${data.search.toLowerCase().replace(/[%_,()"\\]/g, "")}%`;
      q = q.or(`name.ilike.${s},domain.ilike.${s},city.ilike.${s},country.ilike.${s}`);
    }
    const { data: rows, error } = await (q as unknown as Promise<{
      data: unknown[];
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);
    return { json: j(rows ?? []) };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const getCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: company, error } = await tbl(context, "crm_companies")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!company) throw new Error("not_found");

    const fetchAll = async <T>(p: Promise<{ data: unknown }>): Promise<T> =>
      ((await p).data ?? []) as T;

    const [profiles, leads] = await Promise.all([
      fetchAll(
        tbl(context, "profiles")
          .select(
            "id, display_name, first_name, last_name, avatar_url, job_title, location, slug, contact_email, discoverable",
          )
          .eq("current_company_id", data.id)
          .order("updated_at", { ascending: false })
          .limit(200) as unknown as Promise<{ data: unknown }>,
      ),
      fetchAll(
        tbl(context, "crm_leads")
          .select(
            "id, email, first_name, last_name, phone, position, stage, tags, score, score_band, last_activity_at, created_at",
          )
          .eq("company_id", data.id)
          .order("last_activity_at", { ascending: false })
          .limit(200) as unknown as Promise<{ data: unknown }>,
      ),
    ]);

    return { json: j({ company, profiles, leads }) };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  domain: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  branch: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
});

export const updateCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const supa = context.supabase as unknown as {
      from: (t: string) => {
        update: (v: unknown) => {
          eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await supa.from("crm_companies").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
