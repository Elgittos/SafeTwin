$ErrorActionPreference = "Stop"

$root = "C:\SafeTwinTest"
$origin = Join-Path $root "Origin"
$backup = Join-Path $root "Backup"

Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $origin, $backup, (Join-Path $origin "Photos"), (Join-Path $backup "Photos") | Out-Null

"only origin" | Set-Content (Join-Path $origin "Photos\cat.jpg")
"only backup" | Set-Content (Join-Path $backup "orphan.txt")
"same" | Set-Content (Join-Path $origin "same.txt")
"same" | Set-Content (Join-Path $backup "same.txt")
"origin version" | Set-Content (Join-Path $origin "Photos\conflict.txt")
"backup version" | Set-Content (Join-Path $backup "Photos\conflict.txt")
"temp" | Set-Content (Join-Path $origin '~$report.docx')
"partial" | Set-Content (Join-Path $origin "video.mp4.part")

Write-Output "Created SafeTwin smoke folders:"
Write-Output "  Origin: $origin"
Write-Output "  Backup: $backup"
