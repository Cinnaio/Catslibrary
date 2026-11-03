param(
    [string]$SourcePath = (Join-Path $PSScriptRoot "..\ZhiZhou\Networking\CachedAsyncImage.swift")
)

$ErrorActionPreference = "Stop"
$source = Get-Content -Raw -LiteralPath $SourcePath
$failures = [System.Collections.Generic.List[string]]::new()

function Require-ImageCachePattern {
    param(
        [string]$Name,
        [bool]$Condition
    )

    if (-not $Condition) {
        $failures.Add($Name)
    }
}

Require-ImageCachePattern "decoded image cache is process-wide" (
    $source -match 'NSCache<NSString,\s*UIImage>'
)

Require-ImageCachePattern "same URL requests are coalesced" (
    $source -match '(?s)actor ImageRequestCache.*?inFlight:\s*\[String:\s*Task<Data\?,\s*Never>\].*?if let task = inFlight\[key\].*?return await task\.value'
)

Require-ImageCachePattern "cache key separates URL and rendered size" (
    $source -match 'taskKey' -and
    $source -match 'targetSize\.width' -and
    $source -match 'targetSize\.height'
)

Require-ImageCachePattern "load task checks decoded cache before starting a request" (
    $source -match '(?s)\.task\(id:.*?ImageCache\..*?object\(forKey:.*?taskKey'
)

Require-ImageCachePattern "cancelled request cannot publish a decoded image" (
    $source -match '(?s)guard !Task\.isCancelled else \{ return \}.*?if let img = await Self\.fetch.*?guard !Task\.isCancelled else \{ return \}.*?image = img'
)

Require-ImageCachePattern "reloading keeps an already displayed image" (
    $source -notmatch '(?s)image = nil\s*\r?\n\s*loadFailed = false\s*\r?\n\s*let maxPixel'
)

if ($failures.Count -gt 0) {
    Write-Error ("Image cache regression contract failed: " + ($failures -join "; "))
    exit 1
}

Write-Output "Image cache regression contract passed."
