// Site-wide alert bar driven by site_settings.theme_options.header.alert_bar
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { X } from "@/lib/lucide-shim";

type AlertBarCfg = {
  header: {
    alert_bar: {
      enabled: boolean;
      message_pl: string;
      message_en: string;
      link_url: string;
      style: "info" | "warning" | "success" | "brand";
      dismissible: boolean;
    };
  };
};

const DEFAULTS: AlertBarCfg = {
  header: {
    alert_bar: { enabled: false, message_pl: "", message_en: "", link_url: "", style: "brand", dismissible: true },
  },
};

const STYLE_MAP: Record<AlertBarCfg["header"]["alert_bar"]["style"], string> = {
  brand: "bg-brand text-brand-foreground",
  info: "bg-sky-600 text-white",
  warning: "bg-amber-500 text-black",
  success: "bg-emerald-600 text-white",
};

const STORAGE_KEY = "alert-bar-dismissed-v1";

export function AlertBar() {
  const { i18n } = useTranslation();
  const cfg = useSiteSetting<AlertBarCfg>("theme_options", DEFAULTS);
  const bar = cfg.header?.alert_bar ?? DEFAULTS.header.alert_bar;
  const [dismissed, setDismissed] = useState(false);

  const lang = i18n.language ?? "pl";
  const msg = (lang.startsWith("pl") ? bar.message_pl : bar.message_en) || bar.message_pl || bar.message_en;
  const fingerprint = `${bar.message_pl}|${bar.message_en}|${bar.link_url}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === fingerprint);
    } catch { /* ignore */ }
  }, [fingerprint]);

  if (!bar.enabled || !msg || dismissed) return null;

  const onDismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(STORAGE_KEY, fingerprint); } catch { /* ignore */ }
  };

  const Inner = bar.link_url
    ? <a href={bar.link_url} className="flex-1 text-center font-semibold hover:underline">{msg}</a>
    : <span className="flex-1 text-center font-semibold">{msg}</span>;

  return (
    <div className={`w-full text-xs ${STYLE_MAP[bar.style] ?? STYLE_MAP.brand}`}>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-2 flex items-center gap-3">
        {Inner}
        {bar.dismissible && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Zamknij"
            className="p-1 rounded hover:bg-black/10 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
