// Renders a research-program icon from its stored icon-name string
// (e.g. "Globe", "Shield"). Unknown / empty names fall back to Compass, so the
// UI never breaks on a bad value. The icon set lives in @/lib/programs/icons
// (imported by name, so the bundler tree-shakes to just that set).
import { PROGRAM_ICONS, DEFAULT_PROGRAM_ICON } from "@/lib/programs/icons";

export function ProgramIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const Icon = (name && PROGRAM_ICONS[name]) || DEFAULT_PROGRAM_ICON;
  return <Icon className={className} aria-hidden={true} />;
}
