// Panel biblioteki materiałów członkowskich — warstwa danych (staff).
// Metadane w member_resources (RLS "*_staff_*"); pliki w prywatnym buckecie
// 'member-resources' (staff insert/delete). Publiczne pobranie idzie przez
// server fn downloadMemberResource (bramka rangi + podpisany URL).
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type MemberResourceRow = Database["public"]["Tables"]["member_resources"]["Row"];
export type ResourceCategory = "report" | "brief" | "transcript" | "slides" | "data" | "other";

export const RESOURCE_BUCKET = "member-resources";

export async function fetchAdminResources(): Promise<MemberResourceRow[]> {
  const { data, error } = await supabase
    .from("member_resources")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

/** Upload pliku do prywatnego bucketu; zwraca ścieżkę obiektu (file_path).
 *  Ścieżka MUSI zaczynać się od tenant_id, żeby RLS na storage.objects
 *  ('member resources staff *') odrzuciło dostęp międzytenantowy. */
export async function uploadResourceFile(file: File): Promise<{ path: string; size: number }> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? "anon";
  if (uid === "anon") throw new Error("Not authenticated");
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", uid)
    .maybeSingle();
  if (profileError) throw profileError;
  const tenantId = profile?.tenant_id;
  if (!tenantId) throw new Error("Missing tenant for current user");
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
  // Prefiks: <tenant_id>/<user_id>/<timestamp>-<nazwa> - unika kolizji + spina RLS.
  const path = `${tenantId}/${uid}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(RESOURCE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return { path, size: file.size };
}

export interface ResourceInput {
  title_pl: string;
  title_en: string;
  description_pl: string | null;
  description_en: string | null;
  category: ResourceCategory;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  min_tier_rank: number;
  published: boolean;
  sort_order: number;
}

export async function createResource(input: ResourceInput): Promise<MemberResourceRow> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("member_resources")
    .insert({ ...input, created_by: auth.user?.id ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateResource(
  id: string,
  patch: Partial<Database["public"]["Tables"]["member_resources"]["Update"]>,
): Promise<void> {
  const { error } = await supabase.from("member_resources").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteResource(id: string, filePath: string | null): Promise<void> {
  // Najpierw obiekt storage (best-effort), potem wiersz metadanych.
  if (filePath) {
    await supabase.storage.from(RESOURCE_BUCKET).remove([filePath]);
  }
  const { error } = await supabase.from("member_resources").delete().eq("id", id);
  if (error) throw error;
}
