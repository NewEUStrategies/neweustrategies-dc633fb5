// Floating share bar - sticky left-side rail on long-form content.
// Desktop only (>= lg). Uses semantic tokens; visible regardless of theme.
// Lives outside the article flow so it does not affect prose width.
import { useEffect, useState } from "react";
import { Twitter, Facebook, Linkedin, Mail, Copy } from "@/lib/lucide-shim";
import { toast } from "sonner";

type Lang = "pl" | "en";

interface Props {
  title: string;
  /** Absolute URL of the post. When empty we use window.location at runtime. */
  url?: string;
  lang: Lang;
  /** Hide automatically until user scrolls past N px from top. Default 240. */
  showAfter?: number;
}

const COPY = {
  pl: { share: "Udostępnij", copy: "Skopiuj link", copied: "Skopiowano link!", x: "X (Twitter)", fb: "Facebook", li: "LinkedIn", mail: "E-mail" },
  en: { share: "Share", copy: "Copy link", copied: "Link copied!", x: "X (Twitter)", fb: "Facebook", li: "LinkedIn", mail: "Email" },
} as const;

export function FloatingShareBar({ title, url, lang, showAfter = 240 }: Props) {
  const [visible, setVisible] = useState(false);
  const [href, setHref] = useState(url ?? "");
  const t = COPY[lang];

  useEffect(() => {
    if (!url && typeof window !== "undefined") setHref(window.location.href);
  }, [url]);

  useEffect(() => {
    const onScroll = (): void => setVisible(window.scrollY > showAfter);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showAfter]);

  const enc = encodeURIComponent;
  const u = href || "";
  const links = [
    { id: "x", label: t.x, icon: Twitter, href: `https://twitter.com/intent/tweet?url=${enc(u)}&text=${enc(title)}` },
    { id: "fb", label: t.fb, icon: Facebook, href: `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
    { id: "li", label: t.li, icon: Linkedin, href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(u)}` },
    { id: "mail", label: t.mail, icon: Mail, href: `mailto:?subject=${enc(title)}&body=${enc(u)}` },
  ] as const;

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(u);
      toast.success(t.copied);
    } catch {
      // Clipboard may be blocked (insecure context, permission); fall back silently.
    }
  };

  return (
    <aside
      aria-label={t.share}
      className={[
        "hidden lg:flex flex-col fixed left-4 top-1/2 -translate-y-1/2 z-40 gap-1.5",
        "rounded-2xl border border-border bg-background/95 backdrop-blur shadow-lg px-1.5 py-2",
        "transition-all duration-300",
        visible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-3 pointer-events-none",
      ].join(" ")}
    >
      <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground text-center mb-1 px-1">
        {t.share}
      </span>
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <a
            key={l.id}
            href={l.href}
            target={l.id === "mail" ? "_self" : "_blank"}
            rel="noopener noreferrer"
            aria-label={l.label}
            title={l.label}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-brand hover:bg-muted transition"
          >
            <Icon className="w-4 h-4" />
          </a>
        );
      })}
      <button
        type="button"
        onClick={onCopy}
        aria-label={t.copy}
        title={t.copy}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-brand hover:bg-muted transition"
      >
        <Copy className="w-4 h-4" />
      </button>
    </aside>
  );
}
