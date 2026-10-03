import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import type { Database, Json } from "../../src/integrations/supabase/types";
import { getStripeClient } from "../../src/lib/stripe.server";
import { LANG_COOKIE } from "../../src/lib/i18n/langCookie";
import { LANG_STORAGE_KEY } from "../../src/lib/storageKeys";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing integration setting: ${name}`);
  return value;
}
function record(value: Json | null): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid integration RPC response");
  return value;
}
function checked<T>(result: { data: T; error: { code?: string } | null }): T {
  if (result.error)
    throw new Error(`Integration operation failed (${result.error.code ?? "unknown"})`);
  return result.data;
}

test("real sandbox checkout, repeated webhook, ticket, invoice, check-in and refund", async ({
  browser,
  request,
}) => {
  const baseURL = required("EVENT_INTEGRATION_BASE_URL");
  const origin = new URL(baseURL).origin;
  const tenant = required("EVENT_INTEGRATION_TENANT_ID");
  const slug = required("EVENT_INTEGRATION_EVENT_SLUG");
  if (!slug.startsWith("integration-")) throw new Error("Use a dedicated integration-* event");
  const url = required("EVENT_INTEGRATION_SUPABASE_URL");
  const anon = required("EVENT_INTEGRATION_ANON_KEY");
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-tenant-host": new URL(baseURL).host } },
  };
  const service = createClient<Database>(
    url,
    required("EVENT_INTEGRATION_SERVICE_ROLE_KEY"),
    options,
  );
  const admin = createClient<Database>(url, anon, options);
  const participant = createClient<Database>(url, anon, options);
  const login = await participant.auth.signInWithPassword({
    email: required("EVENT_INTEGRATION_USER_EMAIL"),
    password: required("EVENT_INTEGRATION_USER_PASSWORD"),
  });
  const adminLogin = await admin.auth.signInWithPassword({
    email: required("EVENT_INTEGRATION_ADMIN_EMAIL"),
    password: required("EVENT_INTEGRATION_ADMIN_PASSWORD"),
  });
  if (login.error || adminLogin.error) throw new Error("Integration account login failed");
  const user = login.data;
  if (!user.session || !user.user) throw new Error("Integration user session missing");
  const event = checked(
    await service
      .from("events")
      .select("id,tenant_id")
      .eq("tenant_id", tenant)
      .eq("slug", slug)
      .single(),
  );
  if (!event) throw new Error("Integration event missing");
  const person = checked(
    await service
      .from("event_people")
      .select("id")
      .eq("tenant_id", tenant)
      .eq("user_id", user.user.id)
      .maybeSingle(),
  );
  if (person) {
    const previous = checked(
      await service
        .from("event_registrations")
        .select("id")
        .eq("event_id", event.id)
        .eq("tenant_id", tenant)
        .eq("person_id", person.id),
    );
    expect(previous, "Use a fresh event fixture for each run").toHaveLength(0);
  }
  const secret = required("PAYMENTS_SANDBOX_WEBHOOK_SECRET");
  required("STRIPE_SANDBOX_API_KEY");
  required("LOVABLE_API_KEY");
  const stripe = await getStripeClient("sandbox");
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const site = new URL(baseURL);
  const context = await browser.newContext({
    baseURL,
    storageState: {
      // Polish UI: the app reads the language preference from the `nes_lang`
      // cookie (server and client); without it the client seeds the cookie from
      // the browser locale (en-US in a default context) and app pages
      // (/checkout, /login, /profile) follow it. "i18nextLng" was read by nothing.
      cookies: [
        {
          name: LANG_COOKIE,
          value: "pl",
          domain: site.hostname,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: site.protocol === "https:",
          sameSite: "Lax",
        },
      ],
      origins: [
        {
          origin,
          localStorage: [
            { name: storageKey, value: JSON.stringify(user.session) },
            // Mirror of the cookie, written by the app alongside it.
            { name: LANG_STORAGE_KEY.key, value: "pl" },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();
  let paymentIntent: string | null = null;
  let refunded = false;
  try {
    await page.goto(`/events/${slug}/register`);
    await page.getByLabel(/Imię/).fill("Test");
    await page.getByLabel(/Nazwisko/).fill("Integration");
    await page.getByLabel(/e-mail/i).fill(required("EVENT_INTEGRATION_USER_EMAIL"));
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Zapisz/i }).click();
    await page.getByRole("button", { name: /^Zapłać$/ }).click();
    await page.waitForURL((target) => target.hostname === "checkout.stripe.com");
    const sessionId = page.url().match(/cs_test_[A-Za-z0-9]+/)?.[0];
    if (!sessionId) throw new Error("Refusing checkout without a test-mode Stripe session");
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    expect(checkout.livemode).toBe(false);
    // Hosted Checkout, real test card; no route interception or API mocks.
    await page.locator('input[name="cardNumber"]').fill("4242424242424242");
    await page.locator('input[name="cardExpiry"]').fill("1235");
    await page.locator('input[name="cardCvc"]').fill("123");
    await page.locator('input[name="billingName"]').fill("Test Integration");
    await page.getByTestId("hosted-payment-submit-button").click();
    await expect
      .poll(async () => (await stripe.checkout.sessions.retrieve(sessionId)).payment_status)
      .toBe("paid");
    const paid = await stripe.checkout.sessions.retrieve(sessionId);
    paymentIntent =
      typeof paid.payment_intent === "string"
        ? paid.payment_intent
        : (paid.payment_intent?.id ?? null);
    if (!paymentIntent) throw new Error("Paid checkout has no payment intent");
    await expect
      .poll(
        async () =>
          checked(
            await service
              .from("payment_orders")
              .select("status")
              .eq("tenant_id", tenant)
              .eq("provider_session_id", sessionId)
              .maybeSingle(),
          )?.status,
      )
      .toBe("paid");
    const order = checked(
      await service
        .from("payment_orders")
        .select("id,environment,metadata")
        .eq("tenant_id", tenant)
        .eq("provider_session_id", sessionId)
        .single(),
    );
    if (!order) throw new Error("Integration payment order missing");
    expect(order.environment).toBe("sandbox");
    const registrationId = record(order.metadata).registration_id;
    if (typeof registrationId !== "string")
      throw new Error("Checkout order lost registration binding");

    const events = await stripe.events.list({ type: "checkout.session.completed", limit: 100 });
    const webhook = events.data.find(
      (item) => item.type === "checkout.session.completed" && item.data.object.id === sessionId,
    );
    if (!webhook || webhook.livemode) throw new Error("Real sandbox completion event missing");
    const payload = JSON.stringify(webhook);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.post(`${origin}/api/public/payments/webhook?env=sandbox`, {
        data: payload,
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
      });
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ received: true, duplicate: true });
    }
    const registration = checked(
      await service
        .from("event_registrations")
        .select("status,payment_status")
        .eq("tenant_id", tenant)
        .eq("id", registrationId)
        .single(),
    );
    expect(registration).toEqual({ status: "approved", payment_status: "paid" });
    checked(
      await admin.rpc("admin_event_ticket_resend", {
        p_registration_id: registrationId,
        p_include_group: false,
        p_exclude_ids: [],
      }),
    );
    const codes = checked(
      await service.rpc("_event_issue_ticket_codes", { p_registration_id: registrationId }),
    );
    if (!Array.isArray(codes)) throw new Error("Ticket issuance did not return codes");
    const code = codes
      .map(record)
      .find((item) => item.registration_id === registrationId)?.qr_token;
    if (typeof code !== "string") throw new Error("Paid registration has no usable ticket");
    const invoiceId = checked(
      await admin.rpc("admin_event_invoice_draft_create", {
        p_payload: {
          event_id: event.id,
          kind: "invoice",
          aggregate: "per_source",
          sources: [{ kind: "registration", id: registrationId }],
          buyer: {
            is_company: false,
            name: "Test Integration",
            country: "PL",
            address: "Testowa 1",
            postal_code: "00-001",
            city: "Warszawa",
            email: required("EVENT_INTEGRATION_USER_EMAIL"),
          },
        },
      }),
    );
    if (typeof invoiceId !== "string") throw new Error("Invoice draft missing");
    const issued = record(
      checked(await admin.rpc("admin_event_invoice_issue", { p_id: invoiceId })),
    );
    expect(issued.number).toEqual(expect.any(String));
    const scan = () =>
      participant.rpc("event_checkin_record", {
        p_payload: {
          device_token: required("EVENT_INTEGRATION_SCANNER_TOKEN"),
          checkpoint_id: required("EVENT_INTEGRATION_CHECKPOINT_ID"),
          code,
          client_scan_uid: randomUUID(),
        },
      });
    expect(record(checked(await scan())).admit).toBe(true);
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntent },
      { idempotencyKey: `integration-refund:${paymentIntent}` },
    );
    expect(refund.id).toMatch(/^re_/);
    await expect
      .poll(
        async () =>
          checked(
            await service
              .from("event_registrations")
              .select("payment_status")
              .eq("tenant_id", tenant)
              .eq("id", registrationId)
              .single(),
          )?.payment_status,
      )
      .toBe("refunded");
    refunded = true;
    expect(record(checked(await scan())).admit).toBe(false);
    const invoices = checked(
      await service.from("event_invoices").select("id").eq("tenant_id", tenant).eq("id", invoiceId),
    );
    expect(invoices).toHaveLength(1);
    expect(
      checked(
        await service
          .from("payment_orders")
          .select("id")
          .eq("tenant_id", tenant)
          .eq("provider_session_id", sessionId),
      ),
    ).toHaveLength(1);
  } finally {
    // Preserve financial history for review. Compensate only our sandbox payment.
    if (paymentIntent && !refunded)
      await stripe.refunds.create(
        { payment_intent: paymentIntent },
        { idempotencyKey: `integration-refund:${paymentIntent}` },
      );
    await context.close();
    await participant.auth.signOut();
    await admin.auth.signOut();
  }
});
