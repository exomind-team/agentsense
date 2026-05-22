$token = $env:GLM_CN_TOKEN
if (-not $token) { Write-Host "No GLM_CN_TOKEN"; exit 1 }
$headers = @{
    'Authorization' = "Bearer $token"
    'Accept-Language' = 'zh-CN,zh'
    'Content-Type' = 'application/json'
}
Write-Host "=== QUOTA LIMIT ===" -ForegroundColor Cyan
$r1 = Invoke-RestMethod -Uri 'https://open.bigmodel.cn/api/monitor/usage/quota/limit' -Headers $headers -TimeoutSec 15
$r1 | ConvertTo-Json -Depth 5

Write-Host "`n=== MODEL USAGE ===" -ForegroundColor Cyan
$now = Get-Date
$start = $now.AddDays(-1).Date.AddHours($now.Hour)
$end = $now.Date.AddHours($now.Hour).AddMinutes(59).AddSeconds(59)
$fmt = 'yyyy-MM-dd HH:mm:ss'
$query = "?startTime=$([uri]::EscapeDataString($start.ToString($fmt)))&endTime=$([uri]::EscapeDataString($end.ToString($fmt)))"
$r2 = Invoke-RestMethod -Uri "https://open.bigmodel.cn/api/monitor/usage/model-usage$query" -Headers $headers -TimeoutSec 15
$r2 | ConvertTo-Json -Depth 5
