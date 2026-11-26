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

# Native writing now consumes completed analysis reports; the old profile POST
# workflow lives outside this screen. Verify the current task recovery contract.
Require-LifecyclePattern "writing screen resumes tasks after becoming active" (
    $writing -match '(?s)private func refreshAfterBecomingActive\(\) async.*?await resumeWritingTask\(\)' -and
    $writing -match '(?s)onChange\(of: scenePhase\).*?phase == \.active.*?refreshAfterBecomingActive'
)
Require-LifecyclePattern "writing screen only tears down polling in the background" (
    $writing -match 'else if phase == \.background' -and
    $writing -notmatch 'else \{\s*pollTask\?\.cancel\(\)'
)
Require-LifecyclePattern "task recovery is bounded and excludes duplicate resumption" (
    $writing.Contains('guard pollTask == nil, !isResumingWritingTask else') -and
    $writing.Contains('recoveryAttempts: 5') -and
    $writing.Contains('pollWritingTask(task.id)')
)
Require-LifecyclePattern "writing drafts survive leaving the page and backgrounding" (
    $writing -match '(?s)\.onDisappear.*?saveInputDraft\(\)' -and
    $writing -match '(?s)phase == \.background.*?saveInputDraft\(\)'
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

Write-Output "AI lifecycle smoke passed (background recovery, draft preservation, and model timeout budget)."
