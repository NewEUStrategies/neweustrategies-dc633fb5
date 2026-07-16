/**
 * Client-only ECharts wrapper.
 *
 * ECharts + echarts-for-react adds ~1 MB to whatever bundle imports it. The
 * Cloudflare/Nitro SSR pass already bundles a very large route graph (router
 * chunk >2.5 MB), and pulling ECharts into that graph pushed Rollup's chunk
 * renderer into a V8 OOM at `build:dev`.
 *
 * The fix is structural: never let the SSR module graph reach ECharts.
 * `EChart` here is a tiny hydration stub that renders a skeleton on the server
 * and a `React.lazy` boundary on the client. Only after mount does the browser
 * dynamically import the real chart module (`EChartClient`).
 *
 * Do NOT statically import `./EChartClient` from this file, and do NOT re-export
 * anything that transitively pulls it in - that reintroduces the SSR bundle
 * graph edge we're paying this indirection to break.
 */
import { Suspense, lazy, useEffect, useState } from "react";
import type { EChartsCoreOption, ECharts } from "echarts/core";

export interface EChartProps {
  option: EChartsCoreOption;
  height?: number | string;
  onReady?: (instance: ECharts) => void;
  className?: string;
  /** Bump to force a re-read of CSS chart tokens (e.g. after theme change). */
  themeVersion?: number;
}

const LazyClient = lazy(() =>
  import("./EChartClient").then((m) => ({ default: m.EChartClient })),
);

export function EChart(props: EChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const height = props.height ?? 320;
  const skeleton = (
    <div
      aria-hidden
      className={"animate-pulse rounded-md bg-muted/40 " + (props.className ?? "")}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    />
  );

  if (!mounted) return skeleton;
  return (
    <Suspense fallback={skeleton}>
      <LazyClient {...props} />
    </Suspense>
  );
}
