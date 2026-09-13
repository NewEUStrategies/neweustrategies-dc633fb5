// Ręczne uruchomienie skanu linków (B7) z panelu - ta sama porcja co tick
// (rotacja po najdawniej sprawdzonych), tylko większa. Admin-only.
//
// SKAN IDZIE WYŁĄCZNIE PO NAJEMCY WOŁAJĄCEGO. Porcja jest czytana i ZAPISYWANA
// kluczem serwisowym (kolumny treści są dla klientów odcięte), więc bez
// jawnego zakresu przycisk w panelu drenował kolejkę WSZYSTKICH najemców:
// zapisywał `outbound_link_checks` i `posts.outbound_links_checked_at` w cudzym
// obszarze i wstrzykiwał wiersze `notifications` jego adminom. Najemcę bierzemy
// z PROFILU wołającego - z tej samej płaszczyzny, po której autoryzuje
// `has_role()` w middleware (wzorzec: `src/lib/admin/scheduler.functions.ts`).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { rateLimit } from "@/lib/server/rate-limit.server";

export const runLinkScanNow = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((i: unknown) =>
    z.object({ posts: z.number().int().min(1).max(20).default(10) }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!(await rateLimit({ scope: "link-monitor.scan", subjectId: userId, max: 6 }))) {
      throw new Error("Rate limit exceeded - please slow down");
    }
    const [{ supabaseAdmin }, { runLinkCheckBatch }, { resolveUserTenantId }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/server/linkCheck.server"),
      import("@/lib/server/userTenant.server"),
    ]);
    const tenantId = await resolveUserTenantId(supabaseAdmin, userId);
    return runLinkCheckBatch(supabaseAdmin, data.posts, tenantId);
  });
