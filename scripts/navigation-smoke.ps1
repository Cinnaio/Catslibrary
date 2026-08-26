$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$homeView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/HomeView.swift") -Raw
$bookshelfView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/BookshelfView.swift") -Raw
$detailView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/NovelDetailView.swift") -Raw

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
    $homeView -match "private func novelRow[\s\S]*?if horizontalSizeClass != \.regular[\s\S]*?NavigationLink[\s\S]*?NovelDetailView"
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

if ($failures.Count -gt 0) {
    throw "Navigation smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "Navigation smoke passed (homepage, bookshelf, and reader entry points)."
