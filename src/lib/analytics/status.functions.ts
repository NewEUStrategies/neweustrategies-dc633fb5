/**
 * Aggregate status for the /admin/analytics dashboard.
 * Reports which integrations (GSC, GA4, Web Vitals) are configured.
 * Never returns secret values.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface GatewayCtx {
  supabase: {
    from: (t: string) => {
      select: (c: string) => { eq: (col: string, val: string) => Promise<{ data: unknown; error: { message: string } | null }> };
    };
  };
  userId: string;
}

async function requireAdmin(context: GatewayCtx): Promise<void> {
  const { data: roles, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (error) throw new Error(error.message);
  const rows = (roles ?? []) as Array<{ role: string }>;
  if (!rows.some((r) => r.role === "admin")) {
    throw new Error("Forbidden: admin role required");
  }
}

export interface AnalyticsStatus {
  gsc: { configured: boolean };
  ga4: {
    configured: boolean;
    hasServiceAccount: boolean;
    hasPropertyId: boolean;
    serviceAccountEmail: string | null;
    propertyId: string | null;
  };
  vitals: { configured: boolean };
}

export const getAnalyticsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AnalyticsStatus> => {
    await requireAdmin(context as unknown as GatewayCtx);

    const gscOk = Boolean(process.env.LOVABLE_API_KEY && process.env.GOOGLE_SEARCH_CONSOLE_API_KEY);

    const saRaw = process.env.GA4_SERVICE_ACCOUNT_JSON ?? "";
    let saEmail: string | null = null;
    let saOk = false;
    if (saRaw) {
      try {
        const parsed = JSON.parse(saRaw) as { client_email?: string; private_key?: string };
        if (parsed.client_email && parsed.private_key) {
          saOk = true;
          saEmail = parsed.client_email;
        }
      } catch {
        saOk = false;
      }
    }
    const propertyId = process.env.GA4_PROPERTY_ID ?? null;

    return {
      gsc: { configured: gscOk },
      ga4: {
        configured: saOk && Boolean(propertyId),
        hasServiceAccount: saOk,
        hasPropertyId: Boolean(propertyId),
        serviceAccountEmail: saEmail,
        propertyId,
      },
      vitals: { configured: true },
    };
  });
