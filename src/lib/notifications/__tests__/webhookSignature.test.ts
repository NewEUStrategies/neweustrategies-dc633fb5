import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhookBody, verifyWebhookSignature } from "../webhookSignature";

const SECRET = "whsec_test";
const BODY = '{"id":"n-1"}';

describe("podpis webhooka", () => {
  it("zgodny z HMAC-SHA256 nad `t.body`", async () => {
    const header = await signWebhookBody(SECRET, BODY, 1_790_000_000);
    const expected = createHmac("sha256", SECRET).update(`1790000000.${BODY}`).digest("hex");
    expect(header).toBe(`t=1790000000,v1=${expected}`);
  });

  it("weryfikuje poprawny podpis i odrzuca zmienione ciało", async () => {
    const header = await signWebhookBody(SECRET, BODY, 1_790_000_000);
    await expect(
      verifyWebhookSignature({ secret: SECRET, body: BODY, header, nowSec: 1_790_000_010 }),
    ).resolves.toBe(true);
    await expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: '{"id":"n-2"}',
        header,
        nowSec: 1_790_000_010,
      }),
    ).resolves.toBe(false);
  });

  it("odrzuca znacznik starszy niż 5 minut", async () => {
    const header = await signWebhookBody(SECRET, BODY, 1_790_000_000);
    await expect(
      verifyWebhookSignature({ secret: SECRET, body: BODY, header, nowSec: 1_790_000_301 }),
    ).resolves.toBe(false);
  });
});
