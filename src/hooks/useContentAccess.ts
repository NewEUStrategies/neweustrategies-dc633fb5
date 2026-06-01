import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AccessEntityType = "post" | "page" | "media";
export type AccessMode = "public" | "members" | "paid";

export interface ContentAccessRule {
  id: string;
  entity_type: AccessEntityType;
  entity_id: string;
  mode: AccessMode;
  plan_ids: string[];
  one_time_price_cents: number | null;
  one_time_currency: string | null;
  teaser_pl: string | null;
  teaser_en: string | null;
}

export interface AccessState {
  loading: boolean;
  rule: ContentAccessRule | null;
  hasAccess: boolean;
}

export function useContentAccess(
  entityType: AccessEntityType,
  entityId: string | null | undefined,
): AccessState {
  const { session } = useAuth();
  const [state, setState] = useState<AccessState>({ loading: true, rule: null, hasAccess: true });

  useEffect(() => {
    let cancelled = false;
    if (!entityId) {
      setState({ loading: false, rule: null, hasAccess: true });
      return;
    }
    (async () => {
      const { data: rule } = await supabase
        .from("content_access")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .maybeSingle();

      if (cancelled) return;

      if (!rule || rule.mode === "public") {
        setState({ loading: false, rule: (rule as ContentAccessRule) ?? null, hasAccess: true });
        return;
      }

      if (!session) {
        setState({ loading: false, rule: rule as ContentAccessRule, hasAccess: false });
        return;
      }

      const { data: ok } = await supabase.rpc("has_content_access", {
        _entity_type: entityType,
        _entity_id: entityId,
      });
      if (cancelled) return;
      setState({ loading: false, rule: rule as ContentAccessRule, hasAccess: !!ok });
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, session?.user?.id]);

  return state;
}

export interface AccessPlan {
  id: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  price_cents: number;
  currency: string;
  interval: "month" | "year" | "one_time";
  active: boolean;
  sort_order: number;
}

export function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
