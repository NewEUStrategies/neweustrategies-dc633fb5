// Server fn kanału darowizn / mecenatu (P1 z oceny konkurencyjnej - model
// "mecenatu obywatelskiego" Nowej Konfederacji).
//
// Publiczny endpoint BEZ logowania (darczyńca nie musi mieć konta), więc
// utwardzony jak submitContactMessage: limit per-IP fail-closed przy nieznanym
// IP + kwota walidowana serwerowo (klient nie ustala niczego poza kwotą
// w dozwolonym przedziale - darowizna nie nadaje żadnych uprawnień, więc
// manipulacja kwotą nie daje atakującemu nic).
//
// Darowizny NIE przechodzą przez payment_orders (wymaga user_id i zasila
// grantEntitlement). Ścieżka zapisu:
//   - Stripe: webhook checkout.session.completed z metadata.kind=donation
//     -> INSERT do public.donations (idempotentnie po provider_session_id),
//   - mock (brak klucza Stripe): INSERT bezpośrednio tutaj.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { donationInputSchema } from "@/lib/billing/donations.schema";

export const createDonationCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => donationInputSchema.parse(input))
  .handler(async ({ data }) => {
    // Klient IP z nagłówków proxy (ta sama derywacja co formularz kontaktowy).
    let clientIp: string | null = null;
    try {
      const req = getRequest();
      const fwd = req.headers.get("x-forwarded-for");
      const fwdFirst = fwd ? (fwd.split(",")[0]?.trim() ?? null) : null;
      clientIp = req.headers.get("cf-connecting-ip") ?? fwdFirst ?? req.headers.get("x-real-ip");
    } catch {
      // brak kontekstu HTTP (testy) - wspólny kubełek "unknown-ip" niżej
    }

    // Fail CLOSED na nieznanym IP - zdjęcie nagłówka nie omija limitu.
    const { rateLimit } = await import("@/lib/server/rate-limit.server");
    const ipOk = await rateLimit({
      scope: "donation.checkout",
      subjectId: clientIp ?? "unknown-ip",
      max: 5,
      windowMinutes: 10,
    });
    if (!ipOk) throw new Error("rate_limited");

    // Darowizna jest przypisywana najemcy przeglądanego hosta (jak kontakt).
    const [{ resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
      import("@/lib/server/tenant.server"),
      import("@/lib/http/requestHost"),
    ]);
    const hostTenantId = await resolveTenantIdForHost(await currentTenantHost());
    if (!hostTenantId) throw new Error("tenant_unresolved");

    const label =
      data.lang === "en"
        ? "Donation — New European Strategies"
        : "Darowizna — New European Strategies";
    const message = data.message?.trim() ? data.message.trim() : null;

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const origin = process.env.PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.URL ?? "";

    if (stripeSecret && origin) {
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", `${origin}/support?status=success`);
      params.set("cancel_url", `${origin}/support?status=cancelled`);
      params.set("line_items[0][price_data][currency]", "pln");
      params.set("line_items[0][price_data][unit_amount]", String(data.amount_cents));
      params.set("line_items[0][price_data][product_data][name]", label);
      params.set("line_items[0][quantity]", "1");
      // Rozpoznanie darowizny w webhooku + atrybucja najemcy i nota darczyńcy.
      params.set("metadata[kind]", "donation");
      params.set("metadata[tenant_id]", hostTenantId);
      if (message) params.set("metadata[message]", message.slice(0, 480));
      params.set("submit_type", "donate");

      const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        console.error("[donations] stripe session failed", resp.status, txt.slice(0, 200));
        return { ok: false as const, error: "stripe_failed" as const };
      }
      const session = (await resp.json()) as { url: string };
      return { ok: true as const, mode: "stripe" as const, url: session.url };
    }

    // Tryb mock (dev bez Stripe): zapis od razu, żeby lejek dało się testować.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("donations").insert({
      tenant_id: hostTenantId,
      amount_cents: data.amount_cents,
      currency: "PLN",
      message,
      provider: "mock",
      provider_session_id: `mock_${crypto.randomUUID()}`,
    });
    if (error) {
      console.error("[donations] mock insert failed", error);
      return { ok: false as const, error: "mock_failed" as const };
    }
    return { ok: true as const, mode: "mock" as const, url: "/support?status=success&mock=1" };
  });
