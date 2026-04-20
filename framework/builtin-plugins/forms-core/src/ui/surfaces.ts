import { defineUiSurface } from "@platform/ui-shell";
import { FormsCoreAdminPage } from "./admin/main.page";

export const uiSurface = defineUiSurface({
  embeddedPages: [
    {
      shell: "admin",
      route: "/admin/forms-core",
      component: FormsCoreAdminPage,
      permission: "forms.submissions.read"
    }
  ],
  widgets: []
});