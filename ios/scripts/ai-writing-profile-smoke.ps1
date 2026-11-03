$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$writingViewPath = Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAIWritingView.swift"
$writingView = [System.IO.File]::ReadAllText($writingViewPath, [System.Text.UTF8Encoding]::new($false))
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
        $profileRow -match 'Button\("[^"]+"\)\s*\{\s*action\(\)\s*\}' -and
        $profileRow -match 'Button\("[^"]+"\)\s*\{\s*edit\(\)\s*\}'
    )
    Require-ProfilePattern "profile action buttons use independent borderless hit regions" (
        $profileRow -match '\.buttonStyle\(\.borderless\)'
    )
    Require-ProfilePattern "profile body tap opens manual correction only" (
        ([regex]::Matches($profileRow, '(?s)\.contentShape\(Rectangle\(\)\)\s*\.onTapGesture\s*\{.*?edit\(\)')).Count -ge 2
    )
}

if ($failures.Count -gt 0) {
    throw "AI writing profile smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "AI writing profile smoke passed (separate actions and body-only manual correction)."
