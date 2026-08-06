// Atom: jeden kanał udostępniania w siatce popovera (e-mail, LinkedIn, X...).
// Ikonografia idzie przez BrandIcon z fallbackiem na lucide - dokładnie ta sama
// ścieżka co panel czytania (FloatingShareBar), żeby pasek i popover nigdy się
// nie rozjechały wizualnie.
import type { ComponentType } from "react";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import type { GiftChannelId } from "@/lib/gifting/model";

interface GiftChannelLinkProps {
  id: GiftChannelId;
  href: string;
  label: string;
  fallbackIcon: ComponentType<{ className?: string }>;
}

export function GiftChannelLink({ id, href, label, fallbackIcon }: GiftChannelLinkProps) {
  return (
    <a
      href={href}
      // Klient poczty otwieramy w tej samej karcie (mailto: nie ma czego
      // renderować w nowej), resztę w nowej z rel="noopener".
      target={id === "mail" ? "_self" : "_blank"}
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      data-gift-channel={id}
      className="inline-flex items-center justify-center h-9 rounded-[5px] text-muted-foreground hover:text-brand hover:bg-muted transition-colors"
    >
      <BrandIcon name={id} fallback={fallbackIcon} alt={label} className="w-[15px] h-[15px]" />
    </a>
  );
}
