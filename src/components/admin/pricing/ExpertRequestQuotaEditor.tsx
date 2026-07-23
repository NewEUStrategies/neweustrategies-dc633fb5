// Edytor liczbowej puli „Zapytań do eksperta" (membership_tiers.features
// .expert_request_quota) - dedykowana kontrolka obok TierFeatureTogglesEditor.
// Edytuje ten sam string-draft co pole surowego JSON-a (reszta flag przechodzi
// nietknięta), więc panel, cennik i bramka send_expert_request są zawsze zgodne.
// Gdy warstwa ma chat_direct_gated (pisanie wprost, np. VIP), liczba nie ma
// zastosowania - pokazujemy „bezpośrednio, bez limitu".
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ensureI18n as ensureAdminMembershipI18n } from "@/lib/i18n-admin-membership";

function parseDraft(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readQuota(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function ExpertRequestQuotaEditor({
  value,
  onChange,
  disabled,
}: {
  /** Draft pola features jako string JSON (współdzielony z polem surowym). */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  ensureAdminMembershipI18n();
  const { t } = useTranslation();
  const flags = useMemo(() => parseDraft(value), [value]);
  const direct = flags.chat_direct_gated === true;
  const quota = readQuota(flags.expert_request_quota);

  const setQuota = (next: number) => {
    const draft: Record<string, unknown> = { ...flags };
    if (!Number.isFinite(next) || next <= 0) delete draft.expert_request_quota;
    else draft.expert_request_quota = Math.min(Math.floor(next), 999);
    onChange(JSON.stringify(draft));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor="expert-request-quota">
        {t("adminMembership.expertRequest.label")}
      </Label>
      {direct ? (
        <p className="rounded-[6px] border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
          {t("adminMembership.expertRequest.directNote")}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id="expert-request-quota"
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            step={1}
            disabled={disabled}
            value={quota === 0 ? "" : String(quota)}
            placeholder="0"
            onChange={(e) => setQuota(Number(e.target.value))}
            className="h-9 w-24 text-sm"
          />
          <span className="text-[11px] text-muted-foreground">
            {t("adminMembership.expertRequest.unit")}
          </span>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t("adminMembership.expertRequest.hint")}
      </p>
    </div>
  );
}
