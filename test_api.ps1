Remove-Item -Force 'D:\project\agentsense\.worktrees\fix-4issues\quota.db' -ErrorAction SilentlyContinue
Set-Location 'D:\project\agentsense\.worktrees\fix-4issues'
Start-Process -FilePath '.\target\release\agentsense.exe' -ArgumentList 'serve' -WindowStyle Hidden
Start-Sleep -Seconds 10
$proc = Get-Process agentsense -ErrorAction SilentlyContinue
if ($proc) { Write-Host "Server PID: $($proc.Id)" } else { Write-Host "Server NOT running!"; exit 1 }
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7892/api/zai' -UseBasicParsing -TimeoutSec 15
    Write-Host "=== /api/zai ==="
    Write-Host $r.Content
} catch { Write-Host "FAIL zai: $($_.Exception.Message)" }
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7892/api/zai/models' -UseBasicParsing -TimeoutSec 15
    Write-Host "`n=== /api/zai/models ==="
    Write-Host $r.Content.Substring(0, [Math]::Min(500, $r.Content.Length))
} catch { Write-Host "FAIL models: $($_.Exception.Message)" }
