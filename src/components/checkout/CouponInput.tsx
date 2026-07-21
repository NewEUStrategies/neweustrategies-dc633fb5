// Widget wpisania kodu kuponu B2B na stronie checkout. Waliduje live przez
// validate_b2b_coupon (RPC), pokazuje kwotę rabatu i zwraca kod + rabat do
// rodzica, który dopnie je do createCheckoutOrder. Serwer i tak re-waliduje.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgePercent, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/billing/types";
import { useValidateCoupon } from "@/hooks/useValidateCoupon";
import {
  COUPON_ERROR_I18N_KEY,
  formatDiscountLabel,
  normalizeCouponCode,
  type ValidateCouponResult,
} from "@/lib/billing/coupons";

interface Props {
  planId: string | null;
  amountCents: number;
  currency: string;
  onChange: (payload: { code: string; result: ValidateCouponResult } | null) => void;
}

export function CouponInput({ planId, amountCents, currency, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<{ code: string; result: ValidateCouponResult } | null>(
    null,
  );
  const { validate, loading } = useValidateCoupon({ planId, amountCents, currency });

  const apply = async () => {
    const norm = normalizeCouponCode(code);
    if (!norm) return;
    const result = await validate(norm);
    if (result?.ok) {
      const payload = { code: norm, result };
      setApplied(payload);
      onChange(payload);
    } else {
      setApplied({ code: norm, result: result! });
      onChange(null);
    }
  };

  const clear = () => {
    setApplied(null);
    setCode("");
    onChange(null);
  };

  const errorKey =
    applied?.result && !applied.result.ok && applied.result.error
      ? COUPON_ERROR_I18N_KEY[applied.result.error]
      : null;

  return (
    <div className="rounded-md border border-border/60 bg-background/50 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BadgePercent className="h-3.5 w-3.5" />
        <span>{t("coupon.title")}</span>
      </div>
      {applied?.result?.ok ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
              <span className="truncate">{applied.code}</span>
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                {formatDiscountLabel(
                  applied.result.discount_kind,
                  applied.result.discount_percent,
                  applied.result.discount_cents,
                  currency,
                  i18n.language,
                )}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("coupon.savings")}{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(applied.result.discount_cents, currency, i18n.language)}
              </span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={clear} className="h-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("coupon.placeholder")}
            className="h-9 text-sm uppercase"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void apply();
              }
            }}
            aria-label={t("coupon.title")}
          />
          <Button size="sm" onClick={apply} disabled={loading || !code.trim()} className="h-9">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("coupon.apply")}
          </Button>
        </div>
      )}
      {errorKey && <p className="text-xs text-destructive">{t(errorKey)}</p>}
    </div>
  );
}

