import { afterEach, describe, expect, it, vi } from "vitest";
import { probeMigrationVersions, probeSchemaObjects, readDeploymentRpc } from "../deploymentProbe";

const config = { url: "https://db.example.test", key: "private-fixture-key" };
const object = { kind: "function" as const, name: "dangerous_default_rpc", file: "001.sql" };
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

describe("deployment metadata probes", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("checks a large schema in bounded batches without invoking application endpoints", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([{ kind: "function", name: object.name }]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([]));
    const objects = [
      object,
      ...Array.from({ length: 80 }, (_, i) => ({ ...object, name: `fn_${i}` })),
    ];
    expect(await probeSchemaObjects(objects, config, request)).toEqual([object]);
    expect(request).toHaveBeenCalledTimes(3);
    for (const [target, init] of request.mock.calls) {
      const url = new URL(String(target));
      expect(url.pathname).toBe("/rest/v1/rpc/missing_schema_objects");
      expect(JSON.parse(url.searchParams.get("_objects")!).length).toBeLessThanOrEqual(40);
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        headers: { apikey: config.key },
      });
      expect(init?.body).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it.each(
    [
      null,
      {},
      [null],
      ["bad"],
      [{ kind: "function", name: "unrequested" }],
      [
        { kind: object.kind, name: object.name },
        { kind: object.kind, name: object.name },
      ],
    ].map((response) => [response]),
  )("rejects an invalid schema response %j", async (response) => {
    await expect(
      probeSchemaObjects([object], config, vi.fn().mockResolvedValue(json(response))),
    ).rejects.toThrow("Schema probe:");
  });
  it("validates every ledger batch and uses PostgreSQL array syntax", async () => {
    const versions = Array.from({ length: 41 }, (_, i) => String(20260912000000 + i));
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([versions[0]]))
      .mockResolvedValueOnce(json([versions[40]]));
    expect(await probeMigrationVersions(versions, config, request)).toEqual([
      versions[0],
      versions[40],
    ]);
    expect(new URL(String(request.mock.calls[0][0])).searchParams.get("_versions")).toBe(
      `{${versions.slice(0, 40).join(",")}}`,
    );
  });
  it.each(
    [null, {}, [12], ["unrequested"], ["20260912000000", "20260912000000"]].map((response) => [
      response,
    ]),
  )("rejects an invalid ledger response %j", async (response) => {
    await expect(
      probeMigrationVersions(["20260912000000"], config, vi.fn().mockResolvedValue(json(response))),
    ).rejects.toThrow("unique subset");
  });
  it("propagates HTTP, network and malformed JSON failures instead of treating them as existence", async () => {
    await expect(
      readDeploymentRpc(
        config,
        "missing_schema_objects",
        {},
        vi.fn().mockResolvedValue(new Response("denied", { status: 401 })),
      ),
    ).rejects.toThrow("HTTP 401");
    await expect(
      readDeploymentRpc(
        config,
        "missing_schema_objects",
        {},
        vi.fn().mockRejectedValue(new Error("offline")),
      ),
    ).rejects.toThrow("offline");
    await expect(
      readDeploymentRpc(
        config,
        "missing_schema_objects",
        {},
        vi.fn().mockResolvedValue(new Response("broken JSON")),
      ),
    ).rejects.toThrow();
  });
  it("aborts a stalled response using the request deadline", async () => {
    const request: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("deadline")), {
          once: true,
        });
      });
    await expect(
      readDeploymentRpc(config, "missing_schema_objects", {}, request, 1),
    ).rejects.toThrow("deadline");
  });
  it("uses the runtime fetch implementation when no transport is injected", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => json([]));
    vi.stubGlobal("fetch", request);
    expect(await probeSchemaObjects([object], config)).toEqual([]);
    expect(await probeMigrationVersions(["20260912000000"], config)).toEqual([]);
    expect(await readDeploymentRpc(config, "missing_schema_objects", {})).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("does not send empty requests", async () => {
    const request = vi.fn<typeof fetch>();
    expect(await probeSchemaObjects([], config, request)).toEqual([]);
    expect(await probeMigrationVersions([], config, request)).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
