// Ikony marek pikseli (Meta, LinkedIn) dla panelu - zawsze przez `BrandIcon`,
// więc ikona wgrana w /admin/icons wygrywa z glifem w kodzie.
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { Facebook, Linkedin } from "@/lib/icons/brandIcons";

type IconProps = { className?: string };

export function MetaBrandIcon({ className }: IconProps) {
  return <BrandIcon name="meta" fallback={Facebook} className={className} aria-hidden="true" />;
}

export function LinkedInBrandIcon({ className }: IconProps) {
  return <BrandIcon name="linkedin" fallback={Linkedin} className={className} aria-hidden="true" />;
}
