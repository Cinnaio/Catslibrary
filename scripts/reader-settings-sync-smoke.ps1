$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$models = Get-Content (Join-Path $projectRoot "ZhiZhou/Models/Models.swift") -Raw
$store = Get-Content (Join-Path $projectRoot "ZhiZhou/Services/ReaderSettingsStore.swift") -Raw

$failures = [System.Collections.Generic.List[string]]::new()

function Require-ReaderSyncPattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

Require-ReaderSyncPattern "ReaderDevice exposes the mobile API value" (
    $models -match '(?s)enum ReaderDevice: String, Codable, Sendable.*?case mobile'
)
Require-ReaderSyncPattern "reader settings payload carries the device" (
    $models -match '(?s)struct ReaderSettingsPayload: Codable.*?var updatedAt: \[String: Int64\].*?var device: ReaderDevice'
)
Require-ReaderSyncPattern "iOS selects the mobile device scope" (
    $store -match 'private static let syncDevice: ReaderDevice = \.mobile'
)
Require-ReaderSyncPattern "reader settings GET includes the mobile device query" (
    $store -match '"/api/auth/reader-settings\?device=\\\(Self\.syncDevice\.rawValue\)"'
)
Require-ReaderSyncPattern "reader settings PUT includes the mobile device payload" (
    $store -match '(?s)ReaderSettingsPayload\(.*?device: Self\.syncDevice'
)
Require-ReaderSyncPattern "reader settings still persist per account" (
    $store -match 'localStore\.loadSettings\(userID: trimmed\)' -and
    $store -match 'localStore\.saveSettings\(currentSnapshot, userID: activeUserID\)'
)

if ($failures.Count -gt 0) {
    throw "Reader settings sync smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "Reader settings sync smoke passed (iOS uses the mobile device scope)."
