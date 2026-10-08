import type { FooterChrome } from "@/lib/theme/footerSettings";
import { resolveCopyright } from "@/lib/theme/footerSettings";
import { FOOTER_LINKS } from "@/lib/seo/footerNavigation";
import { LegalLinks } from "./LegalLinks";

interface Props {
  chrome: FooterChrome;
  lang: "pl" | "en";
}

export function CopyrightBar({ chrome, lang }: Props) {
  const text = resolveCopyright(chrome, lang);
  // Linki prawne renderujemy zawsze - niezależnie od dokumentu buildera -
  // bo muszą być dostępne z każdej strony (wymóg operatora płatności).
  // Listwa jest wspólna ze stopką publiczną (`LegalLinks`, tam montowana
  // wprost pod dokumentem buildera), więc adresy, etykiety i nazwa dostępna
  // nawigacji mają jedno źródło.
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
        <LegalLinks
          links={FOOTER_LINKS}
          lang={lang}
          className=""
          listClassName={[
            "m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0",
            chrome.layout === "centered" ? "justify-center" : "",
          ].join(" ")}
        />
      </div>
    </div>
  );
}
