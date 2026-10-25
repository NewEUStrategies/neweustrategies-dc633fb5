import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeploymentProbeHttpError,
  isMissingRpc,
  probeDrizzleMigrationHashes,
  probeDrizzleRegistry,
  probeMigrationVersions,
  probeSchemaColumns,
  probeSchemaObjects,
  readDeploymentRpc,
} from "../deploymentProbe";

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
  it("checks columns in bounded batches and returns only requested missing columns", async () => {
    const column = { table: "podcasts", column: "explicit", file: "20260725090500.sql" };
    const columns = [
      column,
      ...Array.from({ length: 45 }, (_, i) => ({ ...column, column: `col_${i}` })),
    ];
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([{ table: "podcasts", column: "explicit" }]))
      .mockResolvedValueOnce(json([]));
    expect(await probeSchemaColumns(columns, config, request)).toEqual([column]);
    expect(request).toHaveBeenCalledTimes(2);
    for (const [target, init] of request.mock.calls) {
      const url = new URL(String(target));
      expect(url.pathname).toBe("/rest/v1/rpc/missing_schema_columns");
      const sent = JSON.parse(url.searchParams.get("_columns")!);
      expect(sent.length).toBeLessThanOrEqual(40);
      // Plik migracji zostaje po stronie CI - baza dostaje tylko parę nazw.
      expect(Object.keys(sent[0]).sort()).toEqual(["column", "table"]);
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      expect(init?.body).toBeUndefined();
    }
  });
  it.each(
    [
      null,
      {},
      [null],
      [{ table: "podcasts", column: "unrequested" }],
      [
        { table: "podcasts", column: "explicit" },
        { table: "podcasts", column: "explicit" },
      ],
    ].map((response) => [response]),
  )("rejects an invalid column response %j", async (response) => {
    const column = { table: "podcasts", column: "explicit", file: "001.sql" };
    await expect(
      probeSchemaColumns([column], config, vi.fn().mockResolvedValue(json(response))),
    ).rejects.toThrow("Column probe:");
  });
  it("does not send an empty column request", async () => {
    const request = vi.fn<typeof fetch>();
    expect(await probeSchemaColumns([], config, request)).toEqual([]);
    expect(request).not.toHaveBeenCalled();
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

// ── Rejestr migratora Drizzle (`missing_drizzle_migration_hashes`) ──
// Dowód wdrożenia plików z lustrem (wpisy dziennika od 0399): para `when` wpisu
// i sha256 jego pliku, jak `created_at` i `hash` w `drizzle.__drizzle_migrations`
// (to samo dopasowanie co `migrations:deploy-sql -- --verify`). Odpowiedź spoza
// pytania, duplikat albo nie-para to błąd sondy, a brak SAMEJ funkcji na bazie
// (partia z 20261025090040 niewdrożona) - osobny werdykt, nie zielone przejście.
const hash = (n: number): string => n.toString(16).padStart(64, "0");
const entry = (n: number): string => `${1_792_790_186_300 + n}:${hash(n)}`;
const postgrestError = (status: number, code: string): Response =>
  new Response(JSON.stringify({ code, message: "x", details: null, hint: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("drizzle registry probe", () => {
  it("asks the literal RPC in bounded batches with PostgreSQL array syntax and returns only requested entries", async () => {
    const entries = Array.from({ length: 41 }, (_, i) => entry(i + 1));
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([entries[3]]))
      .mockResolvedValueOnce(json([entries[40]]));
    expect(await probeDrizzleMigrationHashes(entries, config, request)).toEqual([
      entries[3],
      entries[40],
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    const [first, second] = request.mock.calls.map(([target]) => new URL(String(target)));
    expect(first!.pathname).toBe("/rest/v1/rpc/missing_drizzle_migration_hashes");
    expect(first!.searchParams.get("_entries")).toBe(`{${entries.slice(0, 40).join(",")}}`);
    expect(second!.searchParams.get("_entries")).toBe(`{${entries[40]}}`);
    expect(first!.searchParams.has("_hashes")).toBe(false);
    for (const [, init] of request.mock.calls) {
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      expect(init?.body).toBeUndefined();
    }
  });

  it.each(
    [
      null,
      {},
      [12],
      [entry(99)],
      [entry(1), entry(1)],
      ["not-an-entry"],
      // Sam hash pytanej pary albo ten hash pod innym `when` - to nie jest pytany wpis.
      [hash(1)],
      [`${1_792_790_186_300 + 2}:${hash(1)}`],
    ].map((response) => [response]),
  )("rejects an invalid registry response %j", async (response) => {
    await expect(
      probeDrizzleMigrationHashes([entry(1)], config, vi.fn().mockResolvedValue(json(response))),
    ).rejects.toThrow("Drizzle registry probe: expected a unique subset of requested entries");
  });

  it.each([
    ["ABC"],
    // Sam hash bez `when` (dawny kontrakt) - rejestr dopasowuje parę, nie hash.
    [hash(1)],
    [`1792790186300:${hash(0xabcdef).toUpperCase()}`],
    [`01792790186300:${hash(1)}`],
    [`${"1".repeat(17)}:${hash(1)}`],
    [`-1:${hash(1)}`],
    [`1792790186300:${hash(1)}:x`],
    [`${entry(1)},${entry(2)}`],
    [""],
  ])(
    "refuses to send %j - only <when>:<64 lowercase hex> reaches the array literal",
    async (bad) => {
      const request = vi.fn<typeof fetch>();
      await expect(probeDrizzleMigrationHashes([bad], config, request)).rejects.toThrow(
        "Drizzle registry probe: invalid entry",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("does not send an empty registry request", async () => {
    const request = vi.fn<typeof fetch>();
    expect(await probeDrizzleMigrationHashes([], config, request)).toEqual([]);
    expect(await probeDrizzleRegistry([], config, request)).toEqual({
      kind: "answered",
      missingEntries: [],
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("an HTTP failure carries the status and the PostgREST error code", async () => {
    const error = await readDeploymentRpc(
      config,
      "missing_drizzle_migration_hashes",
      {},
      vi.fn().mockResolvedValue(postgrestError(404, "PGRST202")),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeploymentProbeHttpError);
    expect(error).toMatchObject({ status: 404, code: "PGRST202" });
    expect((error as Error).message).toBe(
      "Deployment probe missing_drizzle_migration_hashes: HTTP 404 (PGRST202)",
    );
    // Treść spoza kontraktu PostgREST nie trafia do komunikatu.
    const odd = await readDeploymentRpc(
      config,
      "missing_drizzle_migration_hashes",
      {},
      vi.fn().mockResolvedValue(postgrestError(500, "x\n::error::injected")),
    ).catch((e: unknown) => e);
    expect(odd).toMatchObject({ status: 500, code: null });
  });

  it.each([
    [postgrestError(404, "PGRST202")],
    [postgrestError(400, "PGRST202")],
    [postgrestError(404, "PGRST999")],
    [new Response("not found", { status: 404 })],
    [postgrestError(400, "42883")],
  ])("a missing probe function (%#) is a verdict, not a crash", async (response) => {
    expect(
      await probeDrizzleRegistry([entry(1)], config, vi.fn().mockResolvedValue(response)),
    ).toEqual({
      kind: "probe-missing",
      detail: expect.stringContaining("Deployment probe missing_drizzle_migration_hashes: HTTP"),
    });
  });

  it("other failures (auth, server, network, bad answer) are rethrown - never a pass", async () => {
    for (const request of [
      vi.fn().mockResolvedValue(postgrestError(401, "PGRST301")),
      vi.fn().mockResolvedValue(postgrestError(500, "XX000")),
      vi.fn().mockRejectedValue(new Error("offline")),
      vi.fn().mockResolvedValue(json([entry(2)])),
    ]) {
      await expect(probeDrizzleRegistry([entry(1)], config, request)).rejects.toThrow();
    }
  });

  it("answers with the subset reported by the registry", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json([entry(2)]));
    expect(await probeDrizzleRegistry([entry(1), entry(2)], config, request)).toEqual({
      kind: "answered",
      missingEntries: [entry(2)],
    });
  });

  it("isMissingRpc recognises only a missing function", () => {
    expect(
      isMissingRpc(new DeploymentProbeHttpError("missing_migration_versions", 404, null)),
    ).toBe(true);
    expect(
      isMissingRpc(new DeploymentProbeHttpError("missing_migration_versions", 400, "PGRST202")),
    ).toBe(true);
    expect(
      isMissingRpc(new DeploymentProbeHttpError("missing_migration_versions", 401, null)),
    ).toBe(false);
    expect(isMissingRpc(new Error("HTTP 404"))).toBe(false);
  });
});
