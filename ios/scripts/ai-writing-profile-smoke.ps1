$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$writingViewPath = Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAIWritingView.swift"
$writingView = [System.IO.File]::ReadAllText($writingViewPath, [System.Text.UTF8Encoding]::new($false))
$profileComponent = [System.IO.File]::ReadAllText((Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAIProfileRow.swift"), [System.Text.UTF8Encoding]::new($false))
$profileRowMatch = [regex]::Match(
    $writingView,
    '(?s)    private func profileRow\(.*?\r?\n    // MARK: -'
)
$failures = [System.Collections.Generic.List[string]]::new()

function Require-ProfilePattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

Require-ProfilePattern "profileRow function is present" $profileRowMatch.Success
if ($profileRowMatch.Success) {
    $profileRow = $profileRowMatch.Value
    Require-ProfilePattern "extract and manual-edit buttons keep separate actions" (
        $profileRow -match 'AdminAIProfileRow\(' -and
        $profileComponent.Contains('Button(actionLabel, action: action)') -and
        $profileComponent.Contains('Button("人工校正", action: edit)')
    )
    Require-ProfilePattern "profile action buttons use independent borderless hit regions" (
        $profileComponent -match '\.buttonStyle\(\.borderless\)'
    )
    Require-ProfilePattern "profile body opens a read-only destination without inline full text" (
        $profileComponent.Contains('AdminAIProfileDetailView(') -and
        $profileComponent.Contains('NavigationLink') -and
        $profileComponent -notmatch 'Text\(value\)' -and
        $profileComponent -notmatch '\.onTapGesture'
    )
}

if ($failures.Count -gt 0) {
    throw "AI writing profile smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "AI writing profile smoke passed (separate actions and read-only detail navigation)."
