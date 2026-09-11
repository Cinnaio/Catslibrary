$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$writingViewPath = Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAIWritingView.swift"
$writingView = [System.IO.File]::ReadAllText($writingViewPath, [System.Text.UTF8Encoding]::new($false))
$failures = [System.Collections.Generic.List[string]]::new()

function Require-PreferencePattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

Require-PreferencePattern "adult mode enum is present" ($writingView -match 'enum AdultContentMode')
Require-PreferencePattern "explicit mode has a stable wire value" ($writingView -match 'case explicit')
Require-PreferencePattern "all four intimacy weights are present" (
    $writingView -match 'case none' -and
    $writingView -match 'case low' -and
    $writingView -match 'case medium' -and
    $writingView -match 'case high'
)
Require-PreferencePattern "adult character confirmation is present" ($writingView -match 'adultCharactersConfirmed')
Require-PreferencePattern "content preference section is rendered separately" ($writingView -match 'private var contentPreferencesSection')
Require-PreferencePattern "invalid preference combinations block submit" ($writingView -match 'guard contentPreferencesValidationError == nil else')
Require-PreferencePattern "request payload contains content preferences" ($writingView -match 'body\["contentPreferences"\] = writingContentPreferencesPayload')
Require-PreferencePattern "payload includes explicit mode and weight keys" (
    $writingView -match '"adultContentMode": adultContentMode\.rawValue' -and
    $writingView -match '"intimacyWeight": adultContentMode == \.explicit'
)

if ($failures.Count -gt 0) {
    throw "AI writing content preference smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "AI writing content preference smoke passed (mode, weight, confirmation, validation, and payload)."
