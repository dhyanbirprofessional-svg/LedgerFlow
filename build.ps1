$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$build = Join-Path $root "build"
$stage = Join-Path $build "stage"

New-Item -ItemType Directory -Force -Path $build | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# 1. Generate icon if missing
$ico = Join-Path $root "assets\ledgerflow.ico"
if (-not (Test-Path $ico)) {
    & $csc /nologo /out:"$build\GenIcon.exe" "$root\tools\GenIcon.cs" /reference:System.Drawing.dll
    if ($LASTEXITCODE -ne 0) { exit 1 }
    & "$build\GenIcon.exe" $ico
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

# 2. Compile main desktop executable
& $csc /nologo /target:winexe /win32icon:"$ico" /out:"$build\LedgerFlow.exe" `
    /resource:"$root\src\ui\index.html,ui.index.html" `
    /resource:"$root\src\ui\styles.css,ui.styles.css" `
    /resource:"$root\src\ui\mobile.css,ui.mobile.css" `
    /resource:"$root\src\ui\app.js,ui.app.js" `
    "$root\src\Program.cs" "$root\src\StatementParser.cs" "$root\src\AssemblyInfo.cs" `
    /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    /reference:System.Xml.dll /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll /reference:System.Web.Extensions.dll
if ($LASTEXITCODE -ne 0) { exit 1 }

# 3. Stage payload and compress into payload.zip
Copy-Item "$build\LedgerFlow.exe" "$stage\LedgerFlow.exe"
Copy-Item $ico "$stage\ledgerflow.ico"
Copy-Item "$root\README.txt" "$stage\README.txt"

$zipPath = Join-Path $build "payload.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# 4. Compile single standalone installer LedgerFlow-Setup.exe
$setupExe = Join-Path $root "LedgerFlow-Setup.exe"
& $csc /nologo /target:winexe /win32icon:"$ico" /out:"$setupExe" `
    /resource:"$zipPath,payload.zip" `
    "$root\installer\Setup.cs" "$root\installer\SetupAssemblyInfo.cs" `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    /reference:System.IO.Compression.dll `
    /reference:System.IO.Compression.FileSystem.dll
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Output "BUILT_INSTALLER=$setupExe size=$((Get-Item $setupExe).Length)"
