import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const MIGRATION = "supabase/migrations/20260712140000_crm_secrets_vault_and_cv_bucket.sql";
const CRM_FNS = "src/lib/crm.functions.ts";
const PROFILE = "src/components/profile/sections/ProfileExtraSections.tsx";
const ADMIN = "src/routes/admin.crm.tsx";

describe("T1 migration — Vault + private cv bucket", () => {
  const sql = read(MIGRATION);

  it("enables the vault extension and adds secret-ref columns", () => {
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS supabase_vault");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS merydian_webhook_secret_id uuid");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS merydian_api_key_id uuid");
  });

  it("drops the plaintext secret columns", () => {
    expect(sql).toContain("DROP COLUMN IF EXISTS merydian_webhook_secret");
    expect(sql).toContain("DROP COLUMN IF EXISTS merydian_api_key");
  });

  it("backfills via vault.create_secret guarded by id-null / column existence", () => {
    expect(sql).toContain("vault.create_secret(r.wsec)");
    expect(sql).toContain("vault.create_secret(r.akey)");
    expect(sql).toMatch(/information_schema\.columns/);
  });

  it("locks the secret RPCs down to authenticated + service_role only", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.crm_set_merydian_secret(text, text) FROM PUBLIC, anon",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.crm_get_merydian_secrets(uuid) FROM PUBLIC, anon",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.crm_set_merydian_secret(text, text) TO authenticated, service_role",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.crm_get_merydian_secrets(uuid) TO authenticated, service_role",
    );
  });

  it("creates a PRIVATE cv bucket with a pdf/doc/docx allowlist", () => {
    expect(sql).toContain("'cv', 'cv', false, 10485760");
    expect(sql).toContain("application/pdf");
    expect(sql).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("scopes cv storage.objects RLS to the owner's own path", () => {
    for (const pol of ["cv owner read", "cv owner upload", "cv owner delete"]) {
      expect(sql).toContain(pol);
    }
    expect(sql).toContain("(storage.foldername(name))[3] = (SELECT auth.uid()::text)");
  });
});

describe("T1 server — secrets never stored/returned in plaintext columns", () => {
  const src = read(CRM_FNS);

  it("dispatch reads decrypted secrets via the RPC, not cfg columns", () => {
    expect(src).toContain('rpc("crm_get_merydian_secrets"');
    expect(src).not.toContain("cfg.merydian_webhook_secret");
    expect(src).not.toContain("cfg.merydian_api_key");
  });

  it("upsert strips secrets from the row and routes them to the RPC", () => {
    expect(src).toContain("const { merydian_webhook_secret, merydian_api_key, ...config } = data;");
    expect(src).toContain('rpc("crm_set_merydian_secret"');
  });

  it("getIntegrations exposes only presence booleans", () => {
    expect(src).toContain("has_webhook_secret: row.merydian_webhook_secret_id != null");
    expect(src).toContain("has_api_key: row.merydian_api_key_id != null");
  });
});

describe("T1 client — cv uses the private bucket + signed URLs", () => {
  it("profile CV uploads to the cv bucket and never uses getPublicUrl on media", () => {
    const src = read(PROFILE);
    expect(src).toContain('supabase.storage.from("cv").upload(');
    // Method chain formatting is prettier-controlled; assert the two anchors
    // independently rather than an exact newline layout.
    expect(src).toContain('.from("cv")');
    expect(src).toContain(".createSignedUrl(");
    expect(src).not.toContain('supabase.storage.from("media")');
    expect(src).toContain("file_url: path,");
  });

  it("admin secret inputs are write-only with a presence placeholder", () => {
    const src = read(ADMIN);
    expect(src).toContain("s.has_webhook_secret ? L.integ.secretSet");
    expect(src).toContain("s.has_api_key ? L.integ.secretSet");
    expect(src).toContain('secretSet: "•••• (ustawiony)"');
    expect(src).toContain('secretSet: "•••• (set)"');
  });
});
