# Frontend Audit, 2026-09-07

## Baseline

- Personal center: eb83e5e, separate implementation commit.
- Scope: authentication, discovery, bookshelf, detail, reader, chapter list, offline library, profile, settings, and all native admin modules.
- Preserve the approved native reading-first layout and shared theme.
- Verify source contracts, Core behavior, Release compilation, and simulator screenshots separately.
- Simulator fixtures are enabled only by explicit launch environment in Debug simulator builds. They intercept network requests and never change production data.

## Findings

| Priority | Finding | Repair Stage | Status |
| --- | --- | --- | --- |
| P1 | Discovery refresh failure is presented as pagination failure; retry can be a no-op or load the wrong page. | P1 | Confirmed in source |
| P1 | Admin catalog and audit pagination can append duplicate or stale results during search/filter changes. | P1 | Confirmed in source |
| P1 | Several lists hide refresh errors once old data exists. | P1 | Confirmed in source |
| P1 | Session restoration failure has no direct retry; users are asked to reenter credentials. | P1 | Confirmed in source |
| P1 | Empty chapter-list responses produce an unexplained blank sheet. | P1 | Confirmed in source |
| P2 | Reader font-size row and multi-option controls need a large-text layout fallback. | P2 | Native verification pending |
| P2 | Reader settings cannot expand beyond a medium sheet from the reader. | P2 | Confirmed in source |
| P2 | Login repeats its explanatory copy and permits mode/input changes during submission. | P2 | Confirmed in source |

## Delivery

1. Commit the completed personal center independently.
2. Establish native screenshot and interaction checks.
3. Repair P1 workflow defects, validate, and commit.
4. Repair P2 visual/accessibility defects, validate, and commit.
5. Record final coverage, verification results, and device-only limitations.

## Boundaries

Comments/ratings and push notifications remain separate product backlog features. Physical-device performance, VoiceOver navigation, and real server mutations require their own acceptance evidence; successful builds alone do not establish those results.
