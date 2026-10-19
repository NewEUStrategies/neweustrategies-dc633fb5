// Section template store (saves/loads SectionNode blueprints to Supabase).
// Now with revision history per template (auto-snapshotted by DB trigger).
//
// Kontrakt danych (NAPRAWIONE 2026-10-18):
// * Każda kwerenda i każdy zapis zawęża po `tenant_id` z sesji
//   (`useCurrentTenantId`, ta sama droga co `useGlobalWidgets`), nigdy
//   z ładunku. Dopóki najemca jest nieznany, nic nie leci do bazy.
// * Odmowa odczytu jest stanem `error`, a nie pustą listą; nieudany zapis
//   zwraca `null`/`false`, a nie `undefined` nieodróżnialne od sukcesu.
// * Listy pobierają o JEDEN wiersz więcej niż pokazują - `truncated` mówi
//   widokowi, że to nie jest cała biblioteka (historia).
// * Spóźniona odpowiedź poprzedniego zapytania jest odrzucana (pokolenie
//   zapytania), więc zamknięty albo przełączony szablon nie wraca na ekran.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTenantId } from "@/lib/tenant";
import type { Json } from "@/integrations/supabase/types";
import type { SectionNode } from "./types";
import { cloneSection } from "./operations";

/** Ile szablonów pokazuje biblioteka (pobieramy o jeden więcej, by wykryć obcięcie). */
export const SECTION_TEMPLATES_LIMIT = 100;
/** Ile rewizji pokazuje historia szablonu (pobieramy o jedną więcej). */
export const TEMPLATE_REVISIONS_LIMIT = 50;

export interface SectionTemplate {
  id: string;
  name: string;
  data: SectionNode;
  created_at: string;
  created_by: string | null;
}

export interface TemplateRevision {
  id: string;
  template_id: string;
  name: string;
  data: SectionNode;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

interface RawRow {
  id: string;
  name: string;
  data: unknown;
  created_at: string;
  created_by: string | null;
}

interface RawRevRow {
  id: string;
  template_id: string;
  name: string;
  data: unknown;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

const toTemplate = (r: RawRow): SectionTemplate | null => {
  const d = r.data as SectionNode | undefined;
  if (!d || typeof d !== "object" || d.kind !== "section") return null;
  return { id: r.id, name: r.name, data: d, created_at: r.created_at, created_by: r.created_by };
};

const toRevision = (r: RawRevRow): TemplateRevision | null => {
  const d = r.data as SectionNode | undefined;
  if (!d || typeof d !== "object" || d.kind !== "section") return null;
  return {
    id: r.id,
    template_id: r.template_id,
    name: r.name,
    data: d,
    note: r.note,
    created_at: r.created_at,
    created_by: r.created_by,
  };
};

/** Komunikat błędu PostgREST - nigdy pusty, żeby `error` zawsze był prawdziwy. */
function readErrorMessage(e: { message?: string | null }): string {
  return e.message?.trim() || "read failed";
}

/** Sekcja jako czysty JSON kolumny `data` - świeże id na każdym piętrze. */
function sectionToJson(section: SectionNode): Json {
  return JSON.parse(JSON.stringify(cloneSection(section))) as Json;
}

export function useSectionTemplates() {
  const tenantId = useCurrentTenantId();
  const [items, setItems] = useState<SectionTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Pokolenie zapytania: odpowiedź starszego `reload` (np. po przełączeniu
  // najemcy albo nałożeniu się przeładowania po zapisie) nie nadpisze nowszej.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const run = ++generation.current;
    if (!tenantId) {
      setItems([]);
      setError(null);
      setTruncated(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: readError } = await supabase
      .from("builder_templates")
      .select("id, name, data, created_at, created_by")
      .eq("scope", "section")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(SECTION_TEMPLATES_LIMIT + 1);
    if (run !== generation.current) return;
    if (readError) {
      setItems([]);
      setTruncated(false);
      setError(readErrorMessage(readError));
    } else {
      const rows = (data ?? []) as RawRow[];
      setTruncated(rows.length > SECTION_TEMPLATES_LIMIT);
      setItems(
        rows
          .slice(0, SECTION_TEMPLATES_LIMIT)
          .map(toTemplate)
          .filter((x): x is SectionTemplate => !!x),
      );
      setError(null);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Id nowego szablonu albo `null`, gdy zapis się nie udał (lub najemca nieznany). */
  const save = useCallback(
    async (name: string, section: SectionNode): Promise<string | null> => {
      if (!tenantId) return null;
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id ?? null;
      const { data, error: writeError } = await supabase
        .from("builder_templates")
        .insert({
          tenant_id: tenantId,
          name,
          scope: "section",
          data: sectionToJson(section), // fresh ids
          created_by: uid,
        })
        .select("id")
        .single();
      if (writeError || !data) return null;
      await reload();
      return data.id;
    },
    [reload, tenantId],
  );

  /**
   * `true`, gdy stan w bazie odpowiada żądaniu. Pusty patch niczego nie
   * zapisuje i nie przeładowuje listy - nie ma czego odrzucić, więc `true`.
   */
  const update = useCallback(
    async (id: string, opts: { name?: string; section?: SectionNode }): Promise<boolean> => {
      const patch: { name?: string; data?: Json } = {};
      if (opts.name !== undefined) patch.name = opts.name;
      if (opts.section) patch.data = sectionToJson(opts.section);
      if (Object.keys(patch).length === 0) return true;
      if (!tenantId) return false;
      const { error: writeError } = await supabase
        .from("builder_templates")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (writeError) return false;
      await reload();
      return true;
    },
    [reload, tenantId],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!tenantId) return false;
      const { error: writeError } = await supabase
        .from("builder_templates")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (writeError) return false;
      await reload();
      return true;
    },
    [reload, tenantId],
  );

  return useMemo(
    () => ({ items, loading, error, truncated, reload, save, update, remove }),
    [items, loading, error, truncated, reload, save, update, remove],
  );
}

// Revision history (separate hook, lazy on demand).
export function useTemplateRevisions(templateId: string | null) {
  const tenantId = useCurrentTenantId();
  const [items, setItems] = useState<TemplateRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Zamknięcie dialogu (`templateId` -> null) albo przełączenie szablonu
  // podbija pokolenie, więc odpowiedź dla poprzedniego szablonu przepada.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const run = ++generation.current;
    if (!templateId || !tenantId) {
      setItems([]);
      setError(null);
      setTruncated(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: readError } = await supabase
      .from("builder_template_revisions")
      .select("id, template_id, name, data, note, created_at, created_by")
      .eq("template_id", templateId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(TEMPLATE_REVISIONS_LIMIT + 1);
    if (run !== generation.current) return;
    if (readError) {
      setItems([]);
      setTruncated(false);
      setError(readErrorMessage(readError));
    } else {
      const rows = (data ?? []) as RawRevRow[];
      setTruncated(rows.length > TEMPLATE_REVISIONS_LIMIT);
      setItems(
        rows
          .slice(0, TEMPLATE_REVISIONS_LIMIT)
          .map(toRevision)
          .filter((x): x is TemplateRevision => !!x),
      );
      setError(null);
    }
    setLoading(false);
  }, [templateId, tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return useMemo(
    () => ({ items, loading, error, truncated, reload }),
    [items, loading, error, truncated, reload],
  );
}
