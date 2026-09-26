$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

function Assert-Contains {
    param(
        [string]$Path,
        [string]$Pattern,
        [string]$Description
    )

    $content = Get-Content -LiteralPath (Join-Path $projectRoot $Path) -Raw
    if ($content -notmatch [regex]::Escape($Pattern)) {
        throw "缺少：$Description [$Path] -> $Pattern"
    }
}

Assert-Contains -Path "ZhiZhou/Models/AdminContentRatingModels.swift" -Pattern "enum AdminContentRatingValue" -Description "内容分级模型"
Assert-Contains -Path "ZhiZhou/Models/AdminContentRatingModels.swift" -Pattern "struct AdminContentRatingRuleCandidatePreviewResponse" -Description "规则影响预览模型"
Assert-Contains -Path "ZhiZhou/Models/AdminContentRatingModels.swift" -Pattern "struct AdminContentRatingAITaskProgress" -Description "LLM 进度模型"
Assert-Contains -Path "ZhiZhou/Networking/AdminAPI.swift" -Pattern "/api/admin/content-ratings" -Description "作品分级接口"
Assert-Contains -Path "ZhiZhou/Networking/AdminAPI.swift" -Pattern "/api/admin/content-rating-rule-candidates" -Description "规则候选接口"
Assert-Contains -Path "ZhiZhou/Networking/AdminAPI.swift" -Pattern "/api/admin/content-rating-ai" -Description "LLM 分级接口"
Assert-Contains -Path "ZhiZhou/Networking/AdminAPI.swift" -Pattern "resumeContentRatingAITask" -Description "断点恢复接口"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminRootView.swift" -Pattern "destination: .contentRatings" -Description "后台分级入口"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern "expectedRevision: item.revision" -Description "人工分级乐观并发校验"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern "previewContentRatingRuleCandidate" -Description "规则批准前影响预览"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern "cancelAiTask" -Description "LLM 中止任务"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern "resumeContentRatingAITask" -Description "LLM 断点恢复"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern "reviewContentRatingAISuggestion" -Description "LLM 建议人工复核"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern "复用 AI 建议理由" -Description "LLM 建议理由可复用于批准理由"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern "lastProgressDone" -Description "LLM 新结果增量刷新游标"
Assert-Contains -Path "ZhiZhou/Views/Admin/AdminContentRatingsView.swift" -Pattern 'await applyProgress(result)' -Description "LLM 新结果自动加载"

$view = Get-Content -LiteralPath (Join-Path $projectRoot 'ZhiZhou/Views/Admin/AdminContentRatingsView.swift') -Raw
$tabCount = ([regex]::Matches($view, 'case (ratings|rules|ai) =')).Count
if ($tabCount -ne 3) {
    throw "分级管理工作区数量异常：期望 3，实际 $tabCount"
}

Write-Output "content-rating smoke passed: models, API routes, admin entry, manual/rule/LLM flows, progress and resume contracts"
