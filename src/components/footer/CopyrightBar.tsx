import { Link } from "@tanstack/react-router";
import type { FooterChrome } from "@/lib/theme/footerSettings";
import { resolveCopyright } from "@/lib/theme/footerSettings";
import { footerLinksByGroup, labelFor } from "@/lib/seo/footerNavigation";

interface Props {
  chrome: FooterChrome;
  lang: "pl" | "en";
}

export function CopyrightBar({ chrome, lang }: Props) {
  const text = resolveCopyright(chrome, lang);
  // Linki prawne renderujemy zawsze - niezależnie od dokumentu buildera -
  // bo muszą być dostępne z każdej strony (wymóg operatora płatności).
  const legal = footerLinksByGroup("legal");
  const alignCls = chrome.layout === "centered" ? "text-center" : "text-left sm:text-left";
  const toneCls =
    chrome.layout === "dark"
      ? "bg-foreground text-background"
      : chrome.layout === "light"
        ? "bg-muted text-foreground"
        : "bg-card text-muted-foreground";
  return (
    <div
      className={[
        "w-full py-3 text-xs",
        chrome.show_separator ? "border-t border-border" : "",
        toneCls,
      ].join(" ")}
    >
      <div
        className={[
          "container mx-auto px-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
          alignCls,
        ].join(" ")}
      >
        {text ? <div>{text}</div> : <span />}
        <nav
          aria-label={lang === "en" ? "Legal" : "Informacje prawne"}
          className={[
            "flex flex-wrap gap-x-4 gap-y-1",
            chrome.layout === "centered" ? "justify-center" : "",
          ].join(" ")}
        >
          {legal.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className="underline-offset-2 transition-opacity hover:underline hover:opacity-80"
            >
              {labelFor(link, lang)}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
