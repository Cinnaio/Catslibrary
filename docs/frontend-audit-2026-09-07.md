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
| P2 | Reader font-size row truncates at accessibility sizes on a 375pt phone; multi-option controls also need more space. | P2 | Fixed; vertical adaptive layouts |
| P2 | Reader settings cannot expand beyond a medium sheet from the reader. | P2 | Fixed; medium/large, with a large initial sheet from profile at accessibility sizes |
| P2 | Profile headers overlap rows while pinned; large-text identity has cramped, heavily truncated copy. | P2 | Fixed; unpinned headings and vertical identity at accessibility sizes |
| P2 | Serif styles all start at 17pt, flattening the intended title/body/caption hierarchy. | P2 | Fixed; use each native text style's baseline before scaling |
| P2 | Login repeats copy and permits mode/input changes during submission; visible passwords can autocorrect. | P2 | Fixed; concise layout, disabled fields during requests, literal password input |
| P2 | Admin mode pickers and dashboard metrics are constrained at accessibility sizes. | P2 | Fixed; menu fallback and adaptive grid |
| P1 | Cover candidates and writing profiles can belong to a previously selected book; continuation retains the old chapter ID. | Follow-up | Fixed in 5d0a94c; generation/query checks, clear dependent state, exclude overlapping profile refresh |
| P1 | Refresh discards unsaved AI settings, provider fields, or proxy configuration. | Follow-up | Fixed in 5d0a94c / 757754c; compare saved snapshots and preserve drafts |
| P1 | Saving announcement text can overwrite input entered while the request is running. | Follow-up | Fixed in 757754c; disable the editor during save and exclude duplicate submission |
| P1 | AI task overview, dashboard, users and saved scrape configurations accept obsolete responses. | Follow-up | Fixed in 5d0a94c / 757754c; cancellation and generation checks; registration save invalidates an older overview |
| P2 | Saved scrape configuration refresh replaces the existing list with a full-screen failure. | Follow-up | Fixed in 757754c; retain content and offer inline retry |
| P1 | A short discovery list on tablet does not trigger the native pull-to-refresh check. | Follow-up | Fixed; deterministic first non-empty-query retry fixture and final native verification |

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
- Baseline simulator run 34139835432: phone and tablet compiled; four of five tests passed on each device. Inspected original phone/tablet screenshots, including large-text truncation and pinned profile-header overlap. Profile mutation did not complete because the unsigned simulator did not retain the fixture token in Keychain. Audit-only in-memory credentials now isolate fixtures from signing and real credentials; the test also waits for sheet dismissal.
- P1: 4362e70; Core/Release run 34142297019 succeeded. Source checks passed.
- P1 adds five Core regression cases for request ordering, debounce, pagination exclusion, refresh supersession, and recovery after a failed filter. Native checks additionally exercise discovery refresh retry and session restoration.

## Completion pass, 2026-09-08

- Restored the interrupted task at dc6d911 with no tracked local edits. Preserved the unrelated untracked `docs/home-discovery-preview.html`.
- P2 Core/Release run 34143410135 succeeded. Native run 34143412872 passed 7/8 phone and 6/8 tablet tests: profile save/wrong-password feedback, both reading appearances, large text, login/empty states, and session retry passed. Original screenshots were inspected for the 375pt profile/settings/detail and the tablet catalog.
- The tablet catalog screenshot and accessibility tree show a collapsed `搜索` button; the failing test searched for an input before opening it. The refresh test used a generic scroll-view swipe with no visible-area constraint. Follow-up tests open the search button when needed and keep the pull gesture above the floating tab bar.
- 5d0a94c adds a Core case for A → B → A selection ordering, plus native verification that refreshing AI settings retains an unsaved toggle. Core/Release run 34170460589 succeeded.
- 757754c completes the remaining source-level administration review. Core/Release run 34170594946 succeeded with 35 Core tests; its exact IPA was synchronized before the following native-test repair.
- Native run 34170460939 passed 8/9 phone and 7/9 tablet checks. Both catalog search tests passed. The refresh/retry gesture was not reliable for the short fixture list, and the draft test initially needed a more precise settings scroll and switch hit target. 2b93426 enables discovery bouncing, reveals the link, targets the actual switch control and waits for its value before checking draft preservation; the fixture now fails the first non-empty query once so the reload contract has a deterministic signal.
- Final native run 34172093922 passed all 9/9 phone and 9/9 tablet tests with 0 failures. This includes light/dark reading journeys, accessibility XXXL profile/settings layouts, profile save and wrong-password feedback, login and empty states, session restoration retry, catalog search, deterministic first-page refresh retry, and AI settings draft preservation. The matching `build-ios.yml` run 34172094059 passed Core tests and the unsigned IPA build; `build-run.json` and the local IPA record commit `20c04c8`.

### Coverage and limits

| Area | Evidence available | Remaining manual acceptance |
| --- | --- | --- |
| Discovery, bookshelf, detail, reader | Source contracts; phone/tablet light and dark reading journeys; refresh retry scenario | Real network latency, background recovery, long books and physical-device frame pacing |
| Personal center and account | Profile save, wrong-password feedback, restoration retry; native profile/settings screenshots | Photo-library avatar selection and actual server credential rotation |
| Typography and accessibility layout | 375pt phone and tablet at accessibility XXXL; unpinned profile headings, adaptive reader settings | VoiceOver focus/order, Switch Control and physical keyboard navigation |
| Offline library | Native empty-state route; source inspection of existing download and removal actions | Actual batch download, interruption, storage pressure and offline reading |
| Administration | Source inspection across module entry points, list loading, filter changes, editing/saving and dangerous-action confirmations; catalog search and settings draft native scenarios | Real provider/generation/scrape jobs, destructive mutations, server roles and permissions; not every admin screen has screenshot coverage |

No new P0 blocker was established by this frontend pass. This is a bounded frontend review, not proof that the project has no defects or is ready for App Store release. Comments/ratings and notifications were not added to the approved scope. Builds and fixture-driven tests do not certify real-server mutations or physical-device behavior.
