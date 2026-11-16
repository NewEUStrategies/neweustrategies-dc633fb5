import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { lazyNamedIcon } from "./lazyNamedIcon";

/** Keep the optional catalog loader out of the initial page bundle. */
export default function DynamicIconChunk({
  iconKey,
  missing,
  ...props
}: LucideProps & { iconKey: string; missing?: ComponentType<LucideProps> }) {
  const Icon = lazyNamedIcon(iconKey, missing);
  return <Icon {...props} />;
}
