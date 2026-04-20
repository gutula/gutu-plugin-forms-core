import { defineAction } from "@platform/schema";
import { z } from "zod";
import { submitFormSubmission } from "../services/main.service";

export const submitFormSubmissionAction = defineAction({
  id: "forms.submissions.submit",
  input: z.object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    reason: z.string().min(3).optional()
  }),
  output: z.object({
    ok: z.literal(true),
    nextStatus: z.enum(["active", "inactive"])
  }),
  permission: "forms.submissions.submit",
  idempotent: true,
  audit: true,
  handler: ({ input }) => submitFormSubmission(input)
});