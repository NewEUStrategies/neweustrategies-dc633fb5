// Kompaktowe ikony social - domyślnie ładowane z biblioteki ikon
// (Admin -> Wygląd -> Ikony, kind='brand'). Jeśli wpis nie istnieje,
// renderujemy spójny fallback SVG (Lucide-style), żeby UI nigdy nie był pusty.
import { Facebook, Instagram, Twitter, Youtube, Linkedin } from "@/lib/lucide-shim";
import { BrandIcon } from "@/components/atoms/BrandIcon";

type IconProps = { className?: string };

// X (dawniej Twitter) - logo X jako fallback gdy admin nie wgrał własnej ikony.
const XFallback = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M17.5 3h3l-6.6 7.5L22 21h-6.2l-4.8-6.3L5.4 21H2.4l7-8L2 3h6.3l4.4 5.8L17.5 3zm-1 16h1.7L7.6 4.9H5.8L16.5 19z" />
  </svg>
);
const SpotifyFallback = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.6 14.4c-.2.3-.6.4-.9.2-2.5-1.5-5.6-1.9-9.3-1-.4.1-.7-.1-.8-.5-.1-.4.1-.7.5-.8 4-.9 7.5-.5 10.3 1.2.3.2.4.6.2.9zm1.2-2.7c-.3.4-.7.5-1.1.3-2.9-1.8-7.3-2.3-10.7-1.3-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 3.9-1.2 8.8-.6 12.1 1.4.4.2.5.7.2 1.1zm.1-2.8C14.4 8.8 8.7 8.6 5.4 9.6c-.5.1-1.1-.1-1.2-.6-.1-.5.1-1.1.6-1.2 3.8-1.1 10.2-.9 14.2 1.5.5.3.6.9.4 1.4-.3.4-1 .5-1.5.2z" />
  </svg>
);

const links: { name: string; href: string; label: string; fallback: React.ComponentType<IconProps> }[] = [
  { name: "facebook", href: "#", label: "Facebook", fallback: Facebook },
  { name: "x", href: "#", label: "X", fallback: XFallback },
  { name: "twitter", href: "#", label: "Twitter", fallback: Twitter },
  { name: "youtube", href: "#", label: "YouTube", fallback: Youtube },
  { name: "instagram", href: "#", label: "Instagram", fallback: Instagram },
  { name: "linkedin", href: "#", label: "LinkedIn", fallback: Linkedin },
  { name: "spotify", href: "#", label: "Spotify", fallback: SpotifyFallback },
];

export function SocialLinks({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-muted-foreground ${className}`}>
      {links.map(({ name, href, label, fallback }) => (
        <a
          key={label}
          href={href}
          aria-label={label}
          className="hover:text-brand transition-colors inline-flex items-center justify-center"
        >
          <BrandIcon name={name} fallback={fallback} alt={label} className="w-3.5 h-3.5" />
        </a>
      ))}
    </div>
  );
}
