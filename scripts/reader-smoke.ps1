$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$readerView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/ReaderView.swift") -Raw
$selectableTextView = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/SelectableTextView.swift") -Raw
$infoPlist = Get-Content (Join-Path $projectRoot "ZhiZhou/Support/Info.plist") -Raw

$failures = [System.Collections.Generic.List[string]]::new()

function Require-ReaderPattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

$configureBlock = [regex]::Match(
    $selectableTextView,
    '(?s)private func configure\(_ view: ThoughtSelectableTextView\) \{(.*?)\n    \}\n\}'
)

Require-ReaderPattern "UIKit text updates are gated before relayout" (
    $configureBlock.Success -and
    $configureBlock.Groups[1].Value -match "needsTextUpdate" -and
    $configureBlock.Groups[1].Value -match "(?s)if needsTextUpdate.*?view\.setContentOffset.*?view\.invalidateIntrinsicContentSize"
)
Require-ReaderPattern "scroll view identity changes with the loaded chapter" (
    $readerView -match "let scrollIdentity = readerScrollIdentity" -and
    $readerView -match "\.id\(scrollIdentity\)"
)
Require-ReaderPattern "late scroll restoration has a ScrollViewReader fallback" (
    $readerView -match "ScrollViewReader \{ proxy in" -and
    $readerView -match "restoreScrollTarget\(target, using: proxy, identity: scrollIdentity\)" -and
    $readerView -match "readerTopScrollID"
)
Require-ReaderPattern "scroll progress follows paragraph identity changes" (
    $readerView -match "(?s)\.onChange\(of: scrolledParagraph\) \{ _, index in\s*updatePercent\(from: index\)\s*\}"
)
Require-ReaderPattern "scroll progress is not driven by continuous geometry updates" (
    $readerView -notmatch "(?s)\.onScrollGeometryChange\(for: CGFloat\.self\).*?updatePercent\(fromScrollOffset:"
)
Require-ReaderPattern "chapter loading is keyed and cancellable" (
    $readerView -match "\.task\(id: chapterOrder\)" -and
    $readerView -match "(?s)private func load\(\).*?catch is CancellationError"
)
Require-ReaderPattern "scroll body avoids rebuilding an enumerated array" (
    $readerView -match "ForEach\(paragraphs\.indices, id: \\.self\)"
)
Require-ReaderPattern "chapter reset suppresses stale progress callbacks" (
    $readerView -match "(?s)private func resetForNewChapter\(\).*?suppressPercent = true"
)
Require-ReaderPattern "chapter change no longer starts an unmanaged duplicate load" (
    $readerView -match "(?s)\.onChange\(of: chapterOrder\) \{ _, _ in\s*resetForNewChapter\(\)\s*\}"
)
Require-ReaderPattern "ProMotion devices can use high refresh rates" (
    $infoPlist -match "(?s)<key>CADisableMinimumFrameDurationOnPhone</key>\s*<true\s*/>"
)

if ($failures.Count -gt 0) {
    throw "Reader smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "Reader smoke passed (scroll rendering and chapter restoration contracts)."
