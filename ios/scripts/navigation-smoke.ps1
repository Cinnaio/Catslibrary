$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

function Read-Utf8 {
    param([string]$Path)
    [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

$homeView = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Views/HomeView.swift')
$bookshelfView = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Views/BookshelfView.swift')
$detailView = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Views/NovelDetailView.swift')
$adminSourcesView = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Views/Admin/AdminScrapeSourcesView.swift')

$rootView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/RootView.swift") -Raw
$windowLayout = Get-Content (Join-Path $projectRoot "ZhiZhou/Theme/ReadingSpaceWindowLayout.swift") -Raw

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

# Rotation and window resizing must not replace the navigation tree on any device.
Require-NavigationPattern 'homepage stack row has a direct NovelDetailView destination' (
    $homeView -match 'NavigationStack\(path: \$navigationPath\)[\s\S]*?navigationDestination\(for: HomeRoute\.self\)[\s\S]*?case \.novel\(let novel\):[\s\S]*?NovelDetailView'
)
Require-NavigationPattern 'homepage stack row has no trailing NavigationLink indicator' (
    $homeView -notmatch 'private func novelRow[\s\S]*?NavigationLink'
)
Require-NavigationPattern 'homepage stack row navigates through its path' (
    $homeView -match 'private func novelRow[\s\S]*?navigationPath\.append\(\.novel\(novel\)\)'
)
Require-NavigationPattern 'homepage uses a paper heading and compact native navigation' (
    $homeView -match '(?s)Text\("\u53d1\u73b0"\).*?serifFont\(\.largeTitle' -and
    $homeView -match 'navigationBarTitleDisplayMode\(\.inline\)'
)
Require-NavigationPattern 'homepage removes the promotional header copy' (
    $homeView -notmatch '\u4e66\u6d77\u91cc\uff0c\u9047\u89c1\u597d\u6545\u4e8b'
)
Require-NavigationPattern 'continue reading hero omits a redundant chapter title' (
    $homeView -match '(?s)private func continueReadingChapterTitle.*?normalizedTitle.*?normalizedOrder' -and
    $homeView -match '(?s)if let chapterTitle = continueReadingChapterTitle\(item\).*?Text\(chapterTitle\)' -and
    $homeView -notmatch '(?s)private func continueReadingHero.*?Text\(item\.chapterTitle\)'
)
Require-NavigationPattern 'homepage content clears the floating tab bar' (
    $homeView -match '(?s)\.safeAreaInset\(edge: \.bottom, spacing: 0\)\s*\{\s*Color\.clear\s*\.frame\(height: 24\)\s*\}'
)
Require-NavigationPattern 'homepage catalog rows align with the content edge' (
    $homeView -match '(?s)else \{\s*LazyVStack\(alignment: \.leading, spacing: 0\)'
)
Require-NavigationPattern "homepage section headers keep breathing room" (
    $homeView -match '(?s)continueReadingHero\(recentReading\)\s*\.padding\(\.bottom, 24\)' -and
    $homeView -match '(?s)sectionHeader\(catalogTitle, trailing:.*?\.padding\(\.bottom, 16\)'
)
Require-NavigationPattern 'homepage keeps one native pull-to-refresh indicator' (
    $homeView -match '\.refreshable \{[\s\S]*?await reload\(\)[\s\S]*?await loadReadingContext\(\)[\s\S]*?\}' -and
    $homeView -notmatch '\.toolbar[\s\S]*?isLoading && !novels\.isEmpty[\s\S]*?ProgressView'
)
Require-NavigationPattern 'discovery and bookshelf retain one path across width classes' (
    $homeView -notmatch 'NavigationSplitView|usesStackNavigation|selectedReaderLaunch' -and
    $bookshelfView -notmatch 'NavigationSplitView|phoneBookshelf|horizontalSizeClass' -and
    $bookshelfView -match '(?s)private var adaptiveBookshelf.*?NavigationStack\(path: \$navigationPath\).*?\.navigationDestination\(for: BookshelfRoute\.self\)'
)
Require-NavigationPattern 'bookshelf buttons append selected books on every device' (
    $bookshelfView -match '(?s)private func recentLink.*?Button \{.*?navigationPath\.append\(route\)' -and
    $bookshelfView -match '(?s)private func favoriteLink.*?Button \{.*?navigationPath\.append\(route\)'
)
Require-NavigationPattern 'bookshelf cover grids use a lazy scroll surface with individual items instead of shared list rows' (
    $bookshelfView -match '(?s)private func bookshelfContent.*?if usesAdaptiveCoverGrid \{\s*ScrollView' -and
    $windowLayout -match '(?s)struct ReadingSpaceCoverGrid.*?LazyVGrid.*?ForEach\(Array\(items\.enumerated\(\)\), id: \\.element\.id\)' -and
    $bookshelfView -notmatch 'ReadingSpaceCoverRows|phoneCoverRows'
)
Require-NavigationPattern 'iPhone favorites use two cover columns while recent and editing retain native rows' (
    $bookshelfView -match 'showsCoverGrid && \(ReadingSpaceWindowLayout\.usesIPadLayout \|\| showsFavorites\)' -and
    $bookshelfView -match '(?s)let columns = ReadingSpaceWindowLayout\.usesIPadLayout\s*\? ReadingSpaceWindowLayout\.coverColumns\(for: geometry\.size\.width\) : 2' -and
    $bookshelfView -match 'dynamicTypeSize < \.xxxLarge && !editMode\.isEditing'
)
Require-NavigationPattern 'iPad bottom tabs restore the real window size class for all four pages' (
    $rootView -match 'usesIPadLayout \? \.compact : windowSizeClass' -and
    ([regex]::Matches($rootView, '\.environment\(\\.horizontalSizeClass, windowSizeClass\)').Count -eq 4)
)
Require-NavigationPattern 'iPad discovery and bookshelf search live inside their content bounds' (
    $homeView -match '(?s)private var searchHeader.*?ReadingSpaceSearchField.*?\.padding\(\.horizontal, 22\).*?\.frame\(maxWidth: 760\)' -and
    $bookshelfView -match '(?s)private func bookshelfRows.*?ReadingSpaceSearchField' -and
    $bookshelfView -match '(?s)private func searchableBookshelfContent.*?if ReadingSpaceWindowLayout\.usesIPadLayout.*?else \{.*?\.searchable'
)
Require-NavigationPattern 'reader entry links own a direct ReaderView destination' (
    $detailView -notmatch 'NavigationLink\(value: ReaderLaunch' -and
    $detailView -match 'NavigationLink[\s\S]*?ReaderView'
)
Require-NavigationPattern 'source management exposes account actions for available sources' (
    $adminSourcesView -match 'ForEach\(sourceAccounts\)' -and
    $adminSourcesView -match '\.sheet\(item: \$selectedAccount\)[\s\S]*?SourceAccountSheet\(source: source\)'
)
Require-NavigationPattern 'novel detail keeps synopsis expansion available when text is truncated' (
    $detailView -match 'synopsisFullHeight > synopsisCollapsedHeight \+ 1' -and
    $detailView -match '(?s)private var synopsisContent.*?\.lineLimit\(4\).*?synopsisCollapsedHeight = height' -and
    $detailView -match '(?s)\.frame\(height: synopsisVisibleHeight, alignment: \.topLeading\).*?synopsisFullHeight = height.*?\.clipped\(\)' -and
    $detailView -match 'expandDescription \? synopsisFullHeight : synopsisCollapsedHeight' -and
    $detailView -notmatch 'lineLimit\(expandDescription \?' -and
    $detailView -match '(?s)private var synopsisText.*?Text\(currentNovel\.description\)'
)
Require-NavigationPattern 'novel detail reserves space for reading or selection actions' (
    $detailView -match '(?s)\.safeAreaInset\(edge: \.bottom, spacing: 0\)\s*\{\s*bottomBar' -and
    $detailView -match '(?s)private func bottomBar.*?if isSelectingOffline \{\s*offlineSelectionBar\s*(?:\.transition\(selectionModeTransition\)\s*)?\} else \{\s*readingBar' -and
    $detailView -match '(?s)private var readButton.*?NavigationLink\s*\{\s*ReaderView'
)
Require-NavigationPattern 'novel detail retains download actions in its sheet' (
    $detailView -match '(?s)\.sheet\(isPresented: \$showOfflineOptions\)\s*\{\s*offlineDownloadSheet' -and
    $detailView -match '(?s)private var offlineDownloadSheet.*?startAllDownload\(\).*?enterOfflineSelection\(\)' -and
    $detailView -match '(?s)private var offlineSelectionBar.*?startSelectedDownload\(\).*?\.disabled\(selectedDownloadChapters\.isEmpty \|\| offlineStore\.isBatchDownloading\)'
)

if ($failures.Count -gt 0) {
    $details = $failures -join ([Environment]::NewLine + ' - ')
    throw ('Navigation smoke failed:' + [Environment]::NewLine + ' - ' + $details)
}

Write-Output 'Navigation smoke passed (homepage, bookshelf, and reader entry points).'
