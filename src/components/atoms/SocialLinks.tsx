import { Facebook, Twitter, Youtube, Instagram, Linkedin, Mail } from "@/lib/lucide-shim";

const links = [
  { href: "#", label: "Facebook", Icon: Facebook },
  { href: "#", label: "X", Icon: Twitter },
  { href: "#", label: "YouTube", Icon: Youtube },
  { href: "#", label: "Instagram", Icon: Instagram },
  { href: "#", label: "LinkedIn", Icon: Linkedin },
  { href: "mailto:office@neweuropeanstrategies.com", label: "Email", Icon: Mail },
];

export function SocialLinks({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 text-muted-foreground ${className}`}>
      {links.map(({ href, label, Icon }) => (
        <a key={label} href={href} aria-label={label} className="hover:text-brand transition">
          <Icon className="w-4 h-4" />
        </a>
      ))}
    </div>
  );
}
