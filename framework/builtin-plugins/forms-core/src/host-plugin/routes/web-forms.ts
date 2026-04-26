/** Web Forms REST API.
 *
 *  Authoring routes (auth required):
 *    GET    /                  list forms
 *    POST   /                  create
 *    GET    /:id               fetch one
 *    PATCH  /:id               update
 *    DELETE /:id               delete
 *    GET    /:id/submissions   list inbox
 *
 *  Public routes (NO AUTH — published forms only):
 *    GET    /public/:slug      fetch a published form definition
 *    POST   /public/:slug      submit
 */

import { Hono } from "@gutu-host";
import { requireAuth, currentUser } from "@gutu-host";
import { getTenantContext } from "@gutu-host";
import {
  WebFormError,
  createWebForm,
  deleteWebForm,
  getWebForm,
  getWebFormBySlug,
  listSubmissions,
  listWebForms,
  submitWebForm,
  updateWebForm,
} from "@gutu-plugin/forms-core";

export const webFormsRoutes = new Hono();

function tenantId(): string {
  return getTenantContext()?.tenantId ?? "default";
}

function handle(err: unknown, c: Parameters<Parameters<typeof webFormsRoutes.get>[1]>[0]) {
  if (err instanceof WebFormError) return c.json({ error: err.message, code: err.code }, 400);
  throw err;
}

/* ------- Public, no auth -------------------------------------------------- */

webFormsRoutes.get("/public/:slug", (c) => {
  const f = getWebFormBySlug(tenantId(), c.req.param("slug"));
  if (!f || !f.published) return c.json({ error: "not found" }, 404);
  // Strip authoring-only fields.
  return c.json({
    slug: f.slug,
    title: f.title,
    description: f.description,
    fields: f.fields,
    successMessage: f.successMessage,
    successRedirect: f.successRedirect,
    requireCaptcha: f.requireCaptcha,
  });
});

webFormsRoutes.post("/public/:slug", async (c) => {
  const slug = c.req.param("slug");
  let payload: Record<string, unknown> = {};
  const ct = c.req.header("content-type") ?? "";
  try {
    if (ct.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") obj[k] = v;
      }
      payload = obj;
    } else if (ct.includes("application/json")) {
      payload = (await c.req.json()) as Record<string, unknown>;
    } else {
      payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    }
  } catch {
    return c.json({ error: "invalid payload" }, 400);
  }
  try {
    const out = submitWebForm({
      tenantId: tenantId(),
      slug,
      payload,
      submitterIp: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (out.errors) return c.json({ ok: false, errors: out.errors }, 400);
    return c.json({ ok: true, recordId: out.recordId, submissionId: out.submission.id });
  } catch (err) {
    return handle(err, c) as never;
  }
});

/* ------- Authoring (auth required) --------------------------------------- */

const authed = new Hono();
authed.use("*", requireAuth);

authed.get("/", (c) => c.json({ rows: listWebForms(tenantId()) }));

authed.get("/:id", (c) => {
  const f = getWebForm(tenantId(), c.req.param("id"));
  if (!f) return c.json({ error: "not found" }, 404);
  return c.json(f);
});

authed.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const user = currentUser(c);
  try {
    const f = createWebForm({
      tenantId: tenantId(),
      slug: String(body.slug ?? ""),
      title: String(body.title ?? ""),
      description: typeof body.description === "string" ? body.description : undefined,
      targetResource: String(body.targetResource ?? ""),
      fields: Array.isArray(body.fields) ? (body.fields as never) : [],
      successMessage: typeof body.successMessage === "string" ? body.successMessage : undefined,
      successRedirect: typeof body.successRedirect === "string" ? body.successRedirect : undefined,
      published: body.published === true,
      requireCaptcha: body.requireCaptcha === true,
      createdBy: user.email,
    });
    return c.json(f, 201);
  } catch (err) {
    return handle(err, c) as never;
  }
});

authed.patch("/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as never;
  try {
    const f = updateWebForm(tenantId(), c.req.param("id"), body);
    if (!f) return c.json({ error: "not found" }, 404);
    return c.json(f);
  } catch (err) {
    return handle(err, c) as never;
  }
});

authed.delete("/:id", (c) => {
  const ok = deleteWebForm(tenantId(), c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

authed.get("/:id/submissions", (c) =>
  c.json({
    rows: listSubmissions({
      tenantId: tenantId(),
      formId: c.req.param("id"),
      status: (c.req.query("status") as never) ?? undefined,
      limit: c.req.query("limit") ? Math.min(Number(c.req.query("limit")), 1000) : undefined,
    }),
  }),
);

webFormsRoutes.route("/", authed);
