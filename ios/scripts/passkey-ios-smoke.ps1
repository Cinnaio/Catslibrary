$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

function Read-Utf8 {
    param([string]$Path)
    [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Require-Contract {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

$service = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Networking/PasskeyService.swift')
$models = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Models/PasskeyModels.swift')
$login = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Views/LoginView.swift')
$settings = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Views/PasskeySettingsView.swift')
$profile = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Views/ProfileSettingsViews.swift')
$appState = Read-Utf8 (Join-Path $projectRoot 'ZhiZhou/Services/AppState.swift')
$project = Read-Utf8 (Join-Path $projectRoot 'project.yml')
$entitlements = [xml](Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'ZhiZhou/Support/ZhiZhou.entitlements'))
$documentation = Read-Utf8 (Join-Path $projectRoot 'docs/passkey-native-ios.md')
$failures = [System.Collections.Generic.List[string]]::new()

Require-Contract 'native AuthenticationServices provider is wired' (
    $service.Contains('import AuthenticationServices') -and
    $service.Contains('ASAuthorizationPlatformPublicKeyCredentialProvider') -and
    $service.Contains('ASAuthorizationController')
)
Require-Contract 'login options and verification endpoints are present' (
    $service.Contains('/api/auth/passkeys/login/options') -and
    $service.Contains('/api/auth/passkeys/login/verify')
)
Require-Contract 'registration options and verification endpoints are present' (
    $service.Contains('/api/auth/passkeys/register/options') -and
    $service.Contains('/api/auth/passkeys/register/verify')
)
Require-Contract 'native requests require user verification and omit attestation' (
    $service.Contains('request.userVerificationPreference = .required') -and
    $service.Contains('request.attestationPreference = .none')
)
Require-Contract 'WebAuthn response payload contains native assertion data' (
    $service.Contains('rawClientDataJSON') -and
    $service.Contains('rawAuthenticatorData') -and
    $service.Contains('signature')
)
Require-Contract 'login screen has a gated Passkey action' (
    $login.Contains('passkeyAvailable') -and
    $login.Contains('login.passkey') -and
    $login.Contains('loginWithPasskey')
)
Require-Contract 'account security page exposes Passkey management' (
    $profile.Contains('PasskeySettingsView()') -and
    $settings.Contains('passkey.register') -and
    $settings.Contains('PasskeyService.shared.revoke')
)
Require-Contract 'Bearer login response is handed to existing AppState session activation' (
    $appState.Contains('func loginWithPasskey') -and
    $appState.Contains('APIClient.shared.token = response.token') -and
    $appState.Contains('await activateAccount(response.user)')
)
Require-Contract 'XcodeGen target uses the associated domains entitlement' (
    $project.Contains('CODE_SIGN_ENTITLEMENTS: ZhiZhou/Support/ZhiZhou.entitlements')
)
Require-Contract 'entitlement points at the official relying-party domain' (
    $entitlements.plist.dict.array.string -eq 'webcredentials:catrr.uk'
)
Require-Contract 'release documentation keeps AASA Team ID as an explicit gate' (
    $documentation.Contains('<APPLE_TEAM_ID>.com.zhizhou.app')
)

if ($failures.Count -gt 0) {
    throw ('Passkey iOS smoke failed:' + [Environment]::NewLine + ' - ' + ($failures -join ([Environment]::NewLine + ' - ')))
}

Write-Output 'Passkey iOS smoke passed (native API, session wiring, management UI, and associated domains).'
