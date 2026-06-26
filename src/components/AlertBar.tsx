// Site-wide alert bar driven by site_settings.theme_options.header.alert_bar
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSiteSetting } from "@/lib/useSiteSetting";
import * as Icons from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";

type AlertStyle = "info" | "warning" | "success" | "brand";
export const ALERT_ICONS = ["Megaphone", "Bell", "Info", "AlertTriangle", "Check", "Sparkles", "Flame", "Mail"] as const;
export type AlertIconName = (typeof ALERT_ICONS)[number] | "auto" | "none";

type AlertBarCfg = {
  header: {
    alert_bar: {
      enabled: boolean;
      message_pl: string;
      message_en: string;
      link_url: string;
      style: AlertStyle;
      dismissible: boolean;
      icon?: AlertIconName;
      cta_label_pl?: string;
      cta_label_en?: string;
    };
  };
};

const DEFAULTS: AlertBarCfg = {
  header: {
    alert_bar: {
      enabled: false, message_pl: "", message_en: "", link_url: "",
      style: "brand", dismissible: true, icon: "auto", cta_label_pl: "", cta_label_en: "",
    },
  },
};

const STYLE_MAP: Record<AlertStyle, string> = {
  brand: "bg-brand text-brand-foreground",
  info: "bg-sky-600 text-white",
  warning: "bg-amber-500 text-black",
  success: "bg-emerald-600 text-white",
};

const STYLE_BTN: Record<AlertStyle, string> = {
  brand: "bg-brand-foreground/15 hover:bg-brand-foreground/25 text-brand-foreground",
  info: "bg-white/15 hover:bg-white/25 text-white",
  warning: "bg-black/10 hover:bg-black/20 text-black",
  success: "bg-white/15 hover:bg-white/25 text-white",
};

const AUTO_ICON: Record<AlertStyle, AlertIconName> = {
  brand: "Megaphone", info: "Info", warning: "AlertTriangle", success: "Check",
};

const STORAGE_KEY = "alert-bar-dismissed-v1";

export function AlertBar() {
  const { i18n } = useTranslation();
  const cfg = useSiteSetting<AlertBarCfg>("theme_options", DEFAULTS);
  const bar = cfg.header?.alert_bar ?? DEFAULTS.header.alert_bar;
  const [dismissed, setDismissed] = useState(false);

  const lang = i18n.language ?? "pl";
  const isPl = lang.startsWith("pl");
  const msg = (isPl ? bar.message_pl : bar.message_en) || bar.message_pl || bar.message_en;
  const cta = (isPl ? bar.cta_label_pl : bar.cta_label_en) || bar.cta_label_pl || bar.cta_label_en || "";
  const fingerprint = `${bar.message_pl}|${bar.message_en}|${bar.link_url}|${bar.style}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === fingerprint);
    } catch { /* ignore */ }
  }, [fingerprint]);

  const IconCmp = useMemo(() => {
    const requested = bar.icon ?? "auto";
    if (requested === "none") return null;
    const name = requested === "auto" ? AUTO_ICON[bar.style] : requested;
    const map = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
    return map[name] ?? map.Megaphone ?? null;
  }, [bar.icon, bar.style]);

  if (!bar.enabled || !msg || dismissed) return null;

  const styleCls = STYLE_MAP[bar.style] ?? STYLE_MAP.brand;
  const btnCls = STYLE_BTN[bar.style] ?? STYLE_BTN.brand;
  const hasLink = !!bar.link_url;

  const Message = (
    <span className="flex items-center gap-2 min-w-0">
      {IconCmp && <IconCmp className="w-4 h-4 shrink-0" />}
      <span className="truncate font-semibold">{msg}</span>
    </span>
  );

  return (
    <div className={`w-full text-xs ${styleCls}`} role="region" aria-label={isPl ? "Pasek alertu" : "Alert bar"}>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-2 flex items-center gap-3">
        {hasLink && !cta ? (
          <AppLink href={bar.link_url} className="flex-1 min-w-0 flex justify-center hover:underline">{Message}</AppLink>
        ) : (
          <div className="flex-1 min-w-0 flex justify-center">{Message}</div>
        )}

        {cta && hasLink && (
          <AppLink
            href={bar.link_url}
            className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-medium transition ${btnCls}`}
          >
            {cta}
          </AppLink>
        )}

        {bar.dismissible && (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              try { window.localStorage.setItem(STORAGE_KEY, fingerprint); } catch { /* ignore */ }
            }}
            aria-label={isPl ? "Zamknij pasek alertu" : "Dismiss alert bar"}
            className="shrink-0 p-1 rounded hover:bg-black/10 transition"
          >
            <Icons.X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
