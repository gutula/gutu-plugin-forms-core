# Forms Core Developer Guide

Dynamic forms and submissions backbone.

**Maturity Tier:** `Baseline`

## Purpose And Architecture Role

Defines the dynamic form and submission layer used by internal tools, operator flows, and self-service data collection.

### This plugin is the right fit when

- You need **form definitions**, **submission capture**, **governed input contracts** as a governed domain boundary.
- You want to integrate through declared actions, resources, jobs, workflows, and UI surfaces instead of implicit side effects.
- You need the host application to keep plugin boundaries honest through manifest capabilities, permissions, and verification lanes.

### This plugin is intentionally not

- Not a monolithic website builder or headless-CMS replacement beyond the specific content surfaces exported here.
- Not a generic front-end framework; UI behavior remains bounded to the plugin’s declared resources and surfaces.

## Repo Map

| Path | Purpose |
| --- | --- |
| `package.json` | Root extracted-repo manifest, workspace wiring, and repo-level script entrypoints. |
| `framework/builtin-plugins/forms-core` | Nested publishable plugin package. |
| `framework/builtin-plugins/forms-core/src` | Runtime source, actions, resources, services, and UI exports. |
| `framework/builtin-plugins/forms-core/tests` | Unit, contract, integration, and migration coverage where present. |
| `framework/builtin-plugins/forms-core/docs` | Internal domain-doc source set kept in sync with this guide. |
| `framework/builtin-plugins/forms-core/db/schema.ts` | Database schema contract when durable state is owned. |
| `framework/builtin-plugins/forms-core/src/postgres.ts` | SQL migration and rollback helpers when exported. |

## Manifest Contract

| Field | Value |
| --- | --- |
| Package Name | `@plugins/forms-core` |
| Manifest ID | `forms-core` |
| Display Name | Forms Core |
| Domain Group | Content and Experience |
| Default Category | Content & Experience / Forms & Submissions |
| Version | `0.1.0` |
| Kind | `app` |
| Trust Tier | `first-party` |
| Review Tier | `R1` |
| Isolation Profile | `same-process-trusted` |
| Framework Compatibility | ^0.1.0 |
| Runtime Compatibility | bun>=1.3.12 |
| Database Compatibility | postgres, sqlite |

## Dependency Graph And Capability Requests

| Field | Value |
| --- | --- |
| Depends On | `auth-core`, `org-tenant-core`, `role-policy-core`, `audit-core` |
| Requested Capabilities | `ui.register.admin`, `api.rest.mount`, `data.write.forms` |
| Provides Capabilities | `forms.submissions` |
| Owns Data | `forms.submissions` |

### Dependency interpretation

- Direct plugin dependencies describe package-level coupling that must already be present in the host graph.
- Requested capabilities tell the host what platform services or sibling plugins this package expects to find.
- Provided capabilities and owned data tell integrators what this package is authoritative for.

## Public Integration Surfaces

| Type | ID / Symbol | Access / Mode | Notes |
| --- | --- | --- | --- |
| Action | `forms.submissions.submit` | Permission: `forms.submissions.submit` | Idempotent<br>Audited |
| Resource | `forms.submissions` | Portal disabled | Admin auto-CRUD enabled<br>Fields: `label`, `status`, `createdAt` |





### UI Surface Summary

| Surface | Present | Notes |
| --- | --- | --- |
| UI Surface | Yes | A bounded UI surface export is present. |
| Admin Contributions | No | Only the baseline surface is exported. |
| Zone/Canvas Extension | No | No dedicated zone extension export. |

## Hooks, Events, And Orchestration

This plugin should be integrated through **explicit commands/actions, resources, jobs, workflows, and the surrounding Gutu event runtime**. It must **not** be documented as a generic WordPress-style hook system unless such a hook API is explicitly exported.

- No standalone plugin-owned lifecycle event feed is exported today.
- No plugin-owned job catalog is exported today.
- No plugin-owned workflow catalog is exported today.
- Recommended composition pattern: invoke actions, read resources, then let the surrounding Gutu command/event/job runtime handle downstream automation.

## Storage, Schema, And Migration Notes

- Database compatibility: `postgres`, `sqlite`
- Schema file: `framework/builtin-plugins/forms-core/db/schema.ts`
- SQL helper file: `framework/builtin-plugins/forms-core/src/postgres.ts`
- Migration lane present: No

The plugin does not export a dedicated SQL helper module today. Treat the schema and resources as the durable contract instead of inventing undocumented SQL behavior.

## Failure Modes And Recovery

- Action inputs can fail schema validation or permission evaluation before any durable mutation happens.
- If downstream automation is needed, the host must add it explicitly instead of assuming this plugin emits jobs.
- There is no separate lifecycle-event feed to rely on today; do not build one implicitly from internal details.
- Schema-affecting changes need extra care because there is no dedicated migration lane yet.

## Mermaid Flows

### Primary Lifecycle

```mermaid
flowchart LR
  caller["Host or operator"] --> action["forms.submissions.submit"]
  action --> validation["Schema + permission guard"]
  validation --> service["Forms Core service layer"]
  service --> state["forms.submissions"]
  state --> ui["UI surface"]
```



## Integration Recipes

### 1. Host wiring

```ts
import { manifest, submitFormSubmissionAction, FormSubmissionResource, uiSurface } from "@plugins/forms-core";

export const pluginSurface = {
  manifest,
  submitFormSubmissionAction,
  FormSubmissionResource,
  
  
  
  uiSurface
};
```

Use this pattern when your host needs to register the plugin’s declared exports without reaching into internal file paths.

### 2. Action-first orchestration

```ts
import { manifest, submitFormSubmissionAction } from "@plugins/forms-core";

console.log("plugin", manifest.id);
console.log("action", submitFormSubmissionAction.id);
```

- Prefer action IDs as the stable integration boundary.
- Respect the declared permission, idempotency, and audit metadata instead of bypassing the service layer.
- Treat resource IDs as the read-model boundary for downstream consumers.

### 3. Cross-plugin composition

- Compose this plugin through action invocations and resource reads.
- If downstream automation becomes necessary, add it in the surrounding Gutu command/event/job runtime instead of assuming this plugin already exports a hook surface.

## Test Matrix

| Lane | Present | Evidence |
| --- | --- | --- |
| Build | Yes | `bun run build` |
| Typecheck | Yes | `bun run typecheck` |
| Lint | Yes | `bun run lint` |
| Test | Yes | `bun run test` |
| Unit | Yes | 1 file(s) |
| Contracts | Yes | 1 file(s) |
| Integration | No | No integration files found |
| Migrations | No | No migration files found |

### Verification commands

- `bun run build`
- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run test:contracts`
- `bun run test:unit`
- `bun run docs:check`

## Current Truth And Recommended Next

### Current truth

- Exports 1 governed action: `forms.submissions.submit`.
- Owns 1 resource contract: `forms.submissions`.
- Registers a bounded UI surface that can be hosted by the surrounding admin or portal shell.
- Defines a durable data schema contract even though no explicit SQL helper module is exported.

### Current gaps

- No dedicated integration test lane is exported in this repo today; validation currently leans on build, lint, typecheck, and test lanes.
- The plugin owns durable data state, but it does not yet ship a dedicated migration verification lane in this repo.
- No standalone plugin-owned event, job, or workflow catalog is exported yet; compose it through actions, resources, and the surrounding Gutu runtime.
- The plugin exposes a UI surface, but not a richer admin workspace contribution module.
- The repo does not yet export a domain parity catalog with owned entities, reports, settings surfaces, and exception queues.

### Recommended next

- Expand validation and workflow coupling where form submissions drive more downstream automation.
- Add stronger portal and dashboard integration guidance if form-driven products become more user-facing.
- Deepen publishing, review, search, or portal flows where current resources and actions already suggest the next stable step.
- Add richer admin and operator guidance once the domain lifecycle hardens.
- Add targeted integration coverage once the current lifecycle path is stable enough to benefit from end-to-end assertions.
- Add explicit migration or rollback coverage if this domain becomes more operationally sensitive.
- Promote important downstream reactions into explicit commands, jobs, or workflow steps instead of relying on implicit coupling.
- Broaden the admin entry surface only if operators need more than the current embedded view or resource listing.

### Later / optional

- Advanced authoring, public delivery, and analytics extensions after the core content contracts prove stable.
