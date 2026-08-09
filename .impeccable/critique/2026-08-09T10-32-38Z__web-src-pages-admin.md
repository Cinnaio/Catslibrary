---
target: admin operations panel (web/src/pages/admin)
total_score: 32
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-08-09T10-32-38Z
slug: web-src-pages-admin
---
# Critique: 知舟 Admin Operations Panel (Round 2)

**Method: dual-agent (A: a7fe2a5f1418e4110 · B: a858b96c0c1daebdb)**

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Live job cards poll with progress/ETA/logs; adaptive polling best-in-class |
| 2 | Match System / Real World | 4 | Natural domain vocabulary, numbered 3-step scrape flow |
| 3 | User Control and Freedom | 3 | Clean cancels; no undo for destructive ops (mitigated by confirms) |
| 4 | Consistency and Standards | 3 | AdminTabHeader variant is dead code; side-card treatment inconsistent |
| 5 | Error Prevention | 3 | Danger correctly reserved; ChaptersTab batch-delete shows literal "N" |
| 6 | Recognition Rather Than Recall | 4 | Sticky preflight/summary cards; operator never recalls state |
| 7 | Flexibility and Efficiency | 3 | Batch ops + jump pagination; no keyboard paths |
| 8 | Aesthetic and Minimalist Design | 3 | Dense but organized; orphaned account-card gradient/stripe |
| 9 | Error Recovery | 3 | Toasts + inline errors; no inline field validation |
| 10 | Help and Documentation | 2 | Scrape guidance strong; regex/invite/encoding fields lack help |
| **Total** | | **32/40** | **Good (+4 from 28)** |

## Trend

> **Trend for `web-src-pages-admin` (last 5 runs): 28 → 32 (out of 40)**
> Wrote `.impeccable/critique/<filename>`.

## Design Specificity Verdict

**GOOD.** The milk-tea brown seal (舟, white serif glyph), 馆藏运营台 context label, cream canvas with faint vertical grid, and single-character serif stat stamps (馆/章/客/今/警/封/库) all carry 知舟 identity into operations. All 7 previous fixes verified in live DOM (both themes). Two pockets of legacy surface remain: account cards keep a radial-gradient + 3px stripe, scrape side cards keep a 1px shadow — two design generations coexist.

**Deterministic scan:** TSX clean (0). CSS: 3 findings (2 side-tab false positives + 1 progress-bar transition). Browser per-view: 总览 21→**8**, 小说管理 18→**8**, 爬虫抓取 17→**11**. **low-contrast and undersized-ui-text fully cleared** in all views. Remaining real: cramped-padding (table-wrapper flush), nested-cards, kicker-above-heading (intentional editorial), flat-type-hierarchy, transient login-gate contrast.

## Overall Impression

The fixes landed cleanly and verifiably — the surface is now a coherent warm-paper console. The remaining work is granular: one broken microcopy string, one a11y regression from the role fix, two pockets of legacy surface treatment, and a type hierarchy that's a touch flat for long scanning sessions.

## Priority Issues

1. **[P2] Literal "N" in ChaptersTab batch-delete confirm (REMAINING, newly surfaced).** `ChaptersTab.tsx:231` renders "确定删除以下 N 个章节？" with a literal "N" instead of `${selectedIds.size}` — NovelsTab correctly interpolates. Operator cannot judge blast radius.
   **Fix:** interpolate the count. → /impeccable clarify

2. **[P2] Nested interactive Discover cards (NEW — introduced by role="button" fix).** `DiscoverView.tsx:289` wraps a real focusable `<Checkbox>` inside a `div role="button"`; checkbox has only `title="选择"` no aria-label. AT announces a button containing a checkbox; Enter/Space ambiguity.
   **Fix:** make card an `article` wrapper, checkbox gets `aria-label={`选择 ${n.title}`}`, detail action on a real button. → /impeccable audit

3. **[P2] Inconsistent side-card surface (REMAINING).** `.account-card::before` gradient+stripe and `.scrape-side-card` 1px shadow coexist with flat `--admin-panel` standard.
   **Fix:** flatten both to admin-panel standard; delete orphaned `::before` stripes. → /impeccable layout

4. **[P3] Flat type hierarchy (REMAINING).** Operative scale 11.2→16px with ~1.4 ratio; headings rely on weight/uppercase not size.
   **Fix:** add deliberate size steps (section-title → 1.35rem, table row titles → 13.5px, stat values → 1.75rem). → /impeccable typeset

5. **[P3] AdminTabHeader `variant` is dead code (REMAINING).** Both `hero` and `section` render `section-header` — hero tabs look identical to plain ones.
   **Fix:** give hero a larger title/description, or remove the prop. → /impeccable polish

## Persona Red Flags

**Alex (Power User):** No keyboard path — no `/` focus-search, no Enter-to-submit in add-novel dialog, no single-key row actions. Moderation renders up to 80 rows with no pagination/virtualization.

**Sam (Accessibility-Dependent):** NEW nested-interactive Discover cards; unlabeled Discover checkbox; literal-"N" confirm; `role="status"` on persistent 管理员模式 pill announces on every load; job-spinner has no prefers-reduced-motion guard.

## Minor Observations

- Dashboard 数据库大小 shows "—" when null — consider 未统计.
- Jobs tab has both header 刷新 and self-polling — two refresh affordances.
- Dashboard status bar renders empty track when all counts are 0.
- React warning "Dialog changing from uncontrolled to controlled" in 添加小说 dialog.
- Login-gate 前往登录 button computed 3.0:1 transiently (load-state).
- 1-3 unlabeled form fields / missing id-name per view.

## Questions to Consider

- If 馆藏运营台 is the identity, why do account/scrape cards still speak an older ornamented dialect (gradient + stripe + shadow)? Which dialect wins?
- Is neutral the right weight for starting a multi-minute crawl? What would a non-scary-but-prominent confirm look like?
- What is the one keyboard affordance that unlocks the most efficiency for Alex per line of code?
