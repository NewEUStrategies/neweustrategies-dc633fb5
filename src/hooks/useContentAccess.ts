import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AccessEntityType = "post" | "page" | "media";
export type AccessMode = "public" | "members" | "paid" | "password";

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
  /** Presence flag only. The hash itself is never selectable client-side (column privilege revoked). */
  has_password?: boolean;
  password_hint_pl?: string | null;
  password_hint_en?: string | null;
}

const CONTENT_ACCESS_SAFE_COLS =
  "id, entity_type, entity_id, mode, plan_ids, one_time_price_cents, one_time_currency, teaser_pl, teaser_en, password_hint_pl, password_hint_en, tenant_id";

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
        .select(CONTENT_ACCESS_SAFE_COLS)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .maybeSingle();

      if (cancelled) return;

      let ruleOut: ContentAccessRule | null = null;
      if (rule) {
        let has_password = false;
        if (rule.mode === "password") {
          const { data: hp } = await supabase.rpc("content_access_has_password", {
            _entity_type: entityType,
            _entity_id: entityId,
          });
          has_password = !!hp;
        }
        ruleOut = { ...(rule as ContentAccessRule), has_password };
      }

      if (!ruleOut || ruleOut.mode === "public") {
        setState({ loading: false, rule: ruleOut, hasAccess: true });
        return;
      }

      if (!session) {
        setState({ loading: false, rule: ruleOut, hasAccess: false });
        return;
      }

      const { data: ok } = await supabase.rpc("has_content_access", {
        _entity_type: entityType,
        _entity_id: entityId,
      });
      if (cancelled) return;
      setState({ loading: false, rule: ruleOut, hasAccess: !!ok });
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
  features_pl: string[];
  features_en: string[];
  badge_pl: string | null;
  badge_en: string | null;
  highlighted: boolean;
  trial_days: number;
}

export function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
