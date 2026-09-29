import type { LucideProps } from "lucide-react";
import { lazyNamedIcon } from "./lazyNamedIcon";

/** Keep the optional catalog loader out of the initial page bundle. */
export default function DynamicIconChunk({ iconKey, ...props }: LucideProps & { iconKey: string }) {
  const Icon = lazyNamedIcon(iconKey);
  return <Icon {...props} />;
}
