import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LogIn, Star } from "@/lib/lucide-shim";

const Lock = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ContentAccessRule, AccessPlan } from "@/hooks/useContentAccess";
import { formatMoney } from "@/hooks/useContentAccess";

type Props = {
  rule: ContentAccessRule;
  lang: "pl" | "en";
  /** Raw text content for auto-teaser when no manual teaser set */
  fallbackText?: string | null;
};

const T = {
  pl: {
    membersOnly: "Treść tylko dla zalogowanych",
    membersDesc: "Zaloguj się lub załóż darmowe konto, aby kontynuować czytanie.",
    paidOnly: "Treść premium",
    paidDesc: "Wykup dostęp jednorazowy lub subskrypcję, aby przeczytać cały materiał.",
    signin: "Zaloguj się",
    signup: "Załóż konto",
    buy: "Kup dostęp",
    subscribe: "Subskrybuj",
    perMonth: "/ mies.",
    perYear: "/ rok",
    oneTime: "jednorazowo",
    soonNotice: "Płatności online zostaną włączone wkrótce — zapisz się, aby otrzymać dostęp jako pierwszy.",
    interestSaved: "Zapisaliśmy Twoje zainteresowanie tym materiałem.",
    interestFail: "Nie udało się zapisać — spróbuj ponownie.",
  },
  en: {
    membersOnly: "Members-only content",
    membersDesc: "Sign in or create a free account to continue reading.",
    paidOnly: "Premium content",
    paidDesc: "Purchase one-time access or subscribe to read the full piece.",
    signin: "Sign in",
    signup: "Create account",
    buy: "Buy access",
    subscribe: "Subscribe",
    perMonth: "/ mo",
    perYear: "/ yr",
    oneTime: "one-time",
    soonNotice: "Online payments are coming soon — register your interest to get access first.",
    interestSaved: "Saved your interest in this content.",
    interestFail: "Couldn't save — please try again.",
  },
};

export function Paywall({ rule, lang, fallbackText }: Props) {
  const { session } = useAuth();
  const t = T[lang];
  const teaser =
    (lang === "pl" ? rule.teaser_pl : rule.teaser_en) ||
    (fallbackText ? buildAutoTeaser(fallbackText) : "");

  const [plans, setPlans] = useState<AccessPlan[]>([]);
  useEffect(() => {
    if (rule.mode !== "paid" || rule.plan_ids.length === 0) return;
    supabase
      .from("access_plans")
      .select("*")
      .in("id", rule.plan_ids)
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setPlans((data as AccessPlan[]) ?? []));
  }, [rule.plan_ids, rule.mode]);

  const registerInterest = async () => {
    if (!session) return;
    const { error } = await supabase.from("user_purchases").insert({
      tenant_id: (session.user.user_metadata as any)?.tenant_id ?? null,
      user_id: session.user.id,
      entity_type: rule.entity_type,
      entity_id: rule.entity_id,
      amount_cents: rule.one_time_price_cents ?? 0,
      currency: rule.one_time_currency ?? "PLN",
      status: "pending",
    });
    if (error) toast.error(t.interestFail);
    else toast.success(t.interestSaved);
  };

  return (
    <div className="mt-10 border border-border rounded-xl overflow-hidden bg-gradient-to-b from-muted/40 to-background">
      {teaser && (
        <div className="px-6 pt-6 pb-2 prose prose-lg dark:prose-invert max-w-none">
          <p className="text-foreground/80">{teaser}…</p>
        </div>
      )}
      <div className="px-6 py-8 text-center border-t border-border bg-background/60">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand/10 text-brand mb-4">
          {rule.mode === "members" ? <LogIn className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
        </div>
        <h2 className="font-display text-2xl font-bold mb-2">
          {rule.mode === "members" ? t.membersOnly : t.paidOnly}
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
          {rule.mode === "members" ? t.membersDesc : t.paidDesc}
        </p>

        {/* Members-only / not logged in */}
        {!session && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/login">
              <Button>
                <LogIn className="w-4 h-4 mr-2" /> {t.signin}
              </Button>
            </Link>
            <Link to="/login" search={{ mode: "signup" }}>
              <Button variant="outline">{t.signup}</Button>
            </Link>
          </div>
        )}

        {/* Paid — logged in, show plans + one-time */}
        {session && rule.mode === "paid" && (
          <div className="space-y-4">
            {plans.length > 0 && (
              <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left">
                {plans.map((p) => {
                  const name = lang === "pl" ? p.name_pl : p.name_en;
                  const desc = lang === "pl" ? p.description_pl : p.description_en;
                  const intervalLabel =
                    p.interval === "month" ? t.perMonth : p.interval === "year" ? t.perYear : t.oneTime;
                  return (
                    <div key={p.id} className="border border-border rounded-lg p-4 bg-background hover:border-brand transition">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand mb-1">
                        <Star className="w-3.5 h-3.5" /> {name}
                      </div>
                      <div className="text-2xl font-bold">
                        {formatMoney(p.price_cents, p.currency)}
                        <span className="text-xs font-normal text-muted-foreground ml-1">{intervalLabel}</span>
                      </div>
                      {desc && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{desc}</p>}
                      <Button size="sm" className="w-full mt-3" onClick={registerInterest}>
                        {t.subscribe}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            {rule.one_time_price_cents != null && rule.one_time_price_cents > 0 && (
              <div className="inline-flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-background">
                <span className="text-sm">
                  {t.buy}: <strong>{formatMoney(rule.one_time_price_cents, rule.one_time_currency || "PLN")}</strong>
                  <span className="text-xs text-muted-foreground ml-1">{t.oneTime}</span>
                </span>
                <Button size="sm" onClick={registerInterest}>{t.buy}</Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground italic max-w-md mx-auto">{t.soonNotice}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function buildAutoTeaser(text: string) {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const target = Math.max(120, Math.floor(plain.length * 0.2));
  if (plain.length <= target) return plain;
  const cut = plain.slice(0, target);
  const lastDot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastDot > 60 ? cut.slice(0, lastDot + 1) : cut).trim();
}
