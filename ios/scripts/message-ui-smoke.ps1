$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
function Read-Utf8([string]$Path) {
    [System.IO.File]::ReadAllText((Join-Path $projectRoot $Path), [System.Text.Encoding]::UTF8)
}
$inbox = Read-Utf8 'ZhiZhou/Views/MessageCenterView.swift'
$watches = Read-Utf8 'ZhiZhou/Views/MessageBookSubscriptionsView.swift'
$settings = Read-Utf8 'ZhiZhou/Views/MessageSettingsView.swift'
$reminder = Read-Utf8 'ZhiZhou/Views/ReadingReminderView.swift'
$media = Read-Utf8 'ZhiZhou/Views/ReaderMediaView.swift'
$guard = Read-Utf8 'ZhiZhouCore/Sources/ZhiZhouCore/ListRequestGuard.swift'
$tests = Read-Utf8 'ZhiZhouUITests/FrontendAuditTests.swift'
$failures = [System.Collections.Generic.List[string]]::new()
function Require-MessageContract([string]$Name, [bool]$Condition) {
    if (-not $Condition) { $failures.Add($Name) }
}
foreach ($source in @($inbox, $watches)) {
    Require-MessageContract 'query tasks use hashable identities and check current tickets' (
        $source.Contains('private struct Query: Hashable') -and
        $source.Contains('.task(id: query)') -and
        $source.Contains('requests.accepts(ticket, query: query)')
    )
    Require-MessageContract 'old results are identified and interactions gated' (
        $source.Contains('displayedQuery == query') -and
        $source.Contains('resultsCurrent && !busy') -and
        $source.Contains('.disabled(!canUseResults)') -and
        $source.Contains('.opacity(resultsCurrent ? 1 : 0.5)')
    )
    Require-MessageContract 'leaving invalidates requests without recycling identities' (
        $source.Contains('.onDisappear { requests.invalidate() }') -and
        $source -notmatch 'onDisappear \{ requests ='
    )
    Require-MessageContract 'list uses the shared constrained paper surface and body heading' (
        $source.Contains('AccountSettingsList {') -and $source.Contains('AccountSettingsHeading(')
    )
}
Require-MessageContract 'pagination requires successful matching results' (
    $inbox.Contains('requests.beginNext(current)') -and
    $inbox.Contains('requests.finish(ticket, succeeded: true)')
)
Require-MessageContract 'invalidation advances the request generation' (
    $guard -match '(?s)func invalidate\(\).*?generation &\+= 1.*?active = nil'
)
Require-MessageContract 'drafts survive child navigation while account changes isolate them' (
    $settings.Contains('.task { if form == nil { await load() } }') -and
    $settings.Contains('MessageSettingsContent()') -and
    $settings -match '(?s)MessageSettingsContent\(\).*?\.id\(' -and
    $settings.Contains('set: { form?[keyPath: path] = $0; message = nil }')
)
Require-MessageContract 'settings and reminders share paper layout and operation feedback' (
    $settings.Contains('AccountSettingsPage {') -and $reminder.Contains('AccountSettingsPage {') -and
    $settings.Contains('isWorking: operation == .save') -and
    $reminder.Contains('savedSignature == signature') -and
    $settings.Contains('AppAdaptiveRow {') -and $reminder.Contains('AppAdaptiveRow {') -and
    $inbox.Contains('.accessibleSegmentedPicker()')
)
Require-MessageContract 'hidden image controls cannot intercept taps or VoiceOver focus' (
    $media -match '(?s)opacity\(showChrome \? 1 : 0\)\s*\.allowsHitTesting\(showChrome\)\s*\.accessibilityHidden\(!showChrome\)' -and
    $media.Contains('.accessibilityAction(named: showChrome ?')
)
Require-MessageContract 'native tests cover failed filters and draft round trips' (
    $tests.Contains('testMessageFilterFailureDoesNotPageThroughOldResults') -and
    $tests.Contains('testNotificationDraftSurvivesReminderRoundTrip')
)
if ($failures.Count -gt 0) { throw ('Message UI smoke failed: ' + ($failures -join '; ')) }
Write-Output 'Message UI static contracts passed (queries, drafts, shared layouts, accessibility).'
