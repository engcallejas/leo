import { redirect } from "next/navigation";

// Settings folded into the unified "Cuenta" page (Motor & Auth tab).
export default function SettingsPage() {
  redirect("/account");
}
