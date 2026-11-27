param(
    [string]$Version = "",
    [switch]$BumpPatch,
    [string]$Notes = "Updated LedgerFlow Windows installer and Android APK"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$verJsonPath = Join-Path $root "version.json"
$verObj = [System.IO.File]::ReadAllText($verJsonPath, $utf8NoBom) | ConvertFrom-Json

if (-not $Version) {
    $parts = ($verObj.version -split "\.") | ForEach-Object { [int]$_ }
    if ($BumpPatch -or $parts.Count -eq 3) {
        while ($parts.Count -lt 3) { $parts += 0 }
        $parts[2] = $parts[2] + 1
        $Version = "$($parts[0]).$($parts[1]).$($parts[2])"
    } else {
        $Version = $verObj.version
    }
}

Write-Output "Publishing LedgerFlow v$Version..."

# 1. Update version.json
$verObj.version = $Version
$verObj.notes = $Notes
[System.IO.File]::WriteAllText($verJsonPath, ($verObj | ConvertTo-Json -Depth 4), $utf8NoBom)

# 2. Update src/ui/app.js APP_VERSION
$appJsPath = Join-Path $root "src\ui\app.js"
$appJs = [System.IO.File]::ReadAllText($appJsPath, $utf8NoBom)
$appJs = [regex]::Replace($appJs, 'const APP_VERSION = "[^"]+";', "const APP_VERSION = `"$Version`";")
[System.IO.File]::WriteAllText($appJsPath, $appJs, $utf8NoBom)

# 3. Update AssemblyInfo.cs & SetupAssemblyInfo.cs & Setup.cs
foreach ($asmFile in @("src\AssemblyInfo.cs", "installer\SetupAssemblyInfo.cs")) {
    $p = Join-Path $root $asmFile
    $txt = [System.IO.File]::ReadAllText($p, $utf8NoBom)
    $txt = [regex]::Replace($txt, 'AssemblyVersion\("[^"]+"\)', "AssemblyVersion(`"$Version.0`")")
    $txt = [regex]::Replace($txt, 'AssemblyFileVersion\("[^"]+"\)', "AssemblyFileVersion(`"$Version.0`")")
    [System.IO.File]::WriteAllText($p, $txt, $utf8NoBom)
}
$setupCsPath = Join-Path $root "installer\Setup.cs"
$setupCs = [System.IO.File]::ReadAllText($setupCsPath, $utf8NoBom)
$setupCs = [regex]::Replace($setupCs, 'private const string AppVersion = "[^"]+";', "private const string AppVersion = `"$Version`";")
[System.IO.File]::WriteAllText($setupCsPath, $setupCs, $utf8NoBom)

# 4. Update AndroidManifest.xml (versionName & increment versionCode)
$manifestPath = Join-Path $root "android\AndroidManifest.xml"
$manifest = [System.IO.File]::ReadAllText($manifestPath, $utf8NoBom)
$vcMatch = [regex]::Match($manifest, 'android:versionCode="(\d+)"')
$nextCode = if ($vcMatch.Success) { [int]$vcMatch.Groups[1].Value + 1 } else { 2 }
$manifest = [regex]::Replace($manifest, 'android:versionCode="\d+"', "android:versionCode=`"$nextCode`"")
$manifest = [regex]::Replace($manifest, 'android:versionName="[^"]+"', "android:versionName=`"$Version`"")
[System.IO.File]::WriteAllText($manifestPath, $manifest, $utf8NoBom)

# 5. Build Windows installer, Android APK, and run self-test
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "build.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "build-apk.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $root "build\LedgerFlow.exe") --self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 6. Commit & push to GitHub + publish GitHub Release with binaries attached
Set-Location $root
git add -A
git commit -m "Release v${Version}: $Notes"
git push origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$tag = "v$Version"
$setupExe = Join-Path $root "LedgerFlow-Setup.exe"
$apkFile = Join-Path $root "LedgerFlow.apk"
gh release create $tag $setupExe $apkFile --title "LedgerFlow $tag" --notes $Notes
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "PUBLISHED_RELEASE=$tag"
