/** Web Forms — public-facing forms that submit to a target resource.
 *
 *  Storage: web_forms (definition) + web_form_submissions (inbox).
 *  Submissions can be configured to:
 *    - directly create a record on the target resource (typical CRM
 *      lead capture), or
 *    - just sit in the inbox waiting for staff review (when an agent
 *      should classify or de-dupe before promotion).
 *
 *  Field shape (`fields` on the form):
 *    {
 *      name: 'email',                     // target field key
 *      label: 'Email',
 *      kind: 'text'|'email'|'phone'|'long-text'|'number'|'select'|'checkbox',
 *      required?: boolean,
 *      options?: Array<{value, label}>,
 *      placeholder?: string,
 *      helpText?: string,
 *    }
 *
 *  Public submit endpoint accepts JSON or multipart-form-data, runs the
 *  field validators, optionally rate-limits by IP, and either persists
 *  to the inbox + creates the record, or just persists to the inbox.
 */

import { db, nowIso } from "@gutu-host";
import { uuid } from "@gutu-host";
import { recordAudit } from "@gutu-host";
import { fireEvent } from "@gutu-plugin/notifications-core";

export type WebFormFieldKind =
  | "text"
  | "email"
  | "phone"
  | "long-text"
  | "number"
  | "select"
  | "checkbox"
  | "url"
  | "date";

export interface WebFormField {
  name: string;
  label: string;
  kind: WebFormFieldKind;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  helpText?: string;
  /** Maximum characters for text/long-text. */
  maxLength?: number;
}

export interface WebForm {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  description: string | null;
  targetResource: string;
  fields: WebFormField[];
  successMessage: string | null;
  successRedirect: string | null;
  published: boolean;
  requireCaptcha: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebFormSubmission {
  id: string;
  tenantId: string;
  formId: string;
  payload: Record<string, unknown>;
  recordId: string | null;
  submitterIp: string | null;
  userAgent: string | null;
  status: "pending" | "accepted" | "rejected";
  reason: string | null;
  createdAt: string;
}

export class WebFormError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "WebFormError";
  }
}

interface FormRow {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  description: string | null;
  target_resource: string;
  fields: string;
  success_message: string | null;
  success_redirect: string | null;
  published: number;
  require_captcha: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SubmissionRow {
  id: string;
  tenant_id: string;
  form_id: string;
  payload: string;
  record_id: string | null;
  submitter_ip: string | null;
  user_agent: string | null;
  status: "pending" | "accepted" | "rejected";
  reason: string | null;
  created_at: string;
}

function rowToForm(r: FormRow): WebForm {
  let fields: WebFormField[] = [];
  try {
    fields = JSON.parse(r.fields) as WebFormField[];
  } catch { /* tolerate */ }
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    targetResource: r.target_resource,
    fields,
    successMessage: r.success_message,
    successRedirect: r.success_redirect,
    published: r.published === 1,
    requireCaptcha: r.require_captcha === 1,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToSubmission(r: SubmissionRow): WebFormSubmission {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(r.payload) as Record<string, unknown>; } catch { /* tolerate */ }
  return {
    id: r.id,
    tenantId: r.tenant_id,
    formId: r.form_id,
    payload,
    recordId: r.record_id,
    submitterIp: r.submitter_ip,
    userAgent: r.user_agent,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at,
  };
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface CreateFormArgs {
  tenantId: string;
  slug: string;
  title: string;
  description?: string;
  targetResource: string;
  fields: WebFormField[];
  successMessage?: string;
  successRedirect?: string;
  published?: boolean;
  requireCaptcha?: boolean;
  createdBy: string;
}

export function createWebForm(args: CreateFormArgs): WebForm {
  if (!SLUG_RE.test(args.slug))
    throw new WebFormError("invalid-slug", "slug must be lowercase letters/digits/dashes, 1–64 chars");
  if (!args.fields || args.fields.length === 0)
    throw new WebFormError("invalid", "Form must have at least one field");
  for (const f of args.fields) {
    if (!f.name || !f.label) throw new WebFormError("invalid", "Field needs name + label");
    if ((f.kind === "select") && (!f.options || f.options.length === 0))
      throw new WebFormError("invalid", `Select field "${f.name}" needs options`);
  }
  const id = uuid();
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO web_forms
         (id, tenant_id, slug, title, description, target_resource, fields,
          success_message, success_redirect, published, require_captcha,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      args.tenantId,
      args.slug,
      args.title,
      args.description ?? null,
      args.targetResource,
      JSON.stringify(args.fields),
      args.successMessage ?? null,
      args.successRedirect ?? null,
      args.published ? 1 : 0,
      args.requireCaptcha ? 1 : 0,
      args.createdBy,
      now,
      now,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message))
      throw new WebFormError("duplicate", `slug "${args.slug}" already in use`);
    throw err;
  }
  return getWebForm(args.tenantId, id)!;
}

export function getWebForm(tenantId: string, id: string): WebForm | null {
  const r = db
    .prepare(`SELECT * FROM web_forms WHERE id = ? AND tenant_id = ?`)
    .get(id, tenantId) as FormRow | undefined;
  return r ? rowToForm(r) : null;
}

export function getWebFormBySlug(tenantId: string, slug: string): WebForm | null {
  const r = db
    .prepare(`SELECT * FROM web_forms WHERE slug = ? AND tenant_id = ?`)
    .get(slug, tenantId) as FormRow | undefined;
  return r ? rowToForm(r) : null;
}

export function listWebForms(tenantId: string): WebForm[] {
  const rows = db
    .prepare(`SELECT * FROM web_forms WHERE tenant_id = ? ORDER BY title ASC`)
    .all(tenantId) as FormRow[];
  return rows.map(rowToForm);
}

export function updateWebForm(
  tenantId: string,
  id: string,
  patch: Partial<Omit<CreateFormArgs, "tenantId" | "createdBy" | "slug">>,
): WebForm | null {
  const existing = getWebForm(tenantId, id);
  if (!existing) return null;
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) { fields.push("title = ?"); params.push(patch.title); }
  if (patch.description !== undefined) { fields.push("description = ?"); params.push(patch.description); }
  if (patch.targetResource !== undefined) { fields.push("target_resource = ?"); params.push(patch.targetResource); }
  if (patch.fields !== undefined) { fields.push("fields = ?"); params.push(JSON.stringify(patch.fields)); }
  if (patch.successMessage !== undefined) { fields.push("success_message = ?"); params.push(patch.successMessage); }
  if (patch.successRedirect !== undefined) { fields.push("success_redirect = ?"); params.push(patch.successRedirect); }
  if (patch.published !== undefined) { fields.push("published = ?"); params.push(patch.published ? 1 : 0); }
  if (patch.requireCaptcha !== undefined) { fields.push("require_captcha = ?"); params.push(patch.requireCaptcha ? 1 : 0); }
  if (fields.length === 0) return existing;
  fields.push("updated_at = ?");
  params.push(nowIso());
  params.push(id);
  db.prepare(`UPDATE web_forms SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getWebForm(tenantId, id);
}

export function deleteWebForm(tenantId: string, id: string): boolean {
  const r = db.prepare(`DELETE FROM web_forms WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
  return r.changes > 0;
}

/* ----------------------------- Submission -------------------------------- */

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

interface ValidateResult {
  ok: boolean;
  errors: Record<string, string>;
  cleaned: Record<string, unknown>;
}

function validateSubmission(form: WebForm, payload: Record<string, unknown>): ValidateResult {
  const errors: Record<string, string> = {};
  const cleaned: Record<string, unknown> = {};
  for (const f of form.fields) {
    const raw = payload[f.name];
    if (raw === undefined || raw === null || raw === "") {
      if (f.required) errors[f.name] = `${f.label} is required`;
      continue;
    }
    switch (f.kind) {
      case "text":
      case "long-text":
      case "phone":
      case "url":
      case "email": {
        if (typeof raw !== "string") {
          errors[f.name] = `${f.label} must be a string`;
          break;
        }
        let v = raw.trim();
        if (f.maxLength && v.length > f.maxLength) v = v.slice(0, f.maxLength);
        if (f.kind === "email" && !SIMPLE_EMAIL_RE.test(v)) errors[f.name] = `${f.label} is not a valid email`;
        if (f.kind === "url" && !URL_RE.test(v)) errors[f.name] = `${f.label} is not a valid URL`;
        cleaned[f.name] = v;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) errors[f.name] = `${f.label} must be numeric`;
        else cleaned[f.name] = n;
        break;
      }
      case "checkbox":
        cleaned[f.name] = raw === true || raw === "true" || raw === "on" || raw === 1;
        break;
      case "select":
        if (!(f.options ?? []).some((o) => o.value === raw))
          errors[f.name] = `${f.label} must be one of ${(f.options ?? []).map((o) => o.value).join(", ")}`;
        else cleaned[f.name] = raw;
        break;
      case "date":
        if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(raw))
          errors[f.name] = `${f.label} must be an ISO date`;
        else cleaned[f.name] = raw.slice(0, 10);
        break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, cleaned };
}

export interface SubmitArgs {
  tenantId: string;
  slug: string;
  payload: Record<string, unknown>;
  submitterIp?: string;
  userAgent?: string;
  /** When false, don't create a record — just record submission. */
  createRecord?: boolean;
}

export function submitWebForm(args: SubmitArgs): {
  submission: WebFormSubmission;
  errors?: Record<string, string>;
  recordId?: string;
} {
  const form = getWebFormBySlug(args.tenantId, args.slug);
  if (!form) throw new WebFormError("not-found", "Web form not found");
  if (!form.published) throw new WebFormError("unpublished", "Form is not published");
  const validated = validateSubmission(form, args.payload);
  if (!validated.ok) {
    const id = uuid();
    db.prepare(
      `INSERT INTO web_form_submissions
         (id, tenant_id, form_id, payload, record_id, submitter_ip, user_agent, status, reason, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'rejected', ?, ?)`,
    ).run(
      id,
      args.tenantId,
      form.id,
      JSON.stringify(args.payload),
      args.submitterIp ?? null,
      args.userAgent ?? null,
      JSON.stringify(validated.errors).slice(0, 500),
      nowIso(),
    );
    const submission = getSubmission(args.tenantId, id)!;
    return { submission, errors: validated.errors };
  }

  const submissionId = uuid();
  let recordId: string | null = null;
  const now = nowIso();
  const tx = db.transaction(() => {
    if (args.createRecord !== false) {
      recordId = uuid();
      const record = {
        ...validated.cleaned,
        id: recordId,
        tenantId: args.tenantId,
        createdBy: `web-form:${form.id}`,
        source: { kind: "web-form", formId: form.id, slug: form.slug },
      };
      db.prepare(
        `INSERT INTO records (resource, id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(form.targetResource, recordId, JSON.stringify(record), now, now);
    }
    db.prepare(
      `INSERT INTO web_form_submissions
         (id, tenant_id, form_id, payload, record_id, submitter_ip, user_agent, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', NULL, ?)`,
    ).run(
      submissionId,
      args.tenantId,
      form.id,
      JSON.stringify(validated.cleaned),
      recordId,
      args.submitterIp ?? null,
      args.userAgent ?? null,
      now,
    );
  });
  tx();
  recordAudit({
    actor: `web-form:${form.id}`,
    action: "web-form.submitted",
    resource: "web-form-submission",
    recordId: submissionId,
    payload: { formId: form.id, slug: form.slug, recordId },
  });
  if (recordId) {
    try {
      fireEvent({
        tenantId: args.tenantId,
        resource: form.targetResource,
        event: "create",
        recordId,
        record: { ...validated.cleaned, id: recordId } as Record<string, unknown>,
      });
    } catch (err) {
      console.error("[web-form] notification fire failed", err);
    }
  }
  const submission = getSubmission(args.tenantId, submissionId)!;
  return { submission, recordId: recordId ?? undefined };
}

export function getSubmission(tenantId: string, id: string): WebFormSubmission | null {
  const r = db
    .prepare(`SELECT * FROM web_form_submissions WHERE id = ? AND tenant_id = ?`)
    .get(id, tenantId) as SubmissionRow | undefined;
  return r ? rowToSubmission(r) : null;
}

export function listSubmissions(args: {
  tenantId: string;
  formId?: string;
  status?: "pending" | "accepted" | "rejected";
  limit?: number;
}): WebFormSubmission[] {
  const conditions: string[] = ["tenant_id = ?"];
  const params: unknown[] = [args.tenantId];
  if (args.formId) {
    conditions.push("form_id = ?");
    params.push(args.formId);
  }
  if (args.status) {
    conditions.push("status = ?");
    params.push(args.status);
  }
  const rows = db
    .prepare(
      `SELECT * FROM web_form_submissions WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, args.limit ?? 200) as SubmissionRow[];
  return rows.map(rowToSubmission);
}
