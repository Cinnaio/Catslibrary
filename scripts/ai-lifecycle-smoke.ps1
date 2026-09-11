$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

function Read-Utf8 {
    param([string]$Path)
    [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
}

$writing = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAIWritingView.swift")
$cover = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Views/Admin/AdminAICoverView.swift")
$taskCoordinator = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Services/AdminAITaskCoordinator.swift")
$adminApi = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Networking/AdminAPI.swift")
$apiClient = Read-Utf8 (Join-Path $projectRoot "ZhiZhou/Networking/APIClient.swift")
$failures = [System.Collections.Generic.List[string]]::new()

function Require-LifecyclePattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

# A profile refresh must survive a transient background/network interruption and
# must not let a best-effort status read erase the successful POST response.
Require-LifecyclePattern "writing screen reloads profiles after becoming active" (
    $writing -match 'private func refreshAfterBecomingActive\(\) async' -and
    $writing -match 'await loadProfileStatuses\(novelID: novelId'
)
Require-LifecyclePattern "writing screen only tears down polling in the background" (
    $writing -match 'else if phase == \.background' -and
    $writing -notmatch 'else \{\s*pollTask\?\.cancel\(\)'
)
Require-LifecyclePattern "profile GETs apply only successful, current-or-newer responses" (
    $writing -match 'if let style,\s*shouldApplyProfileResponse' -and
    $writing -match 'if let plot,\s*shouldApplyProfileResponse' -and
    $writing -match 'if let relation,\s*shouldApplyProfileResponse'
)
Require-LifecyclePattern "profile POST response is applied before status reconciliation" (
    $writing -match 'applyStyleRefreshResponse\(r\)' -and
    $writing -match 'applyPlotRefreshResponse\(r\)' -and
    $writing -match 'applyRelationshipRefreshResponse\(r\)'
)
Require-LifecyclePattern "interrupted profile refresh is reconciled by bounded foreground reads" (
    $writing.Contains('pendingProfileRefreshScope') -and
    $writing.Contains('recoverProfileRefreshAfterBecomingActive()') -and
    $writing.Contains('for attempt in 0..<8')
)
Require-LifecyclePattern "pending profile refresh cannot be submitted twice" (
    $writing -match 'guard pendingProfileRefreshScope\.isEmpty else'
)
Require-LifecyclePattern "transient writing resume errors do not become failure alerts" (
    $writing.Contains('isTransientTaskError(error)') -and
    $writing.Contains('taskStatusText = "')
)
Require-LifecyclePattern "transient cover resume errors do not become failure alerts" (
    $cover.Contains('isTransientTaskError(error)') -and
    $cover.Contains('taskStatusText = "')
)
Require-LifecyclePattern "task resume retries transient status reads" (
    $taskCoordinator.Contains('private func isTransient(_ error: Error)') -and
    $taskCoordinator.Contains('private func retryDelay(for attempt: Int)') -and
    $taskCoordinator -match 'for attempt in 0\.\.<attempts'
)

# Profile model calls can exceed the generic CRUD timeout; the client must make
# that budget explicit instead of turning a still-running server operation into
# the screenshot's -1001 failure.
Require-LifecyclePattern "API client accepts a per-request timeout" (
    $apiClient -match 'timeout: TimeInterval = 30' -and
    $apiClient -match 'req\.timeoutInterval = max\(1, timeout\)'
)
Require-LifecyclePattern "AI profile POSTs use the long model timeout" (
    $adminApi -match 'private static func postAiProfile[\s\S]*?timeout: 420'
)
Require-LifecyclePattern "URLSession resource budget covers the long model request" (
    $apiClient -match 'config\.timeoutIntervalForResource = 420'
)

if ($failures.Count -gt 0) {
    throw "AI lifecycle smoke failed:`n - $($failures -join "`n - ")"
}

Write-Output "AI lifecycle smoke passed (background recovery, profile reconciliation, and model timeout budget)."
