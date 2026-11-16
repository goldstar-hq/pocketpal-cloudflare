# Organization registry integrity contract

This package is a data-contract and test harness, not a live organization registry.

It deliberately contains only synthetic identifiers and generic roles. It does not contain owner profiles, private organizational records, credentials, endpoints, or production configuration. It neither connects to Cloudflare nor changes runtime permissions, routes, deployments, or trading capabilities.

## What it checks

- A single human authority at level 0 and a single central manager at level 1.
- Formal reporting: level 1 reports to level 0; each level-2 domain manager reports to level 1; level-3 members report within their own domain.
- Exactly one level-2 manager for each domain unit.
- Explicit level-3 role classification (l3_specialist or l3_manager); manager assignments must be reciprocal and same-domain.
- Unique identities, unit references, and acyclic unit-parent relationships.
- No direct cross-domain communication or delegation between level-2/level-3 actors.
- A level-1 direct assignment to a level-3 actor must notify the responsible level-2 manager.
- Unique policy codes/priorities and fail-closed coverage for prohibited and sensitive actions.

The unit tree and actor reporting chain are checked independently. This is intentional: a unit's placement in a chart is not a substitute for an explicit reportsTo relationship.

## Run locally

    node --check governance/org-registry/scripts/validate-registry.mjs
    node --test governance/org-registry/test/*.test.mjs
    node governance/org-registry/scripts/validate-registry.mjs governance/org-registry/fixtures/valid-registry.json

## Boundary

The validator checks the supplied JSON snapshot only. A passing result does not prove that an agent is deployed, authenticated, reachable, authorized at runtime, or has received a policy document. Those require separate end-to-end evidence and must not be inferred from registry consistency.
