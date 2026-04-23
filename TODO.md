# Forms Core TODO

**Maturity Tier:** `Baseline`

## Shipped Now

- Exports 1 governed action: `forms.submissions.submit`.
- Owns 1 resource contract: `forms.submissions`.
- Registers a bounded UI surface that can be hosted by the surrounding admin or portal shell.
- Defines a durable data schema contract even though no explicit SQL helper module is exported.

## Current Gaps

- No dedicated integration test lane is exported in this repo today; validation currently leans on build, lint, typecheck, and test lanes.
- The plugin owns durable data state, but it does not yet ship a dedicated migration verification lane in this repo.
- No standalone plugin-owned event, job, or workflow catalog is exported yet; compose it through actions, resources, and the surrounding Gutu runtime.
- The plugin exposes a UI surface, but not a richer admin workspace contribution module.
- The repo does not yet export a domain parity catalog with owned entities, reports, settings surfaces, and exception queues.

## Recommended Next

- Expand validation and workflow coupling where form submissions drive more downstream automation.
- Add stronger portal and dashboard integration guidance if form-driven products become more user-facing.
- Deepen publishing, review, search, or portal flows where current resources and actions already suggest the next stable step.
- Add richer admin and operator guidance once the domain lifecycle hardens.
- Add targeted integration coverage once the current lifecycle path is stable enough to benefit from end-to-end assertions.
- Add explicit migration or rollback coverage if this domain becomes more operationally sensitive.
- Promote important downstream reactions into explicit commands, jobs, or workflow steps instead of relying on implicit coupling.
- Broaden the admin entry surface only if operators need more than the current embedded view or resource listing.

## Later / Optional

- Advanced authoring, public delivery, and analytics extensions after the core content contracts prove stable.
