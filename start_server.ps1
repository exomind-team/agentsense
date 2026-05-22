Set-Location 'D:\project\agentsense\.worktrees\fix-4issues'
Start-Process -FilePath '.\target\release\agentsense.exe' -WorkingDirectory 'D:\project\agentsense\.worktrees\fix-4issues' -WindowStyle Hidden
Start-Sleep -Seconds 5
$proc = Get-Process agentsense -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "Server running PID: $($proc.Id)"
} else {
    Write-Host "Server NOT running"
}
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7892/' -UseBasicParsing -TimeoutSec 10
    Write-Host "HTTP Status: $($r.StatusCode)"
} catch {
    Write-Host "HTTP Error: $($_.Exception.Message)"
}
