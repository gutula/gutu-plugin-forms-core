# Forms Core Edge Cases

## Known failure modes

- Validation or permission failures should stop at the action boundary instead of creating partial downstream state.
- This plugin does not currently publish a separate lifecycle event or job envelope from its services, so hosts should not assume one exists.
- Schema ownership exists without a dedicated migration lane, so schema changes need extra review and future hardening.
- UI regressions remain bounded to the published surface; there is no broader admin contribution layer to fall back on.
- Downstream automation must not infer undocumented hooks or side effects from implementation details.

## Domain-specific edge cases

- No domain-specific edge-case catalog is exported yet.

## Data anomalies

- Duplicate or replayed requests should be evaluated against the action’s documented idempotency behavior rather than guessed at runtime.
- Stale upstream dependencies should be handled by orchestration around this plugin, not by undocumented mutations inside the plugin boundary.
- If this plugin owns data that depends on another plugin, reconcile through declared dependencies and capability contracts.

## Recovery expectations

- Retry only through explicit action, job, or workflow semantics already exported by the plugin.
- Preserve auditability whenever operators need to reconcile a partial or conflicting state.
- Update both public and nested docs if recovery rules change.
