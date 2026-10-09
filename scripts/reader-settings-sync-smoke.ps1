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

Require-ReaderSyncPattern "ReaderDevice exposes the ios API value" (
    $models -match '(?s)enum ReaderDevice: String, Codable, Sendable.*?case ios'
)
Require-ReaderSyncPattern "reader settings payload carries the device" (
    $models -match '(?s)struct ReaderSettingsPayload: Codable.*?var updatedAt: \[String: Int64\].*?var device: ReaderDevice'
)
Require-ReaderSyncPattern "iOS selects the ios device scope" (
    $store -match 'private static let syncDevice: ReaderDevice = \.ios'
)
Require-ReaderSyncPattern "reader settings GET includes the ios device query" (
    $store -match '"/api/auth/reader-settings\?device=\\\(Self\.syncDevice\.rawValue\)"'
)
Require-ReaderSyncPattern "reader settings PUT includes the ios device payload" (
    $store -match '(?s)ReaderSettingsPayload\(.*?device: Self\.syncDevice'
)
Require-ReaderSyncPattern "reader settings still persist per account" (
    $store -match 'localStore\.loadSettings\(userID: trimmed\)' -and
    $store -match 'localStore\.saveSettings\(currentSnapshot, userID: activeUserID\)'
)

if ($failures.Count -gt 0) {
    throw "Reader settings sync smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "Reader settings sync smoke passed (iOS uses the ios device scope)."
