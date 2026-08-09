---
target: admin operations panel (web/src/pages/admin)
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-09T09-46-46Z
slug: web-src-pages-admin
---
# Critique: 知舟 Admin Operations Panel

**Method: dual-agent (A: a6e011e0e8fa50e5f · B: af98c39416845b69c)**

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Jobs auto-polls well; Dashboard only refreshes on click |
| 2 | Match System / Real World | 4 | Domain language strong; Sources filter mixes EN full/partial |
| 3 | User Control and Freedom | 3 | Dialogs escape cleanly; sub-tab state resets on tab switch |
| 4 | Consistency and Standards | 2 | Same single-choice concept in 5 different widgets |
| 5 | Error Prevention | 3 | Itemized confirms + duplicate detection; danger defaults wrongly |
| 6 | Recognition Rather Than Recall | 3 | Sortable + server-search; 9-column Jobs table, raw regex walls |
| 7 | Flexibility and Efficiency | 3 | Batch ops + searchable combobox; Moderation no pagination |
| 8 | Aesthetic and Minimalist Design | 2 | Calm palette; meta pills at title size, Dashboard cards differ |
| 9 | Error Recovery | 3 | Toasts + inline errors; some opaque messages |
| 10 | Help and Documentation | 2 | Form hints good; scrape flow no first-run guidance |
| **Total** | | **28/40** | **Good** |

## Design Specificity Verdict

**COHERENT.** This is unmistakably a novel-library console, not a skin over generic admin. The lexicon (馆藏运营台, 藏 seal, 书源/爬虫/融合章节名), the staged scrape wizard (analyze → confirm → scrape), and the serif 舟 brand mark are deeply product-specific. The milk-tea accent that carries "The Paper Sanctuary" identity, however, is broken by an undefined CSS variable — the *intended* identity is stronger than the *rendered* one.

**LLM assessment:** Structurally the admin reads as one product. The weakest coherence point is that Dashboard cards keep generic shadcn `shadow-sm` + 16px radius while every other panel is flat 10px — the first screen an admin sees looks like a different app.

**Deterministic scan:** TSX sources clean (0 findings, engine verified working). The real findings live in CSS: `layout-transition` (transition: width, _admin-ui.css:923), `side-tab` 3px stripes (.scrape-side-card::before :722, .account-card::before :963). Browser detector (3 views, injected live): **low-contrast 9–15/view** (#9A938A at 2.8–3.0:1, below 4.5:1 AA), **undersized-ui-text 6–13/view** (10px 运营工作区, 10.4px nav labels, 10.88px table headers), **layout-transition 7/view**, nested-cards, cramped-padding. Also one a11y issue: a form field without id/name.

**False positives flagged:** marquee/dark-glow/radial-halo come from app-global CSS for the reader page (not rendered in admin); side-tab stripes are overridden by `display:none` in admin-operations.css:274 but still reported.

## Overall Impression

A genuinely well-crafted Operate surface with a strong, distinct identity — the scrape center's staged disclosure and the itemized confirm dialogs are highlights. The single biggest opportunity is fixing the broken `--primary` token, which silently strips the milk-tea brown from the three most-seen elements (brand mark, active tab, row hover), and the dialog surface regression where every modal renders as a grey void with an ink outline instead of a warm paper panel.

## What's Working

1. **Scrape center staged disclosure** — numbered steps, sticky preflight/config side cards, collapsible advanced selectors, live job cards with expandable logs. The most "designed" part of the surface.
2. **High-stakes confirmation design** — every delete lists exact titles + chapter counts; reset-password shows temp password once with copy; promote/demote warns scope.
3. **Deep-link highlight plumbing** — jumping from a novel's detail "管理" button to search-and-scroll in the admin is thoughtful cross-surface integration.

## Priority Issues

1. **[P1] Dead `--primary` token kills the signature accent.** admin-operations.css references `var(--primary)` 7× (brand mark:37-40, active-tab bar:72, row hover:195, sort-active:213, deep-link flash:217) but it's never defined — shadcn uses `--sh-primary`. The brown is the entire "Paper Sanctuary" identity and it's absent from the most-navigated elements.
   **Fix:** replace `var(--primary)` → `var(--sh-primary)` and `--primary-foreground` → `var(--sh-primary-foreground)` in admin-operations.css.
   **Suggested command:** /impeccable polish

2. **[P1] Admin dialogs lose their paper surface.** `admin-dialog` styles rely on `--admin-panel`/`--admin-border-strong` scoped to `.admin-layout`, but Radix portals render at body level *outside* that ancestor — so dialog content computes transparent bg + espresso-ink border.
   **Fix:** define `--admin-*` tokens on `:root` (or on `[data-slot="dialog-content"]`) so portals inherit the warm panel surface.
   **Suggested command:** /impeccable polish

3. **[P1] Muted text fails WCAG contrast.** `--text-muted` #9A938A scores 2.8–3.0:1 (needs 4.5:1). Affects table headers, timestamps, helper labels, kickers — every secondary label across all 8 tabs.
   **Fix:** darken muted token (~#7A746C light / adjust dark theme) or raise the font floor on the worst offenders.
   **Suggested command:** /impeccable audit + /impeccable typeset

4. **[P2] Meta pills render at title size inside `<h2>`.** AdminTabHeader places `meta` inside the heading and `.section-header__meta` sets only border/bg — so "共 0 本 · 第1/1页" and the scrape hero chips render at ~23px/700 inside the heading.
   **Fix:** give `.section-header__meta` an explicit 11-12px normal-weight size; consider rendering meta outside the `<h2>`.
   **Suggested command:** /impeccable typeset

5. **[P2] Default-danger confirm paints positive actions red.** feedback.tsx:86 defaults `danger: true`, so 开始抓取 and 批量抓取 show destructive red confirm buttons.
   **Fix:** default `danger: false`, pass `danger: true` explicitly at delete call sites, `danger: false` at scrape-start.
   **Suggested command:** /impeccable polish

## Persona Red Flags

**Alex (Power User):**
- Moderation queue hard-caps at 80 items with **no pagination** — older reports unreachable.
- Batch update floods 20+ sequential toasts with 400ms throttle; the summary lands after the barrage.
- Sub-tab state resets on sidebar switch — 书源管理 → 任务管理 → back always lands on 抓取中心.
- Jobs table can't be filtered/searched by novel; 9 micro-columns with truncated IDs.
- Discover page-jump fires a scrape request on every valid keystroke.
- Dead `--primary` removes sort-active and row-hover affordances for scanning large tables.

**Sam (Accessibility-Dependent):**
- Discover result cards and job-card log toggles are `div[onClick]` with no `role`/`tabindex` — keyboard users can't open them.
- Muted #9A938A at 2.8-3.0:1 fails AA; 10.88px uppercase table headers are small for low-vision.
- Counts inside `<h2>` read as one heading phrase ("小说管理共 0 本 · 第1/1页").
- Disabled buttons show cursor:pointer and half-opacity red — misleading affordance.
- (Positives: role=status on 管理员模式, aria-sort/aria-current, sr-only search label, prefers-reduced-motion respected.)

## Minor Observations

- `document.title` stays "知舟 — 小说阅读" on /admin; a "知舟管理台" title helps tab recognition.
- Empty novel selector shows "没有匹配的选项" — should say "暂无小说" for an empty library.
- Batch-log footer hardcodes "跳过 0" even when skips occur.
- Dashboard says "即时状态" but only refreshes manually.
- Settings top cards are unequal heights (219px vs 313px).
- Sources table header mixes "HOST" caps among Chinese columns.
- `--admin-radius` (10px) defined but shadcn Cards keep rounded-xl (16px) — radius token partially unused.
- .admin .card / .novel-toolbar mobile rules are dead after the AdminTabHeader refactor.

## Questions to Consider

- If the token-mapping refactor was verified against the spec, why did the one token that defines the palette (`--primary`) go unverified?
- When red stops meaning "irreversible deletion" and starts meaning "any action worth double-checking," has the danger signal lost its meaning?
- Are the Jobs and Moderation tables designed for the day a self-hosted site reaches 10,000 chapters and 500 reports, or for the demo today?
