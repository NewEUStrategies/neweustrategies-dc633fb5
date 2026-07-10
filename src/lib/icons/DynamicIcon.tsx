// Lokalny odpowiednik lucide-react/dynamic (SSR-safe): resolwer po nazwie kebab-case.
// Wykorzystuje named-exports w formacie PascalCase + "Icon" z pakietu lucide-react.
import * as LucideIcons from "lucide-react";
import { HelpCircle, type LucideProps } from "lucide-react";

export type IconName = string;

function toPascalIconKey(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
  return `${pascal}Icon`;
}

type IconComponent = React.ComponentType<LucideProps>;

interface DynamicIconProps extends LucideProps {
  name: string;
}

export function DynamicIcon({ name, ...rest }: DynamicIconProps) {
  const key = toPascalIconKey(name);
  const registry = LucideIcons as unknown as Record<string, IconComponent | undefined>;
  const Icon = (key ? registry[key] : undefined) ?? HelpCircle;
  return <Icon {...rest} />;
}
