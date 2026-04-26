/** Property-setters runtime helpers.
 *
 *  Property setters override one *property* of a built-in or custom
 *  field on a resource — without forking schemas. Mirrors Frappe's
 *  Property Setter doctype, with our scoping (tenant, optionally
 *  company:<id> or role:<id>) baked in.
 *
 *  Storage: rows in `property_setters`. Reads return a single
 *  effective override per (resource, field, property) by picking the
 *  highest-priority scope for the request context (role > company >
 *  tenant). Writes are upserts keyed on the unique tuple.
 *
 *  Trade-offs vs runtime field-metadata (custom fields):
 *    + Property setters keep type contracts intact (overrides are
 *      property-only, not new fields).
 *    + Composes cleanly with custom fields: a field that's tagged
 *      required by metadata can be overridden to non-required by a
 *      property setter without losing the underlying definition.
 *    - Doesn't add storage. Pure metadata layer; no DDL ever needed. */

import { db, nowIso } from "@gutu-host";
import { uuid } from "@gutu-host";

/** All built-in field properties that can be overridden. Adding a new
 *  property is a single entry here + one switch case in `applyToDescriptor`. */
export type PropertyName =
  | "label"
  | "required"
  | "readonly"
  | "hidden"
  | "helpText"
  | "defaultValue"
  | "options"
  | "section"
  | "position"
  | "printHidden"
  | "portalHidden";

export const PROPERTY_NAMES: readonly PropertyName[] = [
  "label",
  "required",
  "readonly",
  "hidden",
  "helpText",
  "defaultValue",
  "options",
  "section",
  "position",
  "printHidden",
  "portalHidden",
];

/** Validation: which value shapes are accepted per property. Keeps the
 *  admin UI honest and prevents nonsense overrides reaching the renderer. */
const PROPERTY_VALUE_KIND: Record<PropertyName, "string" | "boolean" | "number" | "any"> = {
  label: "string",
  required: "boolean",
  readonly: "boolean",
  hidden: "boolean",
  helpText: "string",
  defaultValue: "any",
  options: "any",
  section: "string",
  position: "number",
  printHidden: "boolean",
  portalHidden: "boolean",
};

export interface PropertySetter {
  id: string;
  tenantId: string;
  resource: string;
  field: string;
  property: PropertyName;
  value: unknown;
  scope: string;
  reason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  resource: string;
  field: string;
  property: string;
  value: string;
  scope: string;
  reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class PropertySetterError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PropertySetterError";
  }
}

function rowToObj(r: Row): PropertySetter {
  let value: unknown;
  try {
    value = JSON.parse(r.value);
  } catch {
    value = r.value;
  }
  return {
    id: r.id,
    tenantId: r.tenant_id,
    resource: r.resource,
    field: r.field,
    property: r.property as PropertyName,
    value,
    scope: r.scope,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function validateProperty(name: string): PropertyName {
  if (!PROPERTY_NAMES.includes(name as PropertyName)) {
    throw new PropertySetterError("invalid-property", `Unknown property "${name}"`);
  }
  return name as PropertyName;
}

function validateValue(property: PropertyName, value: unknown): void {
  const kind = PROPERTY_VALUE_KIND[property];
  if (kind === "any") return;
  if (kind === "string" && typeof value !== "string") {
    throw new PropertySetterError("invalid-value", `Property "${property}" expects a string`);
  }
  if (kind === "boolean" && typeof value !== "boolean") {
    throw new PropertySetterError("invalid-value", `Property "${property}" expects a boolean`);
  }
  if (kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new PropertySetterError("invalid-value", `Property "${property}" expects a number`);
  }
}

const VALID_SCOPE_RE = /^(tenant|company:[a-zA-Z0-9_-]+|role:[a-zA-Z0-9_-]+|pack:[a-zA-Z0-9_-]+)$/;

function validateScope(scope: string): void {
  if (!VALID_SCOPE_RE.test(scope)) {
    throw new PropertySetterError(
      "invalid-scope",
      "Scope must be 'tenant', 'company:<id>', 'role:<id>', or 'pack:<id>'",
    );
  }
}

const VALID_FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_.]{0,127}$/;

function validateField(field: string): void {
  if (!VALID_FIELD_RE.test(field)) {
    throw new PropertySetterError("invalid-field", "Field name must be a valid identifier");
  }
}

export function listPropertySetters(tenantId: string, resource?: string): PropertySetter[] {
  const rows = resource
    ? (db
        .prepare(
          `SELECT * FROM property_setters WHERE tenant_id = ? AND resource = ?
           ORDER BY field ASC, property ASC, scope ASC`,
        )
        .all(tenantId, resource) as Row[])
    : (db
        .prepare(
          `SELECT * FROM property_setters WHERE tenant_id = ?
           ORDER BY resource ASC, field ASC, property ASC`,
        )
        .all(tenantId) as Row[]);
  return rows.map(rowToObj);
}

export interface UpsertArgs {
  tenantId: string;
  resource: string;
  field: string;
  property: string;
  value: unknown;
  scope?: string;
  reason?: string | null;
  createdBy: string;
}

/** Upsert by (tenant, resource, field, property, scope). The unique
 *  constraint guarantees one row per logical override. */
export function upsertPropertySetter(args: UpsertArgs): PropertySetter {
  const property = validateProperty(args.property);
  validateValue(property, args.value);
  validateField(args.field);
  const scope = args.scope ?? "tenant";
  validateScope(scope);

  const now = nowIso();
  const valueJson = JSON.stringify(args.value);
  const existing = db
    .prepare(
      `SELECT * FROM property_setters
       WHERE tenant_id = ? AND resource = ? AND field = ? AND property = ? AND scope = ?`,
    )
    .get(args.tenantId, args.resource, args.field, property, scope) as Row | undefined;
  if (existing) {
    db.prepare(
      `UPDATE property_setters
       SET value = ?, reason = ?, updated_at = ?
       WHERE id = ?`,
    ).run(valueJson, args.reason ?? null, now, existing.id);
    const row = db.prepare(`SELECT * FROM property_setters WHERE id = ?`).get(existing.id) as Row;
    return rowToObj(row);
  }
  const id = uuid();
  db.prepare(
    `INSERT INTO property_setters
       (id, tenant_id, resource, field, property, value, scope, reason, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    args.tenantId,
    args.resource,
    args.field,
    property,
    valueJson,
    scope,
    args.reason ?? null,
    args.createdBy,
    now,
    now,
  );
  const row = db.prepare(`SELECT * FROM property_setters WHERE id = ?`).get(id) as Row;
  return rowToObj(row);
}

export function deletePropertySetter(tenantId: string, id: string): boolean {
  const r = db
    .prepare(`DELETE FROM property_setters WHERE id = ? AND tenant_id = ?`)
    .run(id, tenantId);
  return r.changes > 0;
}

export interface ResolveContext {
  tenantId: string;
  resource: string;
  /** Optional richer scoping. When provided, role/company overrides
   *  beat tenant overrides. */
  companyId?: string;
  roleIds?: string[];
}

export interface FieldOverrides {
  /** Map of property → value. */
  [property: string]: unknown;
}

/** Resolve effective overrides: returns a map { fieldName → { property → value } }.
 *  Priority: role > company > tenant. Equal-priority conflicts are
 *  resolved by latest `updated_at` wins. */
export function resolvePropertyOverrides(ctx: ResolveContext): Record<string, FieldOverrides> {
  const rows = db
    .prepare(
      `SELECT * FROM property_setters
       WHERE tenant_id = ? AND resource = ?
       ORDER BY updated_at ASC`,
    )
    .all(ctx.tenantId, ctx.resource) as Row[];
  const out: Record<string, FieldOverrides> = {};
  // Stash with priority so higher overrides later writes.
  const seen: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const setter = rowToObj(r);
    const priority = scopePriority(setter.scope, ctx);
    if (priority === -1) continue; // out of scope
    const fieldKey = setter.field;
    out[fieldKey] = out[fieldKey] ?? {};
    seen[fieldKey] = seen[fieldKey] ?? {};
    const prev = seen[fieldKey][setter.property] ?? -1;
    if (priority >= prev) {
      out[fieldKey][setter.property] = setter.value;
      seen[fieldKey][setter.property] = priority;
    }
  }
  return out;
}

function scopePriority(scope: string, ctx: ResolveContext): number {
  if (scope === "tenant") return 1;
  if (scope.startsWith("company:")) {
    const id = scope.slice("company:".length);
    return ctx.companyId === id ? 2 : -1;
  }
  if (scope.startsWith("role:")) {
    const id = scope.slice("role:".length);
    return ctx.roleIds?.includes(id) ? 3 : -1;
  }
  if (scope.startsWith("pack:")) return 0;
  return -1;
}
