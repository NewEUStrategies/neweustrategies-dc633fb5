import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

// A process-wide transport fixture: no request can reach a real gateway.
const period = 1_800_000_000;
const stateFile = process.env.PROBE_FIXTURE_GATEWAY_STATE;
const callsFile = process.env.PROBE_FIXTURE_CALLS;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== "https://probe.invalid") throw new Error("Unexpected external request");
  const advanced = existsSync(stateFile) && JSON.parse(readFileSync(stateFile, "utf8")).advanced;
  // NASZA baza - WYŁĄCZNIE RPC sondy `billing_probe_status`, kluczem
  // PUBLIKOWALNYM i tokenem sondy w ciele (przegląd 7.6: bez `service_role`).
  // Tryb sterowany zmienną PROBE_FIXTURE_LOCAL: `missing` (brak przetworzonego
  // zdarzenia), `failed` (porażka w dzienniku), `stale` (okres w bazie
  // nieprzesunięty), `unauthorized` (zły token -> 403), `malformed` (zły
  // kształt odpowiedzi); domyślnie wszystko się zgadza.
  if (url.pathname.startsWith("/supabase/")) {
    if (url.pathname !== "/supabase/rest/v1/rpc/billing_probe_status")
      throw new Error(
        `Probe must read our database only through billing_probe_status: ${url.pathname}`,
      );
    if (
      request.headers.get("apikey") !== "fixture-publishable" ||
      request.headers.get("Authorization") !== "Bearer fixture-publishable"
    )
      throw new Error("Probe must use the publishable key, never service_role");
    if (request.method !== "POST") throw new Error("Probe RPC is called with POST + JSON body");
    const raw = await request.text();
    appendFileSync(
      callsFile,
      JSON.stringify({ path: url.pathname, method: request.method, body: raw }) + "\n",
    );
    const args = JSON.parse(raw);
    if (url.search !== "") throw new Error("Probe token must not travel in the URL");
    if (args.p_subscription_id !== "sub_probe")
      throw new Error("Probe RPC must be scoped to the probed subscription");
    if (typeof args.p_since !== "string" || Number.isNaN(Date.parse(args.p_since)))
      throw new Error("Probe RPC needs the arming instant");
    const mode = process.env.PROBE_FIXTURE_LOCAL ?? "synced";
    if (mode === "unauthorized" || args.p_token !== "fixture-probe-token")
      return Response.json(
        { code: "42501", message: "billing probe: unauthorized" },
        { status: 403 },
      );
    if (mode === "malformed") return Response.json({ rows: [] });
    const now = new Date().toISOString();
    const events = [];
    if (mode !== "missing")
      events.push({
        event_id: "evt_renewal",
        event_type: "subscription.updated",
        status: "processed",
        error: null,
        created_at: now,
      });
    if (mode === "failed")
      events.push({
        event_id: "evt_invoice",
        event_type: "transaction.completed",
        status: "failed",
        error: "deadlock detected",
        created_at: now,
      });
    const end = mode === "stale" || !advanced ? period : period + 2_592_000;
    return Response.json({
      webhook_events: events,
      subscription: {
        provider_subscription_id: "sub_probe",
        status: "active",
        current_period_end: new Date(end * 1000).toISOString(),
      },
    });
  }
  if (
    request.headers.get("X-Connection-Api-Key") !== "fixture-connection" ||
    request.headers.get("Lovable-API-Key") !== "fixture-platform"
  )
    throw new Error("Invalid fixture authentication");
  appendFileSync(callsFile, JSON.stringify({ path: url.pathname, method: request.method }) + "\n");
  const subscription = {
    id: "sub_probe",
    status: "active",
    test_clock: "clock_probe",
    customer: "cus_probe",
    items: { data: [{ current_period_end: advanced ? period + 2_592_000 : period }] },
  };
  if (url.pathname.endsWith("/advance")) {
    if (process.env.PROBE_FIXTURE_FAIL_POST === "1")
      return new Response("temporary failure", { status: 503 });
    if (
      request.headers.get("Content-Type") !== "application/x-www-form-urlencoded" ||
      new URLSearchParams(await request.text()).get("frozen_time") !== String(period + 60)
    )
      throw new Error("Invalid clock advance request");
    writeFileSync(stateFile, JSON.stringify({ advanced: true }));
    return Response.json({ id: "clock_probe", status: "advancing", frozen_time: period + 60 });
  }
  if (url.pathname.includes("/test_clocks/"))
    return Response.json({
      id: "clock_probe",
      status: process.env.PROBE_FIXTURE_CLOCK_STATUS ?? "ready",
      frozen_time: period - 1000,
    });
  if (url.pathname.endsWith("/subscriptions/sub_probe")) return Response.json(subscription);
  if (url.pathname.endsWith("/subscriptions"))
    return Response.json({
      data: url.searchParams.get("status") === "active" ? [subscription] : [],
    });
  // Punkty odbioru webhooków piaskownicy (przegląd 7.12). Domyślnie nasz punkt
  // subskrybuje wszystko (`*`); PROBE_FIXTURE_ENABLED_EVENTS (JSON) podaje
  // jawną listę, PROBE_FIXTURE_ENDPOINTS=none - brak naszego punktu.
  if (url.pathname.endsWith("/webhook_endpoints")) {
    if (process.env.PROBE_FIXTURE_ENDPOINTS === "none")
      return Response.json({
        data: [
          {
            id: "we_other",
            url: "https://elsewhere.invalid/hooks",
            status: "enabled",
            enabled_events: ["*"],
          },
        ],
      });
    const enabled = process.env.PROBE_FIXTURE_ENABLED_EVENTS
      ? JSON.parse(process.env.PROBE_FIXTURE_ENABLED_EVENTS)
      : ["*"];
    return Response.json({
      data: [
        {
          id: "we_probe",
          url: "https://app.invalid/api/public/payments/webhook?env=sandbox",
          status: "enabled",
          enabled_events: enabled,
        },
      ],
    });
  }
  if (url.pathname.endsWith("/invoices"))
    return Response.json({
      data: [
        {
          id: "in_old",
          status: "paid",
          created: period - 100,
          billing_reason: "subscription_cycle",
        },
        ...(advanced
          ? [
              {
                id: "in_new",
                status: "paid",
                created: period + 61,
                billing_reason: "subscription_cycle",
              },
            ]
          : []),
      ],
    });
  throw new Error(`Unexpected fixture path: ${url.pathname}`);
};
