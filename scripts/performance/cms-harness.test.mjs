import { test } from "node:test";
import assert from "node:assert/strict";
import { cmsPages, cmsFixtureResponse } from "./cmsFixture.ts";
import { compareSamples } from "./compare-cms-widgets.mjs";
const rpc = (name, data) =>
  cmsFixtureResponse(
    new Request(`http://127.0.0.1:4199/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  );

test("every measured path resolves to its own metadata and bilingual body", async () => {
  assert.equal(cmsPages.length, 4);
  for (const page of cmsPages) {
    assert.deepEqual(await (await rpc("resolve_path", { _segments: [page.slug] })).json(), [
      { page_id: page.id, post_id: null },
    ]);
    const body = await (
      await rpc("get_entity_content", { _entity_type: "page", _entity_id: page.id })
    ).json();
    assert.deepEqual(body, [page.body]);
    assert.ok(JSON.stringify(body).includes("CMS END"));
    assert.equal(JSON.stringify(body).includes('"contact-form"'), page.slug.endsWith("form"));
    const response = await cmsFixtureResponse(
      new Request(`http://127.0.0.1:4199/rest/v1/pages?id=eq.${page.id}`, {
        headers: { accept: "application/vnd.pgrst.object+json" },
      }),
    );
    const metadata = await response.json();
    assert.equal(metadata.editor, page.editor);
    assert.equal(metadata.body, undefined);
    const crumbs = await (await rpc("page_breadcrumbs", { _page_id: page.id })).json();
    assert.equal(crumbs[0].full_path, page.slug);
  }
});
test("unknown queries and writes fail instead of silently passing", async () => {
  await assert.rejects(rpc("unknown_rpc", {}), /Unrecorded/);
  await assert.rejects(
    cmsFixtureResponse(
      new Request(`http://127.0.0.1:4199/rest/v1/pages?id=eq.${cmsPages[0].id}`, {
        method: "POST",
        body: "{}",
      }),
    ),
    /rejects database writes/,
  );
});
const expected = {
  engine: "blocks",
  variant: "text",
  lang: "pl",
  device: "mobile",
  serverCache: "cold",
};
const samples = () =>
  [1, 2, 3].map((sample) => ({
    ...expected,
    sample,
    cache: "MISS",
    browserCache: "cold-routing-disables-http-cache",
    serverTitleRetained: true,
    ttfbMs: 100,
    fcpMs: 200,
    lcpMs: 300,
    hydrationReadyMs: 400,
    interactionMs: 50,
    jsBodyBytes: 1000,
    jsTransferBytes: 1100,
    htmlBytes: 900,
    jsRequests: 4,
    requestCount: 8,
    cls: 0,
    longTaskMs: 0,
  }));
test("comparison rejects missing, duplicate, invalid, mismatched and replaced-SSR samples", () => {
  assert.throws(() => compareSamples(samples(), samples().slice(1), expected), /Three distinct/);
  assert.throws(
    () => compareSamples(samples(), [samples()[0], samples()[0], samples()[1]], expected),
    /Three distinct/,
  );
  for (const change of [
    { lang: "en" },
    { cache: "HIT" },
    { sample: 4 },
    { hydrationReadyMs: null },
    { serverTitleRetained: false },
  ]) {
    const candidate = samples();
    Object.assign(candidate[0], change);
    assert.throws(() => compareSamples(samples(), candidate, expected));
  }
});
test("median ignores one outlier but catches a transfer regression", () => {
  const candidate = samples();
  candidate[0].jsBodyBytes = 10000;
  assert.ok(compareSamples(samples(), candidate, expected).every((row) => row.pass));
  candidate[1].jsBodyBytes = 1200;
  assert.equal(
    compareSamples(samples(), candidate, expected).find((row) => row.metric === "jsBodyBytes").pass,
    false,
  );
});

test("content-route hydration reads have explicit empty response shapes", async () => {
  for (const name of ["current_membership_tier", "get_related_posts_config"]) {
    assert.deepEqual(await (await rpc(name, {})).json(), []);
  }
  for (const name of ["metering_settings", "post_custom_meta_defs"]) {
    const url = `http://127.0.0.1:4199/rest/v1/${name}`;
    assert.deepEqual(await (await cmsFixtureResponse(new Request(url))).json(), []);
    assert.equal(
      await (
        await cmsFixtureResponse(
          new Request(url, { headers: { accept: "application/vnd.pgrst.object+json" } }),
        )
      ).json(),
      null,
    );
    await assert.rejects(
      cmsFixtureResponse(new Request(url, { method: "POST", body: "{}" })),
      /rejects database writes/,
    );
  }
});
