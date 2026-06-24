import type { FooterChrome } from "@/lib/theme/footerSettings";
import { resolveCopyright } from "@/lib/theme/footerSettings";

interface Props {
  chrome: FooterChrome;
  lang: "pl" | "en";
}

export function CopyrightBar({ chrome, lang }: Props) {
  const text = resolveCopyright(chrome, lang);
  if (!text) return null;
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
      <div className={["container mx-auto px-4", alignCls].join(" ")}>{text}</div>
    </div>
  );
}
