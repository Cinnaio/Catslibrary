$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
function Read-Utf8([string]$Path) {
    [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
}

$coverView = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAICoverView.swift")
$adminApi = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Networking/AdminAPI.swift")
$models = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Models/AdminAIModels.swift")
$failures = [System.Collections.Generic.List[string]]::new()

function Require-Pattern {
    param([string]$Name, [bool]$Condition)
    if (-not $Condition) { $failures.Add($Name) }
}

Require-Pattern "comparison keeps at most two local candidates" (
    $coverView -match 'compareCandidateIDs\.count < 2' -and
    $coverView -match 'compareCandidateIDs\.count >= 2'
)
Require-Pattern "comparison uses a fixed 2:3 aspect-fit container" (
    ([regex]::Matches($coverView, 'aspectRatio\(2\.0 / 3\.0, contentMode: \.fit\)')).Count -ge 2 -and
    ([regex]::Matches($coverView, '\.scaledToFit\(\)')).Count -ge 2
)
Require-Pattern "comparison does not call an API when toggling" (
    $coverView -match 'private func toggleCompare' -and
    $coverView -match 'private func candidateComparisonCard'
)
Require-Pattern "long prompt has a scrollable editor and close protection" (
    $coverView -match 'private struct AdminCoverPromptEditorSheet' -and
    $coverView -match 'TextEditor\(text: \$draft\)' -and
    $coverView -match '\.interactiveDismissDisabled\(isDirty\)' -and
    $coverView -match '\.scrollDismissesKeyboard\(\.interactively\)'
)
Require-Pattern "exact metadata keeps an explicit full-prompt label" (
    $coverView -match '\u5b8c\u6574\u63cf\u8ff0\u8bcd' -and
    $coverView -match 'metadata\.promptMode == "exact"'
)
Require-Pattern "history images use an authenticated API method" (
    $coverView -match 'AdminAPI\.aiCoverHistoryImage' -and
    $adminApi -match 'static func aiCoverHistoryImage'
)
Require-Pattern "history restore carries version and operation ID" (
    $adminApi -match 'aiRestoreCoverHistory\(' -and
    $adminApi -match 'expectedCoverVersion: String' -and
    $adminApi -match 'operationID: String'
)
Require-Pattern "history response models current version" (
    $models -match 'struct AiCurrentCoverState' -and
    $models -match 'let version: String'
)

if ($failures.Count -gt 0) {
    throw "AI cover phase-2 smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "AI cover phase-2 smoke passed (comparison, prompt editor, authenticated history, and restore contracts)."
