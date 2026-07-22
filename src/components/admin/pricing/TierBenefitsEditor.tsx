// Współdzielony edytor benefitów warstwy (panel Członkostwo + panel Cennik):
// para PL/EN + opcjonalne rozwinięcie (detail_*) i nagłówek grupy (group_*)
// w stylu NYT/FT. Oba panele zapisują przez serializeTierBenefits z
// lib/billing/tiers - żaden edytor nie gubi pól zapisanych przez drugi.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { TierBenefit } from "@/lib/billing/tiers";
import { ensureI18n as ensureAdminPricingI18n } from "@/lib/i18n-admin-pricing";

function hasExtras(benefit: TierBenefit): boolean {
  return Boolean(
    (benefit.detail_pl ?? "").trim() ||
    (benefit.detail_en ?? "").trim() ||
    (benefit.group_pl ?? "").trim() ||
    (benefit.group_en ?? "").trim(),
  );
}

export function TierBenefitsEditor({
  value,
  onChange,
}: {
  value: TierBenefit[];
  onChange: (next: TierBenefit[]) => void;
}) {
  ensureAdminPricingI18n();
  const { t } = useTranslation();
  const tb = (k: string) => t(`adminPricing.benefits.${k}`);
  // Ręcznie rozwinięte wiersze; wiersze z wypełnionymi polami dodatkowymi
  // są otwarte zawsze (nic edytowalnego nie znika z oczu).
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const update = (i: number, patch: Partial<TierBenefit>) => {
    onChange(value.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => onChange([...value, { pl: "", en: "" }]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs">{tb("heading")}</Label>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {tb("add")}
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
          {tb("empty")}
        </p>
      ) : (
        <ol className="space-y-2">
          {value.map((benefit, i) => {
            const open = expanded[i] ?? hasExtras(benefit);
            return (
              <li key={i} className="rounded-md border border-border/60 bg-muted/30 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">#{i + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      title={tb("moveUp")}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => move(i, 1)}
                      disabled={i === value.length - 1}
                      title={tb("moveDown")}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(i)}
                      title={tb("remove")}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  <Input
                    placeholder="PL"
                    value={benefit.pl}
                    onChange={(e) => update(i, { pl: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <Input
                    placeholder="EN"
                    value={benefit.en}
                    onChange={(e) => update(i, { en: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <button
                  type="button"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded((s) => ({ ...s, [i]: !open }))}
                  aria-expanded={open}
                >
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                    aria-hidden="true"
                  />
                  {tb("more")}
                </button>
                {open && (
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    <Input
                      placeholder={tb("detailPl")}
                      value={benefit.detail_pl ?? ""}
                      onChange={(e) => update(i, { detail_pl: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder={tb("detailEn")}
                      value={benefit.detail_en ?? ""}
                      onChange={(e) => update(i, { detail_en: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder={tb("groupPl")}
                      value={benefit.group_pl ?? ""}
                      onChange={(e) => update(i, { group_pl: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder={tb("groupEn")}
                      value={benefit.group_en ?? ""}
                      onChange={(e) => update(i, { group_en: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <p className="text-[11px] leading-snug text-muted-foreground sm:col-span-2">
                      {tb("groupHint")}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
