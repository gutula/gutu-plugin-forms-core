import { definePackage } from "@platform/kernel";

export default definePackage({
  id: "forms-core",
  kind: "app",
  version: "0.1.0",
  displayName: "Forms Core",
  description: "Dynamic forms and submissions backbone.",
  extends: [],
  dependsOn: ["auth-core","org-tenant-core","role-policy-core","audit-core"],
  optionalWith: [],
  conflictsWith: [],
  providesCapabilities: ["forms.submissions"],
  requestedCapabilities: ["ui.register.admin", "api.rest.mount", "data.write.forms"],
  ownsData: ["forms.submissions"],
  extendsData: [],
  slotClaims: [],
  trustTier: "first-party",
  reviewTier: "R1",
  isolationProfile: "same-process-trusted",
  compatibility: {
    framework: "^0.1.0",
    runtime: "bun>=1.3.12",
    db: ["postgres", "sqlite"]
  }
});