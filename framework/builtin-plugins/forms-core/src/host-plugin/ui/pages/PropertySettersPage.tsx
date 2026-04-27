/** Settings → Property setters page.
 *
 *  Tenant-level overrides of *built-in* field properties on any resource.
 *  Mirrors Frappe's Property Setter doctype: instead of forking a schema,
 *  override exactly one property of one field — label, required, hidden,
 *  readonly, defaultValue, helpText, options, position, printHidden, or
 *  portalHidden — with optional scope (tenant / company:<id> / role:<id>).
 *
 *  Backend: admin-panel/backend/src/routes/property-setters.ts (REST CRUD).
 *  Renderer integration: usePropertySetters() exposes effective overrides;
 *  applyOverrides() folds them into FieldDescriptor lists at render time.
 */

import * as React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Search,
  Settings2,
} from "lucide-react";

import { PageHeader } from "@/admin-primitives/PageHeader";
import { Card, CardContent } from "@/admin-primitives/Card";
import { EmptyState } from "@/admin-primitives/EmptyState";
import { useMergedUiResources } from "@/runtime/useUiMetadata";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Switch } from "@/primitives/Switch";
import { Label } from "@/primitives/Label";
import { Badge } from "@/primitives/Badge";
import { Spinner } from "@/primitives/Spinner";
import { Textarea } from "@/primitives/Textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/primitives/Dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/primitives/Select";
import {
  type PropertySetter,
  usePropertySetterList,
  bumpPropertySetterList,
  upsertPropertySetterApi,
  deletePropertySetterApi,
} from "@/runtime/useCustomizationApi";
import { bumpPropertySetters } from "@/runtime/usePropertySetters";
import { cn } from "@/lib/cn";

type PropertyName =
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

const PROPERTIES: ReadonlyArray<{
  value: PropertyName;
  label: string;
  description: string;
  kind: "string" | "boolean" | "number" | "json";
}> = [
  { value: "label",        label: "Label",         description: "Override the field's display label.",          kind: "string"  },
  { value: "required",     label: "Required",      description: "Override required-ness on this resource.",     kind: "boolean" },
  { value: "readonly",     label: "Read-only",     description: "Lock the field on this resource.",             kind: "boolean" },
  { value: "hidden",       label: "Hidden",        description: "Hide the field on forms / lists / details.",   kind: "boolean" },
  { value: "helpText",     label: "Help text",     description: "Replace or set the help text shown below.",    kind: "string"  },
  { value: "defaultValue", label: "Default value", description: "Override the default applied on create.",      kind: "json"    },
  { value: "options",      label: "Options",       description: "Override select/multiselect option list.",     kind: "json"    },
  { value: "section",      label: "Section",       description: "Move the field into a different section.",     kind: "string"  },
  { value: "position",     label: "Position",      description: "Numeric position within its section.",         kind: "number"  },
  { value: "printHidden",  label: "Print hidden",  description: "Exclude from print formats.",                  kind: "boolean" },
  { value: "portalHidden", label: "Portal hidden", description: "Exclude from public portal views.",            kind: "boolean" },
];

const SCOPES: ReadonlyArray<{ value: string; label: string; description: string }> = [
  { value: "tenant", label: "Tenant", description: "Default scope — applies to everyone in this workspace." },
  { value: "company", label: "Per company", description: "Apply only to a specific company id." },
  { value: "role", label: "Per role", description: "Apply only when the viewer has a specific role." },
];

interface ResourceDescriptor {
  id: string;
  label: string;
  group: "builtin" | "documents";
  category?: string;
}

const RESOURCES: readonly ResourceDescriptor[] = [
  { id: "crm.contact", label: "Contacts", group: "builtin", category: "Sales & CRM" },
  { id: "crm.lead", label: "Leads", group: "builtin", category: "Sales & CRM" },
  { id: "crm.opportunity", label: "Opportunities", group: "builtin", category: "Sales & CRM" },
  { id: "crm.task", label: "Tasks", group: "builtin", category: "Sales & CRM" },
  { id: "crm.call", label: "Calls", group: "builtin", category: "Sales & CRM" },
  { id: "sales.deal", label: "Deals", group: "builtin", category: "Sales & CRM" },
  { id: "sales.quote", label: "Quotes", group: "builtin", category: "Sales & CRM" },
  { id: "sales.order", label: "Sales orders", group: "builtin", category: "Sales & CRM" },
  { id: "accounting.invoice", label: "Invoices", group: "builtin", category: "Accounting" },
  { id: "accounting.bill", label: "Bills", group: "builtin", category: "Accounting" },
  { id: "accounting.payment", label: "Payments", group: "builtin", category: "Accounting" },
  { id: "inventory.item", label: "Items", group: "builtin", category: "Inventory" },
  { id: "inventory.warehouse", label: "Warehouses", group: "builtin", category: "Inventory" },
  { id: "ops.ticket", label: "Tickets", group: "builtin", category: "Operations" },
  { id: "ops.project", label: "Projects", group: "builtin", category: "Operations" },
  { id: "hr.employee", label: "Employees", group: "builtin", category: "People" },
  { id: "spreadsheet.workbook", label: "Spreadsheets", group: "documents" },
  { id: "document.page", label: "Documents", group: "documents" },
  { id: "slides.deck", label: "Slide decks", group: "documents" },
];

function ResourceRail({
  active,
  onPick,
}: {
  active: string;
  onPick: (id: string) => void;
}) {
  const merged = useMergedUiResources<ResourceDescriptor>(
    RESOURCES,
    (r) => ({
      id: r.id,
      label: r.label ?? r.id,
      group: "builtin",
      category: r.group,
    }),
    {
      sortKey: (r) =>
        `${r.group}|${r.category ?? ""}|${r.label.toLowerCase()}|${r.id}`,
    },
  );
  const [search, setSearch] = React.useState("");
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q),
    );
  }, [merged, search]);
  const builtin = filtered.filter((r) => r.group === "builtin");
  const docs = filtered.filter((r) => r.group === "documents");

  const renderGroup = (title: string, rows: readonly ResourceDescriptor[]) => {
    if (rows.length === 0) return null;
    const byCat = new Map<string, ResourceDescriptor[]>();
    for (const r of rows) {
      const k = r.category ?? "";
      const list = byCat.get(k) ?? [];
      list.push(r);
      byCat.set(k, list);
    }
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider text-text-muted px-2 mt-2 mb-0.5">
          {title}
        </div>
        {[...byCat.entries()].map(([cat, list]) => (
          <div key={cat || title} className="flex flex-col gap-0.5">
            {cat ? (
              <div className="text-[11px] text-text-muted px-2 pt-1">{cat}</div>
            ) : null}
            {list.map((r) => {
              const isActive = r.id === active;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onPick(r.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors min-w-0",
                    isActive
                      ? "bg-accent-subtle text-accent font-medium"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-2",
                  )}
                >
                  <span className="min-w-0 truncate">{r.label}</span>
                  <code className={cn("font-mono text-[10px] truncate shrink-0", isActive ? "text-accent/70" : "text-text-muted")}>
                    {r.id}
                  </code>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <aside className="flex flex-col gap-2 min-h-0">
      <Input
        prefix={<Search className="h-3.5 w-3.5" />}
        placeholder="Search resources…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8"
      />
      <div className="flex flex-col gap-0.5 overflow-y-auto -mr-2 pr-2 min-h-0">
        {renderGroup("Built-in", builtin)}
        {renderGroup("Documents", docs)}
        {filtered.length === 0 ? (
          <div className="text-xs text-text-muted px-2 py-2">No resources match.</div>
        ) : null}
      </div>
    </aside>
  );
}

interface DialogProps {
  resource: string;
  initial: PropertySetter | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (s: PropertySetter) => void;
}

function FieldDialog({ resource, initial, open, onOpenChange, onSaved }: DialogProps) {
  const [field, setField] = React.useState("");
  const [property, setProperty] = React.useState<PropertyName>("label");
  const [valueRaw, setValueRaw] = React.useState("");
  const [scopeKind, setScopeKind] = React.useState<"tenant" | "company" | "role">("tenant");
  const [scopeId, setScopeId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      setField(initial.field);
      setProperty(initial.property as PropertyName);
      const valueStr =
        typeof initial.value === "string"
          ? initial.value
          : JSON.stringify(initial.value);
      setValueRaw(valueStr);
      if (initial.scope.startsWith("company:")) {
        setScopeKind("company");
        setScopeId(initial.scope.slice("company:".length));
      } else if (initial.scope.startsWith("role:")) {
        setScopeKind("role");
        setScopeId(initial.scope.slice("role:".length));
      } else {
        setScopeKind("tenant");
        setScopeId("");
      }
      setReason(initial.reason ?? "");
    } else {
      setField("");
      setProperty("label");
      setValueRaw("");
      setScopeKind("tenant");
      setScopeId("");
      setReason("");
    }
    setApiError(null);
  }, [open, initial]);

  const propMeta = PROPERTIES.find((p) => p.value === property)!;
  const fullScope = scopeKind === "tenant" ? "tenant" : `${scopeKind}:${scopeId}`;
  const fieldOk = /^[a-zA-Z_][a-zA-Z0-9_.]{0,127}$/.test(field);
  const valueOk = (() => {
    if (propMeta.kind === "boolean") return valueRaw === "true" || valueRaw === "false";
    if (propMeta.kind === "number") return Number.isFinite(Number(valueRaw));
    if (propMeta.kind === "json") {
      if (!valueRaw.trim()) return false;
      try { JSON.parse(valueRaw); return true; } catch { return false; }
    }
    return valueRaw.length > 0;
  })();
  const scopeOk = scopeKind === "tenant" || /^[a-zA-Z0-9_-]+$/.test(scopeId);
  const canSubmit = fieldOk && valueOk && scopeOk && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setApiError(null);
    try {
      let value: unknown;
      if (propMeta.kind === "boolean") value = valueRaw === "true";
      else if (propMeta.kind === "number") value = Number(valueRaw);
      else if (propMeta.kind === "json") value = JSON.parse(valueRaw);
      else value = valueRaw;
      const saved = await upsertPropertySetterApi(resource, {
        field,
        property,
        value,
        scope: fullScope,
        reason: reason.trim() || undefined,
      });
      onSaved(saved);
      bumpPropertySetters(resource);
      onOpenChange(false);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit override" : "New property override"}</DialogTitle>
          <DialogDescription>
            Override one property of one field on <code className="font-mono">{resource}</code>.
          </DialogDescription>
        </DialogHeader>

        {apiError ? (
          <div className="rounded-md border border-intent-danger/40 bg-intent-danger-bg/30 px-3 py-2 text-sm text-intent-danger flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="flex-1">{apiError}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ps-field" required>Field name</Label>
            <Input
              id="ps-field"
              placeholder="customer_name"
              value={field}
              disabled={!!initial}
              onChange={(e) => setField(e.target.value)}
              className="font-mono"
              invalid={field.length > 0 && !fieldOk}
            />
            <span className="text-xs text-text-muted">
              Built-in or custom field name (e.g. <code className="font-mono">due_date</code>).
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ps-prop" required>Property</Label>
            <Select value={property} onValueChange={(v) => setProperty(v as PropertyName)}>
              <SelectTrigger id="ps-prop">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <div className="flex flex-col">
                      <span>{p.label}</span>
                      <span className="text-xs text-text-muted">{p.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ps-value" required>Value ({propMeta.kind})</Label>
            {propMeta.kind === "boolean" ? (
              <Select value={valueRaw} onValueChange={(v) => setValueRaw(v)}>
                <SelectTrigger id="ps-value">
                  <SelectValue placeholder="true / false" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            ) : propMeta.kind === "json" ? (
              <Textarea
                id="ps-value"
                rows={4}
                placeholder='[{"value":"high","label":"High"}]'
                value={valueRaw}
                onChange={(e) => setValueRaw(e.target.value)}
                className="font-mono text-xs"
                invalid={valueRaw.length > 0 && !valueOk}
              />
            ) : (
              <Input
                id="ps-value"
                placeholder={propMeta.kind === "number" ? "0" : ""}
                value={valueRaw}
                onChange={(e) => setValueRaw(e.target.value)}
                invalid={valueRaw.length > 0 && !valueOk}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ps-scope">Scope</Label>
            <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as never)}>
              <SelectTrigger id="ps-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <div className="flex flex-col">
                      <span>{s.label}</span>
                      <span className="text-xs text-text-muted">{s.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {scopeKind !== "tenant" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ps-scope-id" required>
                {scopeKind === "company" ? "Company id" : "Role id"}
              </Label>
              <Input
                id="ps-scope-id"
                placeholder={scopeKind === "company" ? "company-eu" : "role-finance"}
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="font-mono"
                invalid={scopeId.length > 0 && !scopeOk}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ps-reason">Reason (optional)</Label>
            <Input
              id="ps-reason"
              placeholder="Why this override exists — useful for audits."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={submitting}>
            {initial ? "Save changes" : "Add override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  setter,
  busy,
  onCancel,
  onConfirm,
}: {
  setter: PropertySetter | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!setter} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Remove this override?</DialogTitle>
          <DialogDescription>
            The field will revert to its built-in property value immediately.
            Existing record data is unaffected.
          </DialogDescription>
        </DialogHeader>
        {setter ? (
          <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-sm flex items-center justify-between gap-2">
            <code className="font-mono break-all">{setter.field}.{setter.property}</code>
            <Badge intent="accent">{setter.scope}</Badge>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PropertySettersPage() {
  const [active, setActive] = React.useState<string>(RESOURCES[0]!.id);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PropertySetter | null>(null);
  const [deleting, setDeleting] = React.useState<PropertySetter | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { rows, loading, refresh } = usePropertySetterList(active);

  const handleSaved = (_s: PropertySetter) => {
    void refresh();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deletePropertySetterApi(active, deleting.id);
      bumpPropertySetterList(active);
      bumpPropertySetters(active);
      void refresh();
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const renderValue = (s: PropertySetter): string => {
    if (typeof s.value === "boolean") return s.value ? "true" : "false";
    if (typeof s.value === "string") return s.value;
    return JSON.stringify(s.value);
  };

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <PageHeader
        title="Property setters"
        description="Tenant-scoped overrides of built-in field properties — Frappe-style customization without forking schemas."
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            New override
          </Button>
        }
      />

      {error ? (
        <div className="rounded-md border border-intent-danger/40 bg-intent-danger-bg/30 px-3 py-2 text-sm text-intent-danger flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button className="text-xs underline opacity-80 hover:opacity-100" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[260px_1fr] min-h-0">
        <ResourceRail active={active} onPick={setActive} />
        <main className="flex flex-col gap-3 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-base font-semibold text-text-primary truncate">
                {RESOURCES.find((r) => r.id === active)?.label ?? active}
              </h2>
              <code className="text-xs font-mono text-text-muted truncate">{active}</code>
            </div>
            {rows.length > 0 ? (
              <span className="text-xs text-text-muted">
                {rows.length} {rows.length === 1 ? "override" : "overrides"}
              </span>
            ) : null}
          </div>

          {loading ? (
            <Card>
              <CardContent className="py-12 flex items-center justify-center text-sm text-text-muted">
                <Spinner size={14} />
                <span className="ml-2">Loading…</span>
              </CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<Settings2 className="h-5 w-5" />}
                  title="No overrides yet"
                  description="Add your first override — change one property of one field for this resource without forking the schema."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      iconLeft={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                      }}
                    >
                      New override
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-1 border-b border-border text-xs uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">Field</th>
                      <th className="text-left py-2 font-medium">Property</th>
                      <th className="text-left py-2 font-medium">Value</th>
                      <th className="text-left py-2 font-medium w-32">Scope</th>
                      <th className="text-right py-2 pr-3 font-medium w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-border-subtle last:border-b-0 hover:bg-surface-1 transition-colors"
                      >
                        <td className="py-2 px-3 align-middle">
                          <code className="font-mono text-xs text-text-primary">{s.field}</code>
                        </td>
                        <td className="py-2 align-middle">
                          <Badge intent="accent" className="font-normal">{s.property}</Badge>
                        </td>
                        <td className="py-2 align-middle">
                          <code className="font-mono text-xs text-text-secondary break-all">{renderValue(s)}</code>
                        </td>
                        <td className="py-2 align-middle">
                          <Badge intent={s.scope === "tenant" ? "neutral" : "info"} className="font-normal">
                            {s.scope}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 align-middle">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setEditing(s);
                                setDialogOpen(true);
                              }}
                              iconLeft={<Pencil className="h-3 w-3" />}
                            >
                              Edit
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setDeleting(s)}
                              iconLeft={<Trash2 className="h-3 w-3" />}
                              className="text-intent-danger hover:bg-intent-danger-bg/30"
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </main>
      </div>

      <FieldDialog
        resource={active}
        initial={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={handleSaved}
      />
      <DeleteDialog
        setter={deleting}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
