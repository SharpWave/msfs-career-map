# Creates (or refreshes) a desktop shortcut that launches MSFS Career Map via start.cmd,
# minimised, with the app icon. Run from anywhere: powershell -File scripts\install-shortcut.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "MSFS Career Map.lnk"
$icon = Join-Path $root "assets\career-map.ico"

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = "$env:SystemRoot\System32\cmd.exe"
$s.Arguments = "/c `"$root\start.cmd`""
$s.WorkingDirectory = $root
$s.IconLocation = "$icon,0"
$s.Description = "Start the MSFS Career Map server and open it in your browser"
$s.WindowStyle = 7  # minimised console
$s.Save()
Write-Host "Shortcut written to $lnk"
