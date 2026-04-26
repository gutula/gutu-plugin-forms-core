/** Settings → Custom fields page.
 *
 *  Per-resource editor for tenant-defined custom fields. Backend lives in
 *  admin-panel/backend/src/routes/field-metadata.ts and uses the lightweight
 *  metadata-driven schema described in lib/field-metadata.ts: rows in
 *  `field_metadata` get merged into the descriptors the frontend uses for
 *  forms, lists, and filters. Adding/removing/editing a field is a single
 *  REST call; values stay inline in `records.data` so removal never deletes
 *  user data.
 *
 *  Layout: left rail of resources (grouped Built-in / Documents) +
 *  main pane with a sortable table of fields, an "Add field" dialog,
 *  and per-row Edit/Delete actions. Reordering is a drag handle (dnd-kit)
 *  that PATCHes `position` on drop. */

import * as React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  AlertTriangle,
  Sparkles,
  Search,
  X,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { PageHeader } from "@/admin-primitives/PageHeader";
import { Card, CardContent } from "@/admin-primitives/Card";
import { EmptyState } from "@/admin-primitives/EmptyState";
import { Button } from "@/primitives/Button";
import { Input } from "@/primitives/Input";
import { Textarea } from "@/primitives/Textarea";
import { Switch } from "@/primitives/Switch";
import { Label } from "@/primitives/Label";
import { Badge } from "@/primitives/Badge";
import { Spinner } from "@/primitives/Spinner";
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
import { authStore } from "@/runtime/auth";
import { cn } from "@/lib/cn";

/* ----------------------------- types ------------------------------------- */

type FieldKind =
  | "text"
  | "long-text"
  | "rich-text"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "multiselect"
  | "email"
  | "phone"
  | "url"
  | "relation"
  | "json";

interface FieldOptions {
  options?: Array<{ value: string; label: string; color?: string }>;
  currency?: string;
  relationTarget?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  format?: string;
  defaultValue?: unknown;
  helpText?: string;
  group?: string;
}

interface FieldMeta {
  id: string;
  tenantId: string;
  resource: string;
  key: string;
  label: string;
  kind: FieldKind;
  options: FieldOptions;
  required: boolean;
  indexed: boolean;
  position: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------- constants --------------------------------- */

interface ResourceDescriptor {
  id: string;
  label: string;
  group: "builtin" | "documents";
  /** Optional grouping inside the rail (e.g. "Sales & CRM"). */
  category?: string;
}

/** Hardcoded resource list. Replace with a registry lookup once one
 *  exists; the page is intentionally tolerant of unknown resources
 *  passed via the URL hash. */
const RESOURCES: readonly ResourceDescriptor[] = [
  // Built-in CRM
  { id: "crm.contact", label: "Contacts", group: "builtin", category: "Sales & CRM" },
  { id: "crm.lead", label: "Leads", group: "builtin", category: "Sales & CRM" },
  { id: "crm.opportunity", label: "Opportunities", group: "builtin", category: "Sales & CRM" },
  { id: "crm.task", label: "Tasks", group: "builtin", category: "Sales & CRM" },
  { id: "crm.call", label: "Calls", group: "builtin", category: "Sales & CRM" },
  { id: "sales.deal", label: "Deals", group: "builtin", category: "Sales & CRM" },
  { id: "sales.quote", label: "Quotes", group: "builtin", category: "Sales & CRM" },
  // Built-in Operations
  { id: "ops.ticket", label: "Tickets", group: "builtin", category: "Operations" },
  { id: "ops.project", label: "Projects", group: "builtin", category: "Operations" },
  // People
  { id: "hr.employee", label: "Employees", group: "builtin", category: "People" },
  // Documents
  { id: "spreadsheet.workbook", label: "Spreadsheets", group: "documents" },
  { id: "document.page", label: "Documents", group: "documents" },
  { id: "slides.deck", label: "Slide decks", group: "documents" },
  { id: "collab.page", label: "Collab pages", group: "documents" },
  { id: "whiteboard.canvas", label: "Whiteboards", group: "documents" },
];

const FIELD_KIND_OPTIONS: ReadonlyArray<{ value: FieldKind; label: string; description: string }> = [
  { value: "text", label: "Text", description: "Single-line string." },
  { value: "long-text", label: "Long text", description: "Multi-line plain text." },
  { value: "rich-text", label: "Rich text", description: "Formatted HTML/Markdown." },
  { value: "number", label: "Number", description: "Numeric value with min/max." },
  { value: "currency", label: "Currency", description: "Number tagged with an ISO currency." },
  { value: "boolean", label: "Boolean", description: "True/false toggle." },
  { value: "date", label: "Date", description: "ISO date (no time)." },
  { value: "datetime", label: "Date + time", description: "ISO datetime." },
  { value: "select", label: "Select", description: "Single-choice from a list." },
  { value: "multiselect", label: "Multi-select", description: "Multiple choices from a list." },
  { value: "email", label: "Email", description: "Validated email string." },
  { value: "phone", label: "Phone", description: "Phone number string." },
  { value: "url", label: "URL", description: "http(s) URL." },
  { value: "relation", label: "Relation", description: "Reference to another record." },
  { value: "json", label: "JSON", description: "Free-form JSON value." },
];

const SELECT_OPTION_COLORS: ReadonlyArray<{ value: string; swatch: string; label: string }> = [
  { value: "neutral", swatch: "#6B7280", label: "Neutral" },
  { value: "accent", swatch: "#3B82F6", label: "Blue" },
  { value: "success", swatch: "#10B981", label: "Green" },
  { value: "warning", swatch: "#F59E0B", label: "Amber" },
  { value: "danger", swatch: "#EF4444", label: "Red" },
  { value: "info", swatch: "#06B6D4", label: "Cyan" },
  { value: "purple", swatch: "#A855F7", label: "Purple" },
  { value: "pink", swatch: "#EC4899", label: "Pink" },
];

const VALID_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "tenantId",
  "status",
  "role",
]);

/* ----------------------------- HTTP -------------------------------------- */

function apiBase(): string {
  const base =
    (typeof import.meta !== "undefined"
      ? (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
      : undefined) ?? "/api";
  return base.toString().replace(/\/+$/, "");
}

function authHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
  if (authStore.activeTenant?.id) headers["x-tenant"] = authStore.activeTenant.id;
  return headers;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* tolerate */
  }
  return `HTTP ${res.status}`;
}

async function listFields(resource: string): Promise<FieldMeta[]> {
  const res = await fetch(
    `${apiBase()}/field-metadata/${encodeURIComponent(resource)}`,
    { headers: authHeaders(false), credentials: "include" },
  );
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { rows: FieldMeta[] };
  return body.rows;
}

interface CreateFieldInput {
  key: string;
  label: string;
  kind: FieldKind;
  options?: FieldOptions;
  required?: boolean;
  indexed?: boolean;
  position?: number;
}

async function createField(
  resource: string,
  input: CreateFieldInput,
): Promise<FieldMeta> {
  const res = await fetch(
    `${apiBase()}/field-metadata/${encodeURIComponent(resource)}`,
    {
      method: "POST",
      headers: authHeaders(),
      credentials: "include",
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as FieldMeta;
}

async function updateField(
  resource: string,
  id: string,
  patch: Partial<{
    label: string;
    kind: FieldKind;
    options: FieldOptions;
    required: boolean;
    indexed: boolean;
    position: number;
  }>,
): Promise<FieldMeta> {
  const res = await fetch(
    `${apiBase()}/field-metadata/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: authHeaders(),
      credentials: "include",
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as FieldMeta;
}

async function deleteField(resource: string, id: string): Promise<void> {
  const res = await fetch(
    `${apiBase()}/field-metadata/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: authHeaders(false),
      credentials: "include",
    },
  );
  if (!res.ok) throw new Error(await readError(res));
}

/* ----------------------------- helpers ----------------------------------- */

function toSnakeCase(label: string): string {
  // Convert "Best Customer Email!" → "best_customer_email"
  const ascii = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const cleaned = ascii.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  // Ensure starts with a letter (the regex requires that).
  const safe = /^[a-z]/.test(cleaned) ? cleaned : `f_${cleaned}`;
  return safe.slice(0, 64);
}

function validateKey(key: string): string | null {
  if (!key) return "Key is required.";
  if (!VALID_KEY_RE.test(key))
    return "Lowercase letters, digits, underscores. Must start with a letter (max 64 chars).";
  if (RESERVED_KEYS.has(key)) return `"${key}" is reserved by the platform.`;
  return null;
}

function isISOCurrency(s: string): boolean {
  return /^[A-Z]{3}$/.test(s);
}

function fieldKindLabel(kind: FieldKind): string {
  return FIELD_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

function colorSwatch(token: string | undefined): string {
  if (!token) return "#6B7280";
  return SELECT_OPTION_COLORS.find((c) => c.value === token)?.swatch ?? token;
}

/* ----------------------------- left rail --------------------------------- */

function ResourceRail({
  resources,
  active,
  onPick,
}: {
  resources: readonly ResourceDescriptor[];
  active: string;
  onPick: (id: string) => void;
}) {
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q),
    );
  }, [resources, search]);

  const builtin = filtered.filter((r) => r.group === "builtin");
  const docs = filtered.filter((r) => r.group === "documents");

  const renderGroup = (
    title: string,
    rows: readonly ResourceDescriptor[],
  ) => {
    if (rows.length === 0) return null;
    // Sub-group within Built-in by category, when present.
    const byCategory = new Map<string, ResourceDescriptor[]>();
    for (const r of rows) {
      const k = r.category ?? "";
      const list = byCategory.get(k) ?? [];
      list.push(r);
      byCategory.set(k, list);
    }
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider text-text-muted px-2 mt-2 mb-0.5">
          {title}
        </div>
        {[...byCategory.entries()].map(([cat, list]) => (
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
                  <code
                    className={cn(
                      "font-mono text-[10px] truncate shrink-0",
                      isActive ? "text-accent/70" : "text-text-muted",
                    )}
                  >
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
          <div className="text-xs text-text-muted px-2 py-2">
            No resources match.
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/* ----------------------------- field row (sortable) ---------------------- */

function SortableFieldRow({
  field,
  onEdit,
  onDelete,
  disabled,
}: {
  field: FieldMeta;
  onEdit: (f: FieldMeta) => void;
  onDelete: (f: FieldMeta) => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const groupHint = field.options.group ? (
    <Badge intent="neutral" className="font-normal">
      {field.options.group}
    </Badge>
  ) : null;

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-border-subtle last:border-b-0 hover:bg-surface-1 transition-colors",
        isDragging && "bg-surface-1",
      )}
    >
      <td className="px-2 py-2 w-8 align-middle">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded text-text-muted",
            "cursor-grab active:cursor-grabbing hover:bg-surface-2 hover:text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <td className="py-2 align-middle">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-text-primary font-medium truncate">
            {field.label}
          </span>
          {field.options.helpText ? (
            <span className="text-xs text-text-muted truncate">
              {field.options.helpText}
            </span>
          ) : null}
        </div>
      </td>
      <td className="py-2 align-middle">
        <code className="text-xs font-mono text-text-secondary">
          {field.key}
        </code>
      </td>
      <td className="py-2 align-middle">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge intent="accent" className="font-normal">
            {fieldKindLabel(field.kind)}
          </Badge>
          {groupHint}
        </div>
      </td>
      <td className="py-2 align-middle">
        {field.required ? (
          <Badge intent="warning">Required</Badge>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </td>
      <td className="py-2 align-middle">
        {field.indexed ? (
          <Badge intent="info">Indexed</Badge>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </td>
      <td className="py-2 pr-3 align-middle">
        <div className="flex items-center gap-1 justify-end">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onEdit(field)}
            iconLeft={<Pencil className="h-3 w-3" />}
            title="Edit"
          >
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onDelete(field)}
            iconLeft={<Trash2 className="h-3 w-3" />}
            title="Delete"
            className="text-intent-danger hover:bg-intent-danger-bg/30"
          >
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ----------------------------- field dialog ------------------------------ */

interface FormState {
  label: string;
  key: string;
  /** True until the user types in the Key field — auto-derive from label. */
  keyDerived: boolean;
  kind: FieldKind;
  required: boolean;
  indexed: boolean;
  // Options
  selectOptions: Array<{ value: string; label: string; color?: string }>;
  currency: string;
  relationTarget: string;
  min: string;
  max: string;
  step: string;
  maxLength: string;
  format: string;
  defaultValue: string;
  helpText: string;
  group: string;
}

const DEFAULT_FORM: FormState = {
  label: "",
  key: "",
  keyDerived: true,
  kind: "text",
  required: false,
  indexed: false,
  selectOptions: [],
  currency: "USD",
  relationTarget: "",
  min: "",
  max: "",
  step: "",
  maxLength: "",
  format: "",
  defaultValue: "",
  helpText: "",
  group: "",
};

function fieldToForm(f: FieldMeta): FormState {
  return {
    label: f.label,
    key: f.key,
    keyDerived: false,
    kind: f.kind,
    required: f.required,
    indexed: f.indexed,
    selectOptions: f.options.options ? [...f.options.options] : [],
    currency: f.options.currency ?? "USD",
    relationTarget: f.options.relationTarget ?? "",
    min: f.options.min != null ? String(f.options.min) : "",
    max: f.options.max != null ? String(f.options.max) : "",
    step: f.options.step != null ? String(f.options.step) : "",
    maxLength: f.options.maxLength != null ? String(f.options.maxLength) : "",
    format: f.options.format ?? "",
    defaultValue:
      f.options.defaultValue == null
        ? ""
        : typeof f.options.defaultValue === "string"
          ? f.options.defaultValue
          : JSON.stringify(f.options.defaultValue),
    helpText: f.options.helpText ?? "",
    group: f.options.group ?? "",
  };
}

function buildOptionsFromForm(form: FormState): FieldOptions {
  const opts: FieldOptions = {};
  if (form.kind === "select" || form.kind === "multiselect") {
    opts.options = form.selectOptions
      .map((o) => ({
        value: o.value.trim(),
        label: o.label.trim() || o.value.trim(),
        color: o.color || undefined,
      }))
      .filter((o) => o.value.length > 0);
  }
  if (form.kind === "currency" && form.currency.trim()) {
    opts.currency = form.currency.trim().toUpperCase();
  }
  if (form.kind === "relation" && form.relationTarget.trim()) {
    opts.relationTarget = form.relationTarget.trim();
  }
  if (form.kind === "number" || form.kind === "currency") {
    if (form.min.trim() && Number.isFinite(Number(form.min))) opts.min = Number(form.min);
    if (form.max.trim() && Number.isFinite(Number(form.max))) opts.max = Number(form.max);
    if (form.step.trim() && Number.isFinite(Number(form.step))) opts.step = Number(form.step);
  }
  if (form.kind === "text" || form.kind === "long-text" || form.kind === "rich-text") {
    if (form.maxLength.trim() && Number.isFinite(Number(form.maxLength))) {
      opts.maxLength = Math.max(1, Math.floor(Number(form.maxLength)));
    }
  }
  if (form.kind === "date" || form.kind === "datetime") {
    if (form.format.trim()) opts.format = form.format.trim();
  }
  if (form.defaultValue.trim()) {
    // Best-effort coercion. Non-string defaults can be serialized as JSON.
    if (form.kind === "boolean") {
      opts.defaultValue = form.defaultValue === "true";
    } else if (form.kind === "number" || form.kind === "currency") {
      const n = Number(form.defaultValue);
      if (Number.isFinite(n)) opts.defaultValue = n;
    } else if (form.kind === "json" || form.kind === "multiselect") {
      try {
        opts.defaultValue = JSON.parse(form.defaultValue);
      } catch {
        opts.defaultValue = form.defaultValue;
      }
    } else {
      opts.defaultValue = form.defaultValue;
    }
  }
  if (form.helpText.trim()) opts.helpText = form.helpText.trim();
  if (form.group.trim()) opts.group = form.group.trim();
  return opts;
}

interface FieldDialogProps {
  mode: "create" | "edit";
  resource: string;
  initial: FieldMeta | null;
  open: boolean;
  resources: readonly ResourceDescriptor[];
  onOpenChange: (o: boolean) => void;
  onSaved: (f: FieldMeta) => void;
}

function FieldDialog({
  mode,
  resource,
  initial,
  open,
  resources,
  onOpenChange,
  onSaved,
}: FieldDialogProps) {
  const [form, setForm] = React.useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState<{
    label?: boolean;
    key?: boolean;
    options?: boolean;
    currency?: boolean;
    relationTarget?: boolean;
  }>({});

  // Reset on open / mode flip.
  React.useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setForm(fieldToForm(initial));
    } else {
      setForm(DEFAULT_FORM);
    }
    setTouched({});
    setApiError(null);
  }, [open, mode, initial]);

  // Auto-derive snake_case key from label until the user takes over.
  React.useEffect(() => {
    if (!form.keyDerived) return;
    const next = toSnakeCase(form.label);
    if (next !== form.key) setForm((s) => ({ ...s, key: next }));
  }, [form.label, form.keyDerived, form.key]);

  const labelEmpty = !form.label.trim();
  const keyError = validateKey(form.key);
  const kindNeedsOptions =
    form.kind === "select" || form.kind === "multiselect";
  const optionsError =
    kindNeedsOptions &&
    (form.selectOptions.length === 0 ||
      form.selectOptions.some((o) => !o.value.trim()))
      ? "Add at least one option (value required)."
      : null;
  const currencyError =
    form.kind === "currency" && !isISOCurrency(form.currency.trim().toUpperCase())
      ? "Use a 3-letter ISO 4217 code (e.g. USD)."
      : null;
  const relationError =
    form.kind === "relation" && !form.relationTarget.trim()
      ? "Pick a target resource."
      : null;
  const maxLengthError =
    form.maxLength.trim() &&
    (!Number.isFinite(Number(form.maxLength)) || Number(form.maxLength) < 1)
      ? "Must be a positive integer."
      : null;
  const minMaxError = (() => {
    if (form.min.trim() && !Number.isFinite(Number(form.min))) return "Min must be numeric.";
    if (form.max.trim() && !Number.isFinite(Number(form.max))) return "Max must be numeric.";
    if (
      form.min.trim() &&
      form.max.trim() &&
      Number(form.min) > Number(form.max)
    )
      return "Min must be ≤ max.";
    return null;
  })();

  const canSubmit =
    !submitting &&
    !labelEmpty &&
    !keyError &&
    !optionsError &&
    !currencyError &&
    !relationError &&
    !maxLengthError &&
    !minMaxError;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setApiError(null);
    try {
      const options = buildOptionsFromForm(form);
      if (mode === "create") {
        const created = await createField(resource, {
          label: form.label.trim(),
          key: form.key.trim(),
          kind: form.kind,
          options,
          required: form.required,
          indexed: form.indexed,
        });
        onSaved(created);
      } else if (initial) {
        const updated = await updateField(resource, initial.id, {
          label: form.label.trim(),
          kind: form.kind,
          options,
          required: form.required,
          indexed: form.indexed,
        });
        onSaved(updated);
      }
      onOpenChange(false);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const setKind = (kind: FieldKind) => setForm((s) => ({ ...s, kind }));
  const setOptionAt = (
    idx: number,
    patch: Partial<{ value: string; label: string; color: string }>,
  ) =>
    setForm((s) => ({
      ...s,
      selectOptions: s.selectOptions.map((o, i) =>
        i === idx ? { ...o, ...patch } : o,
      ),
    }));
  const addOption = () =>
    setForm((s) => ({
      ...s,
      selectOptions: [
        ...s.selectOptions,
        { value: "", label: "", color: "neutral" },
      ],
    }));
  const removeOption = (idx: number) =>
    setForm((s) => ({
      ...s,
      selectOptions: s.selectOptions.filter((_, i) => i !== idx),
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add custom field" : "Edit custom field"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? (
              <>
                Add a field to <code className="font-mono">{resource}</code>.
                Existing records get the new field as <em>undefined</em> — no
                backfill required.
              </>
            ) : (
              <>
                Update <code className="font-mono">{initial?.key}</code> on{" "}
                <code className="font-mono">{resource}</code>. Renaming the key
                isn't supported; create a new field instead to preserve data.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {apiError ? (
          <div className="rounded-md border border-intent-danger/40 bg-intent-danger-bg/30 px-3 py-2 text-sm text-intent-danger flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="flex-1">{apiError}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Label */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-label" required>
              Label
            </Label>
            <Input
              id="cf-label"
              autoFocus
              placeholder="Lifetime value"
              value={form.label}
              invalid={touched.label && labelEmpty}
              onChange={(e) =>
                setForm((s) => ({ ...s, label: e.target.value }))
              }
              onBlur={() => setTouched((t) => ({ ...t, label: true }))}
            />
            {touched.label && labelEmpty ? (
              <span className="text-xs text-intent-danger">
                Label is required.
              </span>
            ) : (
              <span className="text-xs text-text-muted">
                Shown in forms and table headers.
              </span>
            )}
          </div>

          {/* Key */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-key" required>
              Key
            </Label>
            <Input
              id="cf-key"
              placeholder="lifetime_value"
              value={form.key}
              disabled={mode === "edit"}
              invalid={touched.key && !!keyError}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  key: e.target.value,
                  keyDerived: false,
                }))
              }
              onBlur={() => setTouched((t) => ({ ...t, key: true }))}
              className="font-mono"
            />
            {touched.key && keyError ? (
              <span className="text-xs text-intent-danger">{keyError}</span>
            ) : (
              <span className="text-xs text-text-muted">
                {mode === "edit"
                  ? "Keys are immutable — they're how stored values are addressed."
                  : "Auto-derived from the label. Override if you need a different storage key."}
              </span>
            )}
          </div>

          {/* Kind */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="cf-kind" required>
              Kind
            </Label>
            <Select value={form.kind} onValueChange={(v) => setKind(v as FieldKind)}>
              <SelectTrigger id="cf-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div className="flex flex-col">
                      <span>{o.label}</span>
                      <span className="text-xs text-text-muted">
                        {o.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Per-kind options */}
        <KindOptionsPanel
          form={form}
          setForm={setForm}
          touched={touched}
          setTouched={setTouched}
          resources={resources}
          currentResource={resource}
          optionsError={optionsError}
          currencyError={currencyError}
          relationError={relationError}
          maxLengthError={maxLengthError}
          minMaxError={minMaxError}
          onAddOption={addOption}
          onRemoveOption={removeOption}
          onSetOption={setOptionAt}
        />

        {/* Always-on options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-default">Default value</Label>
            <Input
              id="cf-default"
              placeholder={
                form.kind === "boolean"
                  ? "true"
                  : form.kind === "json"
                    ? '{"key":"value"}'
                    : ""
              }
              value={form.defaultValue}
              onChange={(e) =>
                setForm((s) => ({ ...s, defaultValue: e.target.value }))
              }
            />
            <span className="text-xs text-text-muted">
              Applied when a record is created without this field set.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cf-group">Group</Label>
            <Input
              id="cf-group"
              placeholder="Billing"
              value={form.group}
              onChange={(e) =>
                setForm((s) => ({ ...s, group: e.target.value }))
              }
            />
            <span className="text-xs text-text-muted">
              UI placement hint — fields with the same group cluster together.
            </span>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="cf-help">Help text</Label>
            <Textarea
              id="cf-help"
              rows={2}
              placeholder="Shown under the input on edit forms."
              value={form.helpText}
              onChange={(e) =>
                setForm((s) => ({ ...s, helpText: e.target.value }))
              }
            />
          </div>
        </div>

        {/* Required + Indexed */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-1 px-3 py-2">
            <div className="flex flex-col">
              <Label htmlFor="cf-required" className="cursor-pointer">
                Required
              </Label>
              <span className="text-xs text-text-muted">
                Reject record writes that leave this empty.
              </span>
            </div>
            <Switch
              id="cf-required"
              checked={form.required}
              onCheckedChange={(v) =>
                setForm((s) => ({ ...s, required: !!v }))
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-1 px-3 py-2">
            <div className="flex flex-col">
              <Label htmlFor="cf-indexed" className="cursor-pointer">
                Indexed
              </Label>
              <span className="text-xs text-text-muted">
                Index for filter chips &amp; lookups.
              </span>
            </div>
            <Switch
              id="cf-indexed"
              checked={form.indexed}
              onCheckedChange={(v) =>
                setForm((s) => ({ ...s, indexed: !!v }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit}
            loading={submitting}
          >
            {mode === "create" ? "Add field" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- per-kind options panel -------------------- */

interface KindOptionsPanelProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  touched: {
    options?: boolean;
    currency?: boolean;
    relationTarget?: boolean;
  };
  setTouched: React.Dispatch<
    React.SetStateAction<{
      label?: boolean;
      key?: boolean;
      options?: boolean;
      currency?: boolean;
      relationTarget?: boolean;
    }>
  >;
  resources: readonly ResourceDescriptor[];
  currentResource: string;
  optionsError: string | null;
  currencyError: string | null;
  relationError: string | null;
  maxLengthError: string | null;
  minMaxError: string | null;
  onAddOption: () => void;
  onRemoveOption: (idx: number) => void;
  onSetOption: (
    idx: number,
    patch: Partial<{ value: string; label: string; color: string }>,
  ) => void;
}

function KindOptionsPanel(props: KindOptionsPanelProps) {
  const {
    form,
    setForm,
    touched,
    setTouched,
    resources,
    currentResource,
    optionsError,
    currencyError,
    relationError,
    maxLengthError,
    minMaxError,
    onAddOption,
    onRemoveOption,
    onSetOption,
  } = props;

  const wraps = (children: React.ReactNode) => (
    <div className="rounded-md border border-border-subtle bg-surface-1/40 p-3 flex flex-col gap-3">
      <div className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {fieldKindLabel(form.kind)} options
      </div>
      {children}
    </div>
  );

  if (form.kind === "select" || form.kind === "multiselect") {
    return wraps(
      <div className="flex flex-col gap-2">
        {form.selectOptions.length === 0 ? (
          <span className="text-xs text-text-muted">
            No options yet. Add at least one.
          </span>
        ) : null}
        {form.selectOptions.map((o, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              placeholder="value"
              value={o.value}
              invalid={touched.options && !o.value.trim()}
              onChange={(e) =>
                onSetOption(idx, { value: e.target.value })
              }
              onBlur={() => setTouched((t) => ({ ...t, options: true }))}
              className="font-mono text-xs flex-1 min-w-0"
            />
            <Input
              placeholder="Label"
              value={o.label}
              onChange={(e) =>
                onSetOption(idx, { label: e.target.value })
              }
              className="flex-1 min-w-0"
            />
            <Select
              value={o.color ?? "neutral"}
              onValueChange={(v) => onSetOption(idx, { color: v })}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Color" />
              </SelectTrigger>
              <SelectContent>
                {SELECT_OPTION_COLORS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: c.swatch }}
                      />
                      <span>{c.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemoveOption(idx)}
              title="Remove option"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconLeft={<Plus className="h-3.5 w-3.5" />}
            onClick={onAddOption}
          >
            Add option
          </Button>
          {touched.options && optionsError ? (
            <span className="text-xs text-intent-danger">{optionsError}</span>
          ) : null}
        </div>
      </div>,
    );
  }

  if (form.kind === "currency") {
    return wraps(
      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="cf-currency" required>
          ISO 4217 currency code
        </Label>
        <Input
          id="cf-currency"
          placeholder="USD"
          value={form.currency}
          invalid={touched.currency && !!currencyError}
          onChange={(e) =>
            setForm((s) => ({ ...s, currency: e.target.value.toUpperCase() }))
          }
          onBlur={() => setTouched((t) => ({ ...t, currency: true }))}
          className="font-mono"
          maxLength={3}
        />
        {touched.currency && currencyError ? (
          <span className="text-xs text-intent-danger">{currencyError}</span>
        ) : (
          <span className="text-xs text-text-muted">
            Examples: USD, EUR, GBP, JPY.
          </span>
        )}
        {numericRangeBlock()}
      </div>,
    );
  }

  if (form.kind === "relation") {
    const candidates = resources.filter((r) => r.id !== currentResource);
    return wraps(
      <div className="flex flex-col gap-1.5 max-w-md">
        <Label htmlFor="cf-relation" required>
          Target resource
        </Label>
        <Select
          value={form.relationTarget}
          onValueChange={(v) =>
            setForm((s) => ({ ...s, relationTarget: v }))
          }
        >
          <SelectTrigger id="cf-relation" invalid={!!relationError}>
            <SelectValue placeholder="Pick a resource…" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                <div className="flex flex-col">
                  <span>{r.label}</span>
                  <span className="text-xs text-text-muted font-mono">
                    {r.id}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {relationError ? (
          <span className="text-xs text-intent-danger">{relationError}</span>
        ) : (
          <span className="text-xs text-text-muted">
            Stored as the related record's id.
          </span>
        )}
      </div>,
    );
  }

  if (form.kind === "number") {
    return wraps(numericRangeBlock());
  }

  if (form.kind === "text" || form.kind === "long-text" || form.kind === "rich-text") {
    return wraps(
      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="cf-maxlen">Max length</Label>
        <Input
          id="cf-maxlen"
          inputMode="numeric"
          placeholder="e.g. 280"
          value={form.maxLength}
          invalid={!!maxLengthError}
          onChange={(e) =>
            setForm((s) => ({ ...s, maxLength: e.target.value }))
          }
        />
        {maxLengthError ? (
          <span className="text-xs text-intent-danger">{maxLengthError}</span>
        ) : (
          <span className="text-xs text-text-muted">
            Values are silently truncated to this length on write.
          </span>
        )}
      </div>,
    );
  }

  if (form.kind === "date" || form.kind === "datetime") {
    return wraps(
      <div className="flex flex-col gap-1.5 max-w-md">
        <Label htmlFor="cf-format">Format hint</Label>
        <Input
          id="cf-format"
          placeholder={
            form.kind === "datetime" ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd"
          }
          value={form.format}
          onChange={(e) =>
            setForm((s) => ({ ...s, format: e.target.value }))
          }
          className="font-mono"
        />
        <span className="text-xs text-text-muted">
          Used by the form renderer for parsing/displaying. Stored value is
          always ISO 8601.
        </span>
      </div>,
    );
  }

  // No special panel for boolean / email / phone / url / json.
  return null;

  function numericRangeBlock() {
    return (
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-min">Min</Label>
          <Input
            id="cf-min"
            inputMode="decimal"
            placeholder="0"
            value={form.min}
            onChange={(e) => setForm((s) => ({ ...s, min: e.target.value }))}
            invalid={!!minMaxError}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-max">Max</Label>
          <Input
            id="cf-max"
            inputMode="decimal"
            placeholder="100"
            value={form.max}
            onChange={(e) => setForm((s) => ({ ...s, max: e.target.value }))}
            invalid={!!minMaxError}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-step">Step</Label>
          <Input
            id="cf-step"
            inputMode="decimal"
            placeholder="1"
            value={form.step}
            onChange={(e) => setForm((s) => ({ ...s, step: e.target.value }))}
          />
        </div>
        {minMaxError ? (
          <span className="text-xs text-intent-danger col-span-3">
            {minMaxError}
          </span>
        ) : null}
      </div>
    );
  }
}

/* ----------------------------- delete confirm ---------------------------- */

function DeleteFieldDialog({
  field,
  busy,
  onCancel,
  onConfirm,
}: {
  field: FieldMeta | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!field} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete custom field?</DialogTitle>
          <DialogDescription>
            The field will disappear from forms, list views, and filters
            immediately. Existing values <strong>stay in records</strong> and
            can be exposed again by re-adding a field with the same key — no
            data is lost.
          </DialogDescription>
        </DialogHeader>
        {field ? (
          <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-sm flex items-center justify-between gap-2">
            <code className="font-mono break-all">{field.key}</code>
            <Badge intent="accent">{fieldKindLabel(field.kind)}</Badge>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            Delete field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- main page --------------------------------- */

export function CustomFieldsPage() {
  const [activeResource, setActiveResource] = React.useState<string>(
    () => RESOURCES[0]?.id ?? "crm.contact",
  );
  const [rows, setRows] = React.useState<FieldMeta[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [dialogMode, setDialogMode] = React.useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = React.useState<FieldMeta | null>(null);
  const [deleting, setDeleting] = React.useState<FieldMeta | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const load = React.useCallback(
    async (resource: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await listFields(resource);
        // Sort by position to match server, then label as fallback.
        data.sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          return a.label.localeCompare(b.label);
        });
        setRows(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    void load(activeResource);
  }, [activeResource, load]);

  const onSaved = (f: FieldMeta) => {
    setRows((cur) => {
      if (!cur) return [f];
      const idx = cur.findIndex((r) => r.id === f.id);
      if (idx === -1) {
        // append
        return [...cur, f];
      }
      const copy = [...cur];
      copy[idx] = f;
      return copy;
    });
  };

  const onConfirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteField(activeResource, deleting.id);
      setRows((cur) => (cur ? cur.filter((r) => r.id !== deleting.id) : cur));
      setDeleting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const onDragEnd = async (e: DragEndEvent) => {
    if (!rows || !e.over) return;
    const oldIdx = rows.findIndex((r) => r.id === e.active.id);
    const newIdx = rows.findIndex((r) => r.id === e.over!.id);
    if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;
    const next = arrayMove(rows, oldIdx, newIdx);
    // Optimistic — reflect immediately, then persist each new position.
    const withPositions = next.map((r, i) => ({ ...r, position: i }));
    setRows(withPositions);
    // Persist only the rows whose position changed.
    const changed = withPositions.filter(
      (r, i) => rows[i]?.id !== r.id,
    );
    try {
      await Promise.all(
        changed.map((r) =>
          updateField(activeResource, r.id, { position: r.position }),
        ),
      );
    } catch (err) {
      // Roll back on failure.
      setError(err instanceof Error ? err.message : String(err));
      void load(activeResource);
    }
  };

  const activeDescriptor = RESOURCES.find((r) => r.id === activeResource);

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <PageHeader
        title="Custom fields"
        description="Add Twenty-style metadata to any record without a deploy. Fields are stored inline in records, so no schema migration is required."
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditing(null);
              setDialogMode("create");
            }}
          >
            Add field
          </Button>
        }
      />

      {error ? (
        <div className="rounded-md border border-intent-danger/40 bg-intent-danger-bg/30 px-3 py-2 text-sm text-intent-danger flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            className="text-xs underline opacity-80 hover:opacity-100"
            onClick={() => setError(null)}
          >
            dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[260px_1fr] min-h-0">
        <ResourceRail
          resources={RESOURCES}
          active={activeResource}
          onPick={setActiveResource}
        />

        <main className="flex flex-col gap-3 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-base font-semibold text-text-primary truncate">
                {activeDescriptor?.label ?? activeResource}
              </h2>
              <code className="text-xs font-mono text-text-muted truncate">
                {activeResource}
              </code>
            </div>
            {rows && rows.length > 0 ? (
              <span className="text-xs text-text-muted">
                {rows.length} {rows.length === 1 ? "field" : "fields"}
              </span>
            ) : null}
          </div>

          {loading && rows === null ? (
            <Card>
              <CardContent className="py-12 flex items-center justify-center text-sm text-text-muted">
                <Spinner size={14} />
                <span className="ml-2">Loading fields…</span>
              </CardContent>
            </Card>
          ) : rows && rows.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<Sparkles className="h-5 w-5" />}
                  title="No custom fields yet"
                  description="Custom fields let you add Twenty-style metadata to any record without a deploy. Existing records get the new field as undefined — no backfill required."
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      iconLeft={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setEditing(null);
                        setDialogMode("create");
                      }}
                    >
                      Add your first field
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : rows ? (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <table className="w-full text-sm">
                    <thead className="bg-surface-1 border-b border-border text-xs uppercase tracking-wider text-text-muted">
                      <tr>
                        <th className="px-2 py-2 font-medium w-8" aria-label="Drag" />
                        <th className="text-left py-2 font-medium">Label</th>
                        <th className="text-left py-2 font-medium">Key</th>
                        <th className="text-left py-2 font-medium">Kind</th>
                        <th className="text-left py-2 font-medium w-24">Required</th>
                        <th className="text-left py-2 font-medium w-24">Indexed</th>
                        <th className="text-right py-2 pr-3 font-medium w-44">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <SortableContext
                      items={rows.map((r) => r.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <tbody>
                        {rows.map((field) => (
                          <SortableFieldRow
                            key={field.id}
                            field={field}
                            disabled={loading}
                            onEdit={(f) => {
                              setEditing(f);
                              setDialogMode("edit");
                            }}
                            onDelete={(f) => setDeleting(f)}
                          />
                        ))}
                      </tbody>
                    </SortableContext>
                  </table>
                </DndContext>
              </CardContent>
            </Card>
          ) : null}
        </main>
      </div>

      <FieldDialog
        mode={dialogMode === "edit" ? "edit" : "create"}
        resource={activeResource}
        initial={editing}
        open={dialogMode != null}
        resources={RESOURCES}
        onOpenChange={(o) => !o && setDialogMode(null)}
        onSaved={onSaved}
      />

      <DeleteFieldDialog
        field={deleting}
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={onConfirmDelete}
      />
    </div>
  );
}
