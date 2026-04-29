/** Host-plugin contribution for forms-core.
 *
 *  Mounts at /api/<routes> via the shell's plugin loader. */
import type { HostPlugin } from "@gutu-host/plugin-contract";
import { migrate } from "./db/migrate";
import { propertySetterRoutes } from "./routes/property-setters";
import { webFormsRoutes } from "./routes/web-forms";


export const hostPlugin: HostPlugin = {
  id: "forms-core",
  version: "1.0.0",
  dependsOn: ["notifications-core"],
  migrate,
  routes: [
    { mountPath: "/property-setters", router: propertySetterRoutes },
    { mountPath: "/web-forms", router: webFormsRoutes }
  ],
  resources: [
    "forms.form",
  ],
};

// Re-export the lib API so other plugins can `import` from
// "@gutu-plugin/forms-core".
export * from "./lib";
