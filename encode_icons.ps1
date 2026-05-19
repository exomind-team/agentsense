# Encode SVGs to base64 data URIs
$files = @{
    'anthropic' = 'D:\project\agentsense\.worktrees\fix-4issues\web\icons\anthropic.svg'
    'deepseek' = 'D:\project\agentsense\.worktrees\fix-4issues\web\icons\deepseek.svg'
    'minimax' = 'D:\project\agentsense\.worktrees\fix-4issues\web\icons\minimax.svg'
}

foreach ($entry in $files.GetEnumerator()) {
    $content = [IO.File]::ReadAllText($entry.Value)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
    $base64 = [Convert]::ToBase64String($bytes)
    $dataUri = "data:image/svg+xml;base64,$base64"
    Write-Host "$($entry.Key): $($dataUri.Length) chars"
    Write-Host $dataUri
    Write-Host "---"
}

# Also do the PNG
$pngBytes = [IO.File]::ReadAllBytes('D:\project\agentsense\.worktrees\fix-4issues\web\icons\zhipu-32.png')
$pngB64 = [Convert]::ToBase64String($pngBytes)
Write-Host "zhipu-png: $($pngB64.Length) chars"
Write-Host "data:image/png;base64,$pngB64"
