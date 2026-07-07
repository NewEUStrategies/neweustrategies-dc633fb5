// /admin/newsletter/inline - Elementor-style builder dla formularza inline.
import { createFileRoute } from "@tanstack/react-router";
import { NewsletterBuilder } from "@/components/admin/newsletter/builder/NewsletterBuilder";

export const Route = createFileRoute("/admin/newsletter/inline")({
  component: () => <NewsletterBuilder variant="inline" />,
});
