import type { DbColumn, DbObject } from "./dbContract";
import type { DrizzleRegistryAnswer } from "./migrationLedger";

type ProbeConfig = { url: string; key: string };
const BATCH = 40;

/** Literal names of the read-only deployment RPCs (AGENTS.md: literal RPC names). */
type DeploymentRpc =
  | "missing_schema_objects"
  | "missing_schema_columns"
  | "missing_migration_versions"
  | "missing_drizzle_migration_hashes";

/** PostgREST error codes are short identifiers; anything else stays out of the log line. */
const ERROR_CODE_RE = /^[A-Z0-9]{5,8}$/;

/**
 * Non-2xx answer of a deployment RPC. `code` is the PostgREST/PostgreSQL error code
 * from the JSON body (`PGRST202`, `42883`, ...) or `null` when the body has none.
 */
export class DeploymentProbeHttpError extends Error {
  readonly rpc: string;
  readonly status: number;
  readonly code: string | null;

  constructor(rpc: string, status: number, code: string | null) {
    super(`Deployment probe ${rpc}: HTTP ${status}${code === null ? "" : ` (${code})`}`);
    this.name = "DeploymentProbeHttpError";
    this.rpc = rpc;
    this.status = status;
    this.code = code;
  }
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    const code =
      typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
    return typeof code === "string" && ERROR_CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * The RPC itself does not exist on the database: PostgREST answers 404 (`PGRST202`,
 * function not in the schema cache) or the database raises 42883 (undefined function).
 */
export function isMissingRpc(error: unknown): boolean {
  return (
    error instanceof DeploymentProbeHttpError &&
    (error.status === 404 || error.code === "PGRST202" || error.code === "42883")
  );
}

/** Bounded, read-only requests. Never follow a redirect carrying credentials. */
export async function readDeploymentRpc(
  config: ProbeConfig,
  name: DeploymentRpc,
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
  if (!response.ok) {
    throw new DeploymentProbeHttpError(name, response.status, await errorCode(response));
  }
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

/**
 * Kolumny, których baza nie ma - przez `missing_schema_columns` (wyłącznie
 * katalog, zwraca podzbiór pytania). Odpowiedź spoza pytania albo z
 * duplikatem to błąd sondy, nie werdykt o schemacie.
 */
export async function probeSchemaColumns(
  columns: readonly DbColumn[],
  config: ProbeConfig,
  request: typeof fetch = fetch,
): Promise<DbColumn[]> {
  const missing: DbColumn[] = [];
  for (let i = 0; i < columns.length; i += BATCH) {
    const batch = columns.slice(i, i + BATCH);
    const parsed = await readDeploymentRpc(
      config,
      "missing_schema_columns",
      {
        _columns: JSON.stringify(batch.map(({ table, column }) => ({ table, column }))),
      },
      request,
    );
    if (!Array.isArray(parsed)) throw new Error("Column probe: expected an array");
    const requested = new Map(batch.map((c) => [`${c.table}.${c.column}`, c]));
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") throw new Error("Column probe: invalid column");
      const key = `${item.table}.${item.column}`;
      const column = requested.get(key);
      if (!column || seen.has(key)) throw new Error("Column probe: unexpected or duplicate column");
      seen.add(key);
      missing.push(column);
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

/**
 * Key of one drizzle journal entry as the migrator records it: `<when>:<sha256>` -
 * `created_at` (decimal, no leading zero, at most 16 digits so it fits bigint) and
 * `hash` (sha256 hex of the entry file) of `drizzle.__drizzle_migrations`. Same
 * pattern as the SQL probe validates.
 */
const REGISTRY_KEY_RE = /^(0|[1-9][0-9]{0,15}):[0-9a-f]{64}$/;

/**
 * Registry keys (`<when>:<sha256>`, see `drizzleRegistryKey`) whose pair
 * (`created_at`, `hash`) `drizzle.__drizzle_migrations` does not contain - the
 * same match as `migrations:deploy-sql -- --verify` - through
 * `missing_drizzle_migration_hashes`, which answers only about the keys it is
 * given. Every key is checked before it is put into the PostgreSQL array literal;
 * an answer outside the question or with a duplicate is a probe error.
 */
export async function probeDrizzleMigrationHashes(
  entries: readonly string[],
  config: ProbeConfig,
  request: typeof fetch = fetch,
): Promise<string[]> {
  if (entries.some((key) => !REGISTRY_KEY_RE.test(key))) {
    throw new Error(
      "Drizzle registry probe: invalid entry (expected <when>:<64 lowercase hex characters>)",
    );
  }
  const missing: string[] = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const parsed = await readDeploymentRpc(
      config,
      "missing_drizzle_migration_hashes",
      { _entries: `{${batch.join(",")}}` },
      request,
    );
    if (
      !Array.isArray(parsed) ||
      parsed.some((key) => typeof key !== "string" || !batch.includes(key)) ||
      new Set(parsed).size !== parsed.length
    ) {
      throw new Error("Drizzle registry probe: expected a unique subset of requested entries");
    }
    missing.push(...parsed);
  }
  return missing;
}

/**
 * Verdict of the drizzle registry for `check:migration-ledger`: the missing entry
 * keys, or `probe-missing` when the probe function itself is not on the database
 * (the batch carrying it is not deployed). Every other failure is rethrown.
 */
export async function probeDrizzleRegistry(
  entries: readonly string[],
  config: ProbeConfig,
  request: typeof fetch = fetch,
): Promise<DrizzleRegistryAnswer> {
  try {
    return {
      kind: "answered",
      missingEntries: await probeDrizzleMigrationHashes(entries, config, request),
    };
  } catch (error) {
    if (isMissingRpc(error)) {
      return { kind: "probe-missing", detail: (error as DeploymentProbeHttpError).message };
    }
    throw error;
  }
}
