/** Property-setter REST API.
 *
 *  Routes:
 *    GET    /                         all overrides for the tenant
 *    GET    /:resource                overrides for one resource
 *    GET    /:resource/effective      resolved (priority-applied) per-field map
 *    POST   /:resource                upsert one override
 *    DELETE /:resource/:id            remove one override
 *
 *  Auth: any authenticated tenant member can read; mutations require a
 *  user with role admin (placeholder until role gating is wired). */
import { Hono } from "@gutu-host";
import { requireAuth, currentUser } from "@gutu-host";
import { getTenantContext } from "@gutu-host";
import {
  PROPERTY_NAMES,
  PropertySetterError,
  deletePropertySetter,
  listPropertySetters,
  resolvePropertyOverrides,
  upsertPropertySetter,
} from "@gutu-plugin/forms-core";
import { recordAudit } from "@gutu-host";

export const propertySetterRoutes = new Hono();
propertySetterRoutes.use("*", requireAuth);

function tenantId(): string {
  return getTenantContext()?.tenantId ?? "default";
}

propertySetterRoutes.get("/", (c) => {
  return c.json({ rows: listPropertySetters(tenantId()) });
});

propertySetterRoutes.get("/properties", (c) => {
  return c.json({ properties: PROPERTY_NAMES });
});

propertySetterRoutes.get("/:resource", (c) => {
  return c.json({ rows: listPropertySetters(tenantId(), c.req.param("resource")) });
});

propertySetterRoutes.get("/:resource/effective", (c) => {
  const overrides = resolvePropertyOverrides({
    tenantId: tenantId(),
    resource: c.req.param("resource"),
    companyId: c.req.query("company") ?? undefined,
    roleIds: c.req.query("roles")?.split(",").filter(Boolean),
  });
  return c.json({ overrides });
});

propertySetterRoutes.post("/:resource", async (c) => {
  const resource = c.req.param("resource");
  const body = (await c.req.json().catch(() => ({}))) as {
    field?: string;
    property?: string;
    value?: unknown;
    scope?: string;
    reason?: string;
  };
  if (!body.field || !body.property || body.value === undefined) {
    return c.json(
      { error: "field, property, value are required", code: "invalid-argument" },
      400,
    );
  }
  const user = currentUser(c);
  try {
    const setter = upsertPropertySetter({
      tenantId: tenantId(),
      resource,
      field: body.field,
      property: body.property,
      value: body.value,
      scope: body.scope,
      reason: body.reason ?? null,
      createdBy: user.email,
    });
    recordAudit({
      actor: user.email,
      action: "property-setter.upserted",
      resource: "property-setter",
      recordId: setter.id,
      payload: {
        resource,
        field: body.field,
        property: body.property,
        scope: body.scope ?? "tenant",
      },
    });
    return c.json(setter, 200);
  } catch (err) {
    if (err instanceof PropertySetterError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    throw err;
  }
});

propertySetterRoutes.delete("/:resource/:id", (c) => {
  const id = c.req.param("id");
  const ok = deletePropertySetter(tenantId(), id);
  if (!ok) return c.json({ error: "not found" }, 404);
  const user = currentUser(c);
  recordAudit({
    actor: user.email,
    action: "property-setter.deleted",
    resource: "property-setter",
    recordId: id,
  });
  return c.json({ ok: true });
});
