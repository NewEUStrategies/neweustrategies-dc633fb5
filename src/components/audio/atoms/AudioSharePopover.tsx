// Atom: dymek udostępniania dolnego paska audio.
//
// Klik w ikonę „Udostępnij" otwiera bąbelek nad paskiem: kafelki kanałów
// społecznościowych + „Skopiuj link". Współdzieli z `FloatingShareBar` ten sam
// język wizualny kafelków (BrandIcon + brandTile) i TEN SAM słownik
// `share.channel.*`, więc dodanie kanału w jednym miejscu widać w obu
// powierzchniach. Etykiety idą w języku ODTWARZANEGO materiału (`lang`), nie
// interfejsu - udostępniany jest TEN materiał (wzorzec `FloatingShareBar`).
import { useState, type ComponentType, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Facebook, Linkedin, Mail, Share2 } from "@/lib/lucide-shim";
import { XIcon } from "@/components/atoms/XIcon";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { BRAND_TILE_CLASS, brandTileStyle } from "@/components/common/brandTile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { promptDialog } from "@/lib/appDialogs";
import { AUDIO_FOCUS_RING } from "@/components/audio/atoms/AudioIconButton";
// Słownik kanałów - import jako efekt uboczny trzyma go w chunku, który go
// czyta (wzorzec `i18n-post-experience.ts`). KLUCZE PODAJEMY W CAŁOŚCI przy
// każdym wywołaniu - patrz komentarz w `FloatingShareBar.tsx` o bramce
// `i18nKeyDrift`: wrapper doklejający prefiks oślepia statyczny skan.
import "@/lib/i18n-share";

type Lang = "pl" | "en";

/** Kanały dymku - ten sam zestaw co w pasku czytania (`FloatingShareBar`). */
type ShareChannelId = "x" | "facebook" | "linkedin" | "mail" | "whatsapp" | "telegram" | "reddit";

const enc = encodeURIComponent;

interface ShareLink {
  id: ShareChannelId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
}

interface AudioSharePopoverProps {
  /** Język ODTWARZANEGO materiału - etykiety dymku mówią jego językiem. */
  lang: Lang;
  /** Etykieta dostępna PRZYCISKU - ogłasza też dymek czytnikowi ekranu. */
  label: string;
  /** Tytuł materiału - wchodzi do intencji X i tematu maila. */
  title: string;
  /** ABSOLUTNY, kanoniczny adres materiału (domena marki, nie host podglądu). */
  url: string;
  /** Komunikat toastu po skopiowaniu - w języku materiału. */
  copiedMessage: string;
  /** Wyzwalacz - atom `AudioIconButton` (Radix `asChild` potrzebuje refs). */
  children: ReactElement;
}

export function AudioSharePopover({
  lang,
  label,
  title,
  url,
  copiedMessage,
  children,
}: AudioSharePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const copy = (key: string) => t(key, { lng: lang });

  const links: ShareLink[] = [
    {
      id: "x",
      label: copy("share.channel.x"),
      icon: XIcon,
      href: `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}`,
    },
    {
      id: "facebook",
      label: copy("share.channel.facebook"),
      icon: Facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    },
    {
      id: "linkedin",
      label: copy("share.channel.linkedin"),
      icon: Linkedin,
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    },
    {
      id: "mail",
      label: copy("share.channel.mail"),
      icon: Mail,
      href: `mailto:?subject=${enc(title)}&body=${enc(url)}`,
    },
    {
      id: "whatsapp",
      label: copy("share.channel.whatsapp"),
      icon: Share2,
      href: `https://wa.me/?text=${enc(`${title} ${url}`)}`,
    },
    {
      id: "telegram",
      label: copy("share.channel.telegram"),
      icon: Share2,
      href: `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}`,
    },
    {
      id: "reddit",
      label: copy("share.channel.reddit"),
      icon: Share2,
      href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`,
    },
  ];

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(copiedMessage);
      setOpen(false);
    } catch {
      // Schowek odmówił (uprawnienia / niepewny kontekst) - ostateczny fallback:
      // dialog aplikacji z adresem do ręcznego skopiowania.
      void promptDialog({ title: copy("share.bar.copy"), defaultValue: url, confirmLabel: "OK" });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* Portal do body: nie da się go przyciąć przez `overflow-hidden` paska
          ani doku; z-[80] trzyma dymek ponad paskiem (z-70 standalone). */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        aria-label={label}
        className="z-[80] w-auto min-w-56 rounded-[10px] p-3"
      >
        <span className="cms-widget-note inline-flex items-center gap-1.5 font-bold uppercase tracking-widest text-muted-foreground">
          <Share2 className="h-3 w-3" aria-hidden />
          {copy("share.bar.share")}
        </span>
        <div className="mt-2 grid grid-cols-4 gap-1">
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
                style={brandTileStyle(l.id)}
                className={`${BRAND_TILE_CLASS} h-9 w-9 text-muted-foreground`}
                onClick={() => setOpen(false)}
              >
                <BrandIcon
                  name={l.id}
                  fallback={Icon}
                  alt={l.label}
                  className="h-[15px] w-[15px]"
                />
              </a>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void onCopy()}
          className={[
            "cms-widget-label mt-2 inline-flex h-9 w-full items-center justify-center gap-2",
            "rounded-[6px] border border-border text-foreground",
            "transition hover:bg-muted hover:text-brand",
            AUDIO_FOCUS_RING,
          ].join(" ")}
        >
          <Copy className="h-4 w-4" aria-hidden />
          {copy("share.bar.copy")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
