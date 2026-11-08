$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot
Set-Location $projectDir

# 1. Create DodoMusic icon (icon.ico)
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

# 2. Extract cached Electron build into dist\DodoMusic-win32-x64
$electronZip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\*\electron-*-win32-x64.zip" | Select-Object -First 1
$distDir = Join-Path $projectDir "dist\DodoMusic-win32-x64"
if (Test-Path $distDir) {
    Remove-Item -Recurse -Force $distDir
}
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

Write-Output "Extracting Electron runtime..."
Expand-Archive -Path $electronZip.FullName -DestinationPath $distDir -Force

Move-Item -Path (Join-Path $distDir "electron.exe") -Destination (Join-Path $distDir "DodoMusic.exe") -Force

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

Write-Output "Built dist\DodoMusic-win32-x64\DodoMusic.exe"

# 4. Pack into payload.zip for installer
$payloadZip = Join-Path $projectDir "payload.zip"
if (Test-Path $payloadZip) {
    Remove-Item -Force $payloadZip
}
Write-Output "Compressing payload.zip..."
[System.IO.Compression.ZipFile]::CreateFromDirectory($distDir, $payloadZip, [System.IO.Compression.CompressionLevel]::Fastest, $false)
Write-Output "payload.zip created: $( (Get-Item $payloadZip).Length ) bytes"

# 5. Compile DodoMusic-v1.4-Setup.exe
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$setupExe = Join-Path $projectDir "DodoMusic-v1.4-Setup.exe"

Write-Output "Compiling DodoMusic-v1.4-Setup.exe..."
& $csc /nologo /target:winexe /optimize+ /platform:x64 /out:$setupExe /win32icon:$iconPath /resource:$payloadZip,payload.zip /resource:$iconPath,icon.ico /resource:"$projectDir\icon_setup.png",icon_setup.png /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll /reference:Microsoft.CSharp.dll "$projectDir\Installer.cs"

Write-Output "Setup created successfully: $setupExe"
