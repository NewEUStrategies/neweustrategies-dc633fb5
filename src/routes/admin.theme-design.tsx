import { createFileRoute, redirect } from "@tanstack/react-router";

// Old standalone Theme Design page — now a section inside Opcje motywu.
export const Route = createFileRoute("/admin/theme-design")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/theme-options", search: { section: "design" } });
  },
  component: () => null,
});
