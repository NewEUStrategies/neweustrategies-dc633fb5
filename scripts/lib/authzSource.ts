/**
 * Wejscie I/O dla analizy bramek autoryzacji (src/lib/ci/authzGates.ts jest czysty).
 *
 * Czyta forward-only migracje raz i podaje je w dwoch postaciach:
 *   - `functions`  - STAN KONCOWY kazdej funkcji (ostatnie CREATE OR REPLACE),
 *   - `migrations` - pelny SQL bez komentarzy (polityki RLS, CREATE TYPE, DDL).
 *
 * Uzywane przez scripts/generate-authz-snapshot.ts oraz przez bramke parytetu
 * (src/lib/authz/__tests__/authzSnapshotParity.test.ts), zeby generator i test
 * odtwarzaly snapshot DOKLADNIE tak samo - inaczej "drift" bylby artefaktem
 * dwoch roznych parserow, a nie realna zmiana w bazie.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthzGateSource } from "../../src/lib/ci/authzGates";
import { MIGRATIONS_DIR, extractLatestDefinitions, stripSqlComments } from "./sqlMigrations";

export function readAuthzSource(): AuthzGateSource {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));

  const functions = [...extractLatestDefinitions().values()]
    .map((def) => ({
      key: def.key,
      name: def.name,
      file: def.file,
      body: def.body,
      attrs: def.attrs,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { functions, migrations };
}
