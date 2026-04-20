import { definePolicy } from "@platform/permissions";

export const formsPolicy = definePolicy({
  id: "forms-core.default",
  rules: [
    {
      permission: "forms.submissions.read",
      allowIf: ["role:admin", "role:operator"]
    },
    {
      permission: "forms.submissions.submit",
      allowIf: ["role:admin"],
      requireReason: true,
      audit: true
    }
  ]
});