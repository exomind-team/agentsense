# Try without proxy (Chinese sites don't need it)
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$urls = @(
    "https://open.bigmodel.cn/favicon.ico",
    "https://chatglm.cn/favicon.ico"
)
foreach ($url in $urls) {
    try {
        $r = Invoke-WebRequest -Uri $url -ErrorAction Stop
        Write-Host "$url -> OK ($($r.Headers['Content-Type']), $($r.Content.Length) bytes)"
    } catch {
        Write-Host "$url -> FAIL ($($_.Exception.Message.Substring(0,80)))"
    }
}

# Try curl for SVG sources
curl.exe -sL --max-time 10 "https://open.bigmodel.cn/" 2>$null | Select-String -Pattern 'svg|logo' | Select-Object -First 10
