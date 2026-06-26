import { redirect } from "next/navigation";

// Integrations folded into the unified "Cuenta" page (Integraciones tab).
export default function IntegrationsPage() {
  redirect("/account");
}
