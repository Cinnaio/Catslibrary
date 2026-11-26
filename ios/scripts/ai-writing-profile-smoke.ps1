$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$writingViewPath = Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAIWritingView.swift"
$writingView = [System.IO.File]::ReadAllText($writingViewPath, [System.Text.UTF8Encoding]::new($false))
$profileComponent = [System.IO.File]::ReadAllText((Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAIProfileRow.swift"), [System.Text.UTF8Encoding]::new($false))
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

# Writing now links to analysis reports instead of creating legacy profiles.
Require-ProfilePattern "writing exposes analysis reports for the selected book and chapter" (
    $writingView.Contains('analysisReferenceSection') -and
    $writingView.Contains('Link("阅读与修订分析报告", destination: analysisURL)') -and
    $writingView.Contains('URLQueryItem(name: "novel", value: novelId)') -and
    $writingView.Contains('URLQueryItem(name: "afterChapterId", value: afterChapterId)')
)
Require-ProfilePattern "legacy profile actions remain independent from read-only navigation" (
    $profileComponent.Contains('Button(actionLabel, action: action)') -and
    $profileComponent.Contains('Button("人工校正", action: edit)') -and
    $profileComponent.Contains('AdminAIProfileDetailView(') -and
    $profileComponent.Contains('.buttonStyle(.borderless)') -and
    $profileComponent -notmatch '\.onTapGesture'
)

if ($failures.Count -gt 0) {
    throw "AI writing profile smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "AI writing profile smoke passed (analysis report entry and separate legacy actions)."
