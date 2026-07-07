// /admin/newsletter/popup - Elementor-style builder dla popupu + triggery.
import { createFileRoute } from "@tanstack/react-router";
import { NewsletterBuilder } from "@/components/admin/newsletter/builder/NewsletterBuilder";

export const Route = createFileRoute("/admin/newsletter/popup")({
  component: () => <NewsletterBuilder variant="popup" />,
});
