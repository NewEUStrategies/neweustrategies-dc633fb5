import type { DbObject } from "./dbContract";

type ProbeConfig = { url: string; key: string };
const BATCH = 40;

/** Bounded, read-only requests. Never follow a redirect carrying credentials. */
export async function readDeploymentRpc(
  config: ProbeConfig,
  name: "missing_schema_objects" | "missing_migration_versions",
  args: Record<string, string>,
  request: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<unknown> {
  const target = new URL(`/rest/v1/rpc/${name}`, config.url);
  for (const [key, value] of Object.entries(args)) target.searchParams.set(key, value);
  const response = await request(target, {
    method: "GET",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Accept: "application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Deployment probe ${name}: HTTP ${response.status}`);
  return response.json();
}

export async function probeSchemaObjects(
  objects: readonly DbObject[],
  config: ProbeConfig,
  request: typeof fetch = fetch,
): Promise<DbObject[]> {
  const missing: DbObject[] = [];
  for (let i = 0; i < objects.length; i += BATCH) {
    const batch = objects.slice(i, i + BATCH);
    const parsed = await readDeploymentRpc(
      config,
      "missing_schema_objects",
      {
        _objects: JSON.stringify(batch.map(({ kind, name }) => ({ kind, name }))),
      },
      request,
    );
    if (!Array.isArray(parsed)) throw new Error("Schema probe: expected an array");
    const requested = new Map(batch.map((object) => [`${object.kind}:${object.name}`, object]));
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") throw new Error("Schema probe: invalid object");
      const key = `${item.kind}:${item.name}`;
      const object = requested.get(key);
      if (!object || seen.has(key)) throw new Error("Schema probe: unexpected or duplicate object");
      seen.add(key);
      missing.push(object);
    }
  }
  return missing;
}

export async function probeMigrationVersions(
  versions: readonly string[],
  config: ProbeConfig,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const missing: string[] = [];
  for (let i = 0; i < versions.length; i += BATCH) {
    const batch = versions.slice(i, i + BATCH);
    // PostgREST array parameters use PostgreSQL array literals for GET.
    const parsed = await readDeploymentRpc(
      config,
      "missing_migration_versions",
      {
        _versions: `{${batch.join(",")}}`,
      },
      request,
    );
    if (
      !Array.isArray(parsed) ||
      parsed.some((v) => typeof v !== "string" || !batch.includes(v)) ||
      new Set(parsed).size !== parsed.length
    ) {
      throw new Error("Migration probe: expected a unique subset of requested versions");
    }
    missing.push(...parsed);
  }
  return missing;
}
