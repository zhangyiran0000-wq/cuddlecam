param([int]$Port = 8080)
$ErrorActionPreference = 'Stop'
Write-Host "Open http://127.0.0.1:$Port/index.html (Ctrl+C to stop)"
python -X utf8 -m http.server $Port --bind 127.0.0.1 --directory (Join-Path $PSScriptRoot 'web')
