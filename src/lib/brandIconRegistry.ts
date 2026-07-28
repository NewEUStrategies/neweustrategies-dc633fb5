/**
 * Brand/social icon alias registry backed by the lucide-shim components.
 *
 * Use this instead of importing individual brand symbols when the icon name is
 * data-driven (CMS field, DB row, user input). Unknown names resolve to a safe
 * neutral fallback (Circle) so a bad value never crashes the tree.
 *
 * Kept in a separate module from ./lucide-shim so the shim namespace remains a
 * flat map of icon components (several call sites cast
 * `import * as Icons from "@/lib/lucide-shim"` to Record<string, IconComp>).
 */
import {
  Circle,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Youtube,
  Globe,
  Mail,
  Send,
  type LucideIcon,
} from "@/lib/lucide-shim";

export const BRAND_ICONS: Record<string, LucideIcon> = {
  facebook: Facebook,
  fb: Facebook,
  linkedin: Linkedin,
  "linked-in": Linkedin,
  twitter: Twitter,
  x: Twitter,
  "x-twitter": Twitter,
  instagram: Instagram,
  ig: Instagram,
  youtube: Youtube,
  yt: Youtube,
  website: Globe,
  web: Globe,
  email: Mail,
  mail: Mail,
  telegram: Send,
};

export function resolveBrandIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Circle;
  const key = name.trim().toLowerCase().replace(/\s+/g, "-");
  return BRAND_ICONS[key] ?? Circle;
}
