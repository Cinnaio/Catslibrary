$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$homeView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/HomeView.swift") -Raw
$bookshelfView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/BookshelfView.swift") -Raw
$detailView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/NovelDetailView.swift") -Raw
$adminRootView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminRootView.swift") -Raw

$failures = [System.Collections.Generic.List[string]]::new()

function Require-NavigationPattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

# Compact-width entry points must own their destination so a tap cannot depend
# on a selection binding or a destination registered on another navigation tree.
Require-NavigationPattern "homepage compact row has a direct NovelDetailView destination" (
    $homeView -match 'NavigationStack\(path: \$navigationPath\)[\s\S]*?navigationDestination\(for: HomeRoute\.self\)[\s\S]*?case \.novel\(let novel\):[\s\S]*?NovelDetailView'
)
Require-NavigationPattern "homepage compact root explicitly restores the tab bar when returning from a hidden destination" (
    $homeView -match '(?s)NavigationStack\(path: \$navigationPath\)\s*\{\s*homeList\s*\.toolbar\(\.visible, for: \.tabBar\)'
)
Require-NavigationPattern "homepage compact row has no trailing NavigationLink indicator" (
    $homeView -notmatch "private func novelRow[\s\S]*?if horizontalSizeClass != \.regular[\s\S]*?NavigationLink"
)
Require-NavigationPattern "homepage compact row navigates through its path" (
    $homeView -match "private func novelRow[\s\S]*?if horizontalSizeClass != \.regular[\s\S]*?navigationPath\.append\(\.novel\(novel\)\)"
)
Require-NavigationPattern "homepage uses the standard large title" (
    $homeView -match 'navigationTitle\("发现"\)[\s\S]*?navigationBarTitleDisplayMode\(\.large\)'
)
Require-NavigationPattern "homepage removes the promotional header copy" (
    $homeView -notmatch "书海里，遇见好故事"
)
Require-NavigationPattern "continue reading hero omits a redundant chapter title" (
    $homeView -match "(?s)private func continueReadingChapterTitle.*?normalizedTitle.*?normalizedOrder" -and
    $homeView -match "(?s)if let chapterTitle = continueReadingChapterTitle\(item\).*?Text\(chapterTitle\)" -and
    $homeView -notmatch "(?s)private func continueReadingHero.*?Text\(item\.chapterTitle\)"
)
Require-NavigationPattern "homepage content clears the floating tab bar" (
    $homeView -match "(?s)\.safeAreaInset\(edge: \.bottom, spacing: 0\)\s*\{\s*Color\.clear\s*\.frame\(height: 24\)\s*\}"
)
Require-NavigationPattern "homepage catalog rows align with the content edge" (
    $homeView -match "(?s)else \{\s*LazyVStack\(alignment: \.leading, spacing: 0\)"
)
Require-NavigationPattern "homepage section headers keep breathing room" (
    $homeView -match '(?s)sectionHeader\("继续阅读"\).*?\.padding\(\.bottom, 12\)' -and
    $homeView -match '(?s)trailing: totalNovelCount.*?\.padding\(\.bottom, 12\)'
)
Require-NavigationPattern "homepage keeps one native pull-to-refresh indicator" (
    $homeView -match "\.refreshable \{[\s\S]*?await reload\(\)[\s\S]*?await loadReadingContext\(\)[\s\S]*?\}" -and
    $homeView -notmatch "\.toolbar[\s\S]*?isLoading && !novels\.isEmpty[\s\S]*?ProgressView"
)
Require-NavigationPattern "bookshelf recent row has a compact direct destination" (
    $bookshelfView -match "private func recentLink[\s\S]*?if horizontalSizeClass != \.regular[\s\S]*?NavigationLink"
)
Require-NavigationPattern "bookshelf favorite row has a compact direct destination" (
    $bookshelfView -match "private func favoriteLink[\s\S]*?if horizontalSizeClass != \.regular[\s\S]*?NavigationLink"
)
Require-NavigationPattern "bookshelf rows do not depend on BookshelfRoute value destinations" (
    $bookshelfView -notmatch "NavigationLink\(value: BookshelfRoute"
)
Require-NavigationPattern "reader entry links own a direct ReaderView destination" (
    $detailView -notmatch "NavigationLink\(value: ReaderLaunch" -and
    $detailView -match "NavigationLink[\s\S]*?ReaderView"
)
Require-NavigationPattern "admin operations expose a direct POPO account entry" (
    $adminRootView -match 'AdminModule\(id: "popo-account", title: "POPO 账号", systemImage: "person\.badge\.key", destination: \.popoAccount\)' -and
    $adminRootView -match 'case \.popoAccount: Po18AccountSheet\(\)'
)
Require-NavigationPattern "novel detail keeps synopsis expansion available when text is truncated" (
    $detailView -match 'synopsisFullHeight > synopsisCollapsedHeight \+ 1' -and
    $detailView -match '(?s)private var synopsisContent.*?\.lineLimit\(4\).*?synopsisCollapsedHeight = height' -and
    $detailView -match '(?s)\.frame\(height: synopsisVisibleHeight, alignment: \.topLeading\).*?synopsisFullHeight = height.*?\.clipped\(\)' -and
    $detailView -match 'expandDescription \? synopsisFullHeight : synopsisCollapsedHeight' -and
    $detailView -notmatch 'lineLimit\(expandDescription \?' -and
    $detailView -match '(?s)private var synopsisText.*?Text\(currentNovel\.description\)'
)
Require-NavigationPattern "novel detail reserves space and a scroll edge for its fixed reading or selection actions" (
    $detailView -match '(?s)\.safeAreaBar\(edge: \.bottom, spacing: 0\)\s*\{\s*bottomBar' -and
    $detailView -match '(?s)private var bottomBar.*?if isSelectingOffline \{\s*offlineSelectionBar\s*\} else \{\s*readingBar' -and
    $detailView -match '(?s)private var readButton.*?NavigationLink\s*\{\s*ReaderView'
)
Require-NavigationPattern "novel detail retains download actions in its sheet" (
    $detailView -match '(?s)\.sheet\(isPresented: \$showOfflineOptions\)\s*\{\s*offlineDownloadSheet' -and
    $detailView -match '(?s)private var offlineDownloadSheet.*?startAllDownload\(\).*?enterOfflineSelection\(\)' -and
    $detailView -match '(?s)private var offlineSelectionBar.*?startSelectedDownload\(\).*?\.disabled\(selectedDownloadChapters\.isEmpty \|\| offlineStore\.isBatchDownloading\)'
)

if ($failures.Count -gt 0) {
    throw "Navigation smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "Navigation smoke passed (homepage, bookshelf, and reader entry points)."
