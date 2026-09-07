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
| P1 | Discovery refresh failure is presented as pagination failure; retry can be a no-op or load the wrong page. | P1 | Fixed; page-one retry and retained results |
| P1 | Catalog, login audit and AI generation pagination can append duplicate or stale results during search/filter changes. | P1 | Fixed; matching-query and generation guards |
| P1 | Moderation, telemetry, usage, chapters, source discovery and polling lists accept superseded responses. | P1 | Fixed; stale response and cancellation guards |
| P1 | Several lists hide refresh errors once old data exists. | P1 | Fixed; persistent retry notice in bookshelf and 14 admin lists |
| P1 | Session restoration failure has no direct retry; users are asked to reenter credentials. | P1 | Fixed; retry without reentering credentials and explicit offline-sheet dismissal |
| P1 | Empty chapter-list responses produce an unexplained blank sheet. | P1 | Fixed; native empty state |
| P1 | Batch source discovery reads mutable list indices across network awaits. | P1 | Fixed; snapshot the selected novels before starting |
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

## Evidence

- Audit infrastructure: f427282; Release/Core run 34139669112 succeeded.
- Baseline simulator run 34139835432: phone and tablet compiled; four of five tests passed on each device. Light/dark reading journeys, large text, login and empty states completed. The profile test needs to wait for the edit sheet to disappear after Save before interacting with the underlying page.
- P1 adds five Core regression cases for request ordering, debounce, pagination exclusion, refresh supersession, and recovery after a failed filter. Native checks additionally exercise discovery refresh retry and session restoration.
