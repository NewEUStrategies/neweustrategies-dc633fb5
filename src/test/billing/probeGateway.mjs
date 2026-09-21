import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

// A process-wide transport fixture: no request can reach a real gateway.
const period = 1_800_000_000;
const stateFile = process.env.PROBE_FIXTURE_GATEWAY_STATE;
const callsFile = process.env.PROBE_FIXTURE_CALLS;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== "https://probe.invalid") throw new Error("Unexpected external request");
  if (
    request.headers.get("X-Connection-Api-Key") !== "fixture-connection" ||
    request.headers.get("Lovable-API-Key") !== "fixture-platform"
  )
    throw new Error("Invalid fixture authentication");
  appendFileSync(callsFile, JSON.stringify({ path: url.pathname, method: request.method }) + "\n");
  const advanced = existsSync(stateFile) && JSON.parse(readFileSync(stateFile, "utf8")).advanced;
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
