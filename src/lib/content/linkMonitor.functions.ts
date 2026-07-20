// Ręczne uruchomienie skanu linków (B7) z panelu - ta sama porcja co tick
// (rotacja po najdawniej sprawdzonych), tylko większa. Admin-only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { rateLimit } from "@/lib/server/rate-limit.server";

export const runLinkScanNow = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z.object({ posts: z.number().int().min(1).max(20).default(10) }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (!(await rateLimit({ scope: "link-monitor.scan", subjectId: userId, max: 6 }))) {
      throw new Error("Rate limit exceeded - please slow down");
    }
    const [{ supabaseAdmin }, { runLinkCheckBatch }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/server/linkCheck.server"),
    ]);
    return runLinkCheckBatch(supabaseAdmin, data.posts);
  });
