$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$components = Get-Content (Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminComponents.swift") -Raw
$adminApi = Get-Content (Join-Path $projectRoot "ZhiZhou/Networking/AdminAPI.swift") -Raw
$adminViews = (Get-ChildItem (Join-Path $projectRoot "ZhiZhou/Views/Admin") -Filter "*.swift" |
    ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"

$failures = [System.Collections.Generic.List[string]]::new()

function Require-AdminOperationPattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

$actions = @(
    "batchDeleteAIGenerations",
    "batchDeleteScrapeSources",
    "deleteUnreachableScrapeSources",
    "clearCompletedScrapeJobs",
    "clearInvites",
    "terminateAITask",
    "terminateScrapeJob",
    "adoptCoverCandidate",
    "uploadCover",
    "replaceSourceMetadata",
    "importScrapeConfigs",
    "importLegadoSources"
)

foreach ($action in $actions) {
    Require-AdminOperationPattern "dangerous action '$action' is centrally registered" (
        $components -match "case $action ="
    )
    Require-AdminOperationPattern "dangerous action '$action' is used by an admin view" (
        $adminViews -match "\.$action"
    )
}

Require-AdminOperationPattern "confirmation creates one stable operation ID" (
    $components -match 'let operationID: String' -and
    $components -match 'UUID\(\)\.uuidString\.lowercased\(\)'
)
Require-AdminOperationPattern "confirmation freezes target IDs" (
    $components -match 'let targetIDs: \[String\]'
)
Require-AdminOperationPattern "dangerous API payloads carry operationId" (
    ([regex]::Matches($adminApi, '"operationId"')).Count -ge 10
)
Require-AdminOperationPattern "AI generation batch delete requires an operation ID" (
    $adminApi -match 'aiDeleteGenerations\(ids: \[String\], operationID: String\)'
)
Require-AdminOperationPattern "AI task cancellation requires an operation ID" (
    $adminApi -match 'cancelAiTask\(id: String, operationID: String\)'
)
Require-AdminOperationPattern "cover overwrite APIs require an operation ID" (
    $adminApi -match 'aiAdoptCoverCandidate\(id: String, operationID: String\)' -and
    $adminApi -match 'aiUploadCover\([\s\S]*?operationID: String'
)

if ($failures.Count -gt 0) {
    throw "Admin operation smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "Admin operation smoke passed (confirmations, stable IDs, and target snapshots)."
