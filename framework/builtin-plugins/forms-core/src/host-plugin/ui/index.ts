/** Admin-shell UI contributions for forms-core.
 *
 *  Two pages:
 *    - /settings/custom-fields    — editor for tenant-defined custom fields
 *    - /settings/property-setters — Frappe-style property overrides
 *
 *  Plus matching nav entries + Cmd-K commands. Imported by the shell
 *  through @gutu-plugin-ui/forms-core. */

import { defineAdminUi } from "@gutu-host/plugin-ui-contract";
import { CustomFieldsPage } from "./pages/CustomFieldsPage";
import { PropertySettersPage } from "./pages/PropertySettersPage";

export const adminUi = defineAdminUi({
  id: "forms-core",
  pages: [
    {
      id: "forms-core.custom-fields",
      path: "/settings/custom-fields",
      title: "Custom fields",
      description: "Per-resource metadata editor — add fields without a deploy.",
      Component: CustomFieldsPage,
      icon: "Sparkles",
    },
    {
      id: "forms-core.property-setters",
      path: "/settings/property-setters",
      title: "Property setters",
      description: "Tenant-scoped overrides of built-in field properties.",
      Component: PropertySettersPage,
      icon: "Settings2",
    },
  ],
  navEntries: [
    {
      id: "forms-core.nav.custom-fields",
      label: "Custom fields",
      icon: "Sparkles",
      path: "/settings/custom-fields",
      section: "settings",
      order: 10,
    },
    {
      id: "forms-core.nav.property-setters",
      label: "Property setters",
      icon: "Settings2",
      path: "/settings/property-setters",
      section: "settings",
      order: 11,
    },
  ],
  commands: [
    {
      id: "forms-core.cmd.custom-fields",
      label: "Open Custom fields",
      icon: "Sparkles",
      keywords: ["custom", "field", "metadata", "schema"],
      run: () => { window.location.hash = "/settings/custom-fields"; },
    },
    {
      id: "forms-core.cmd.property-setters",
      label: "Open Property setters",
      icon: "Settings2",
      keywords: ["property", "setter", "override"],
      run: () => { window.location.hash = "/settings/property-setters"; },
    },
  ],
});

// Re-export pages so they're importable directly if needed.
export { CustomFieldsPage } from "./pages/CustomFieldsPage";
export { PropertySettersPage } from "./pages/PropertySettersPage";
