// Molekuła: rzeczywisty adres strony + cztery wyjścia „na żywo".
//
// Podgląd w panelu rysuje to, co WYŚLEMY. Ten pasek pokazuje to, co świat
// FAKTYCZNIE widzi pod tym adresem: samą stronę, wynik Google (`site:`),
// kartę czytaną przez Facebooka i kartę czytaną przez LinkedIna. Wszystko
// w nowym oknie, żeby niezapisany formularz nie zniknął pod nawigacją.
import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/lib/lucide-shim";
import {
  facebookDebuggerUrl,
  googleResultUrl,
  linkedinInspectorUrl,
  livePageUrl,
} from "@/lib/seo/liveValidatorLinks";

interface LivePreviewLinksProps {
  /** Ścieżka bez originu, np. "" (strona główna), "en", "blog/moj-wpis". */
  path: string;
  className?: string;
}

const LINK_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 " +
  "text-xs font-medium text-foreground/90 transition-colors hover:border-brand hover:text-brand";

export function LivePreviewLinks({ path, className }: LivePreviewLinksProps) {
  const { t } = useTranslation();
  const url = livePageUrl(path);
  const targets: readonly { readonly key: string; readonly href: string; readonly label: string }[] =
    [
      { key: "page", href: url, label: t("admin.seo.live.openPage") },
      { key: "google", href: googleResultUrl(url), label: t("admin.seo.live.google") },
      { key: "facebook", href: facebookDebuggerUrl(url), label: t("admin.seo.live.facebook") },
      { key: "linkedin", href: linkedinInspectorUrl(url), label: t("admin.seo.live.linkedin") },
    ];
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("admin.seo.live.address")}:</span>{" "}
        <span className="break-all">{url}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {targets.map((target) => (
          <a
            key={target.key}
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {target.label}
          </a>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">{t("admin.seo.live.hint")}</p>
    </div>
  );
}
