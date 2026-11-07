$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot
Set-Location $projectDir

# 1. Create DodoSpoti icon (icon.ico)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(64, 64)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$brushBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(64, 64)),
    [System.Drawing.Color]::FromArgb(255, 255, 105, 0),
    [System.Drawing.Color]::FromArgb(255, 20, 22, 30)
)
$g.FillEllipse($brushBg, 2, 2, 60, 60)
$font = New-Object System.Drawing.Font("Segoe UI", 26, [System.Drawing.FontStyle]::Bold)
$brushTxt = [System.Drawing.Brushes]::White
$g.DrawString("D", $font, $brushTxt, 13, 6)
$g.Dispose()

$iconPath = Join-Path $projectDir "public\icon.ico"
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream($iconPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$bmp.Dispose()
Write-Output "Icon created: $iconPath"

# 2. Extract cached Electron build into dist\DodoSpoti-win32-x64
$electronZip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\*\electron-*-win32-x64.zip" | Select-Object -First 1
$distDir = Join-Path $projectDir "dist\DodoSpoti-win32-x64"
if (Test-Path $distDir) {
    Remove-Item -Recurse -Force $distDir
}
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

Write-Output "Extracting Electron runtime..."
Expand-Archive -Path $electronZip.FullName -DestinationPath $distDir -Force

Move-Item -Path (Join-Path $distDir "electron.exe") -Destination (Join-Path $distDir "DodoSpoti.exe") -Force

$defaultAsar = Join-Path $distDir "resources\default_app.asar"
if (Test-Path $defaultAsar) {
    Remove-Item -Force $defaultAsar
}

# 3. Copy app files into resources\app
$appResDir = Join-Path $distDir "resources\app"
New-Item -ItemType Directory -Force -Path $appResDir | Out-Null

Copy-Item "$projectDir\package.json" $appResDir -Force
Copy-Item "$projectDir\electron-main.cjs" $appResDir -Force
Copy-Item "$projectDir\server.js" $appResDir -Force
Copy-Item "$projectDir\.env" $appResDir -Force
if (Test-Path "$projectDir\cache.json") {
    Copy-Item "$projectDir\cache.json" $appResDir -Force
}
Copy-Item "$projectDir\public" (Join-Path $appResDir "public") -Recurse -Force

$null = robocopy "$projectDir\node_modules" "$appResDir\node_modules" /E /NFL /NDL /NJH /NJS /NC /NS /NP

Write-Output "Built dist\DodoSpoti-win32-x64\DodoSpoti.exe"

# 4. Compile root DodoSpoti.exe launcher
$csCode = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

class Program {
    [STAThread]
    static void Main() {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string targetExe = Path.Combine(baseDir, "dist", "DodoSpoti-win32-x64", "DodoSpoti.exe");
        if (!File.Exists(targetExe)) {
            MessageBox.Show("File not found: " + targetExe, "DodoSpoti", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = targetExe;
        psi.WorkingDirectory = Path.GetDirectoryName(targetExe);
        psi.UseShellExecute = true;
        Process.Start(psi);
    }
}
"@

$csPath = Join-Path $projectDir "Launcher.cs"
Set-Content -Path $csPath -Value $csCode -Encoding UTF8

$csc = Get-ChildItem "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" | Select-Object -First 1
$rootExe = Join-Path $projectDir "DodoSpoti.exe"
& $csc.FullName /target:winexe /out:$rootExe /win32icon:$iconPath /r:System.Windows.Forms.dll $csPath | Out-Null
Remove-Item $csPath -Force

Write-Output "Root EXE created: $rootExe"
