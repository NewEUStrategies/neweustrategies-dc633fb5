// Curated icon registry for research programs. Icons are imported by name (NOT
// `import * as LucideIcons`) so the bundler tree-shakes to just this set — a
// namespace import would pull the entire lucide-react library into the public
// bundle. Extend this map to offer a new program icon in both the admin picker
// and the public renderer.
import {
  Compass,
  Globe,
  Shield,
  TrendingUp,
  Cpu,
  Zap,
  Route,
  Landmark,
  Scale,
  Ship,
  Factory,
  Leaf,
  Users,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export const PROGRAM_ICONS: Record<string, LucideIcon> = {
  Compass,
  Globe,
  Shield,
  TrendingUp,
  Cpu,
  Zap,
  Route,
  Landmark,
  Scale,
  Ship,
  Factory,
  Leaf,
  Users,
  BookOpen,
};

/** Fallback icon when a program's stored icon name is unknown or empty. */
export const DEFAULT_PROGRAM_ICON: LucideIcon = Compass;
