// Komentarz gościa (require_login_to_comment=false). Publiczny server fn:
// service role z tenantem pinowanym po hoście żądania, limit per IP
// (fail-closed na nieznanym IP - wspólny kubełek, wzorzec post.feedback),
// honeypot przeciwko botom. Ustawienia dyskusji, podpis, status moderacji
// i głębokość wątku egzekwuje trigger DB (comments_before_insert) - funkcja
// jest tylko bramą wejściową, nie drugim źródłem prawdy.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const GuestCommentInput = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
  authorName: z.string().trim().min(2).max(80),
  /** Honeypot - ukryte pole formularza; wypełnione = bot. */
  website: z.string().optional(),
});

export interface GuestCommentResult {
  ok: true;
  /** Status nadany przez trigger (pending przy włączonej moderacji). */
  status: "pending" | "approved";
}

export const createGuestComment = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => GuestCommentInput.parse(i ?? {}))
  .handler(async ({ data }): Promise<GuestCommentResult> => {
    // Bot wypełnił honeypot: cicha "zgoda" bez zapisu - nie zdradzamy filtra.
    if (data.website && data.website.trim().length > 0) {
      return { ok: true, status: "pending" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ resolveTenantIdForHost }, { currentTenantHost }, { rateLimit }] = await Promise.all([
      import("@/lib/server/tenant.server"),
      import("@/lib/http/requestHost"),
      import("@/lib/server/rate-limit.server"),
    ]);
    const tenantId = await resolveTenantIdForHost(await currentTenantHost());
    if (!tenantId) throw new Error("tenant unresolved");

    let clientIp = "unknown-ip";
    try {
      const req = getRequest();
      const fwd = req.headers.get("x-forwarded-for");
      clientIp =
        req.headers.get("cf-connecting-ip") ??
        (fwd ? (fwd.split(",")[0]?.trim() ?? "unknown-ip") : "unknown-ip");
    } catch {
      /* brak kontekstu HTTP - zostaje wspólny kubełek */
    }
    if (!(await rateLimit({ scope: "comments.guest", subjectId: clientIp, max: 3 }))) {
      throw new Error("rate limited");
    }

    // Wpis musi istnieć w TYM tenancie - trigger pinuje tenant po wpisie,
    // więc bez tej bramki host A mógłby dopisywać komentarze do wpisów hosta B.
    const { data: post } = await supabaseAdmin
      .from("posts")
      .select("id")
      .eq("id", data.postId)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    if (!post) throw new Error("post not found");

    const { data: row, error } = await supabaseAdmin
      .from("comments")
      .insert({
        post_id: data.postId,
        user_id: null,
        author_name: data.authorName,
        parent_id: data.parentId ?? null,
        body: data.body,
      })
      .select("status")
      .single();
    if (error) {
      // Komunikaty triggera (auth required / disabled / depth) wracają 1:1 -
      // klient mapuje je na przyjazne copy.
      throw new Error(error.message);
    }
    return { ok: true, status: row.status === "approved" ? "approved" : "pending" };
  });
