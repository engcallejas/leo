import { redirect } from "next/navigation";

// The projects list lives in the unified "Cuenta" page (Proyectos tab). Deep
// edit/create remain at /projects/[id] and /projects/new.
export default function ProjectsPage() {
  redirect("/account");
}
