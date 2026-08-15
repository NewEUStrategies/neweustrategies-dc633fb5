// Zarządzanie wersjami dokumentów prawnych w panelu: lista, zapis szkicu,
// publikacja (atomowa, przez RPC) i usunięcie. Zapisy chroni RLS
// (administrator / edytor w obrębie tenanta).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { legalVersionQueryKey } from "./useLegalDocument";
import { toJson } from "@/lib/builder/types";
import {
  safeParseLegalContent,
  type LegalDocContent,
  type LegalDocKey,
  type LegalDocumentVersion,
  type LegalVersionStatus,
} from "./types";

const SELECT =
  "id, doc_key, label, status, content, note, effective_from, published_at, created_by, created_at, updated_at";

interface RawRow {
  id: string;
  doc_key: string;
  label: string;
  status: string;
  content: unknown;
  note: string | null;
  effective_from: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function toLegalVersion(row: RawRow): LegalDocumentVersion | null {
  const content = safeParseLegalContent(row.content);
  if (!content) return null;
  return {
    id: row.id,
    doc_key: row.doc_key as LegalDocKey,
    label: row.label,
    status: row.status as LegalVersionStatus,
    content,
    note: row.note,
    effective_from: row.effective_from,
    published_at: row.published_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const legalVersionsKey = (key: LegalDocKey) => ["admin", "legal-versions", key] as const;

export function useLegalVersions(docKey: LegalDocKey) {
  return useQuery({
    queryKey: legalVersionsKey(docKey),
    queryFn: async (): Promise<LegalDocumentVersion[]> => {
      const { data, error } = await supabase
        .from("legal_document_versions")
        .select(SELECT)
        .eq("doc_key", docKey)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as RawRow[])
        .map(toLegalVersion)
        .filter((v): v is LegalDocumentVersion => v !== null);
    },
  });
}

export interface CreateLegalVersionInput {
  docKey: LegalDocKey;
  label: string;
  note?: string | null;
  content: LegalDocContent;
}

export function useLegalVersionActions(docKey: LegalDocKey) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: legalVersionsKey(docKey) });
    void qc.invalidateQueries({ queryKey: legalVersionQueryKey(docKey) });
  };

  const create = useMutation({
    mutationFn: async (input: CreateLegalVersionInput) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("legal_document_versions").insert({
        doc_key: input.docKey,
        label: input.label,
        note: input.note ?? null,
        content: toJson(input.content),
        created_by: auth.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const publish = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("publish_legal_version", { _id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const unpublish = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("legal_document_versions")
        .update({ status: "archived" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("legal_document_versions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, publish, unpublish, remove };
}
