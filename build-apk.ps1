$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$androidDir = Join-Path $root "android"
$uiSrc = Join-Path $root "src\ui"
$assetsUi = Join-Path $androidDir "assets\ui"
$work = Join-Path $root "build\apk-work"
$outApk = Join-Path $root "LedgerFlow.apk"

# 1. Locate JDK 23 tools & Android SDK
$jdkBin = "C:\Program Files\Java\jdk-23\bin"
if (-not (Test-Path "$jdkBin\javac.exe")) {
    throw "JDK 23 not found at $jdkBin"
}
$javac = Join-Path $jdkBin "javac.exe"
$keytool = Join-Path $jdkBin "keytool.exe"

$sdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk") | Where-Object { $_ -and (Test-Path $_) }
if (-not $sdkCandidates) { throw "Android SDK not found. Install commandlinetools + platforms;android-34 + build-tools;34.0.0 first." }
$sdkRoot = $sdkCandidates | Select-Object -First 1

$platformDir = Get-ChildItem (Join-Path $sdkRoot "platforms") -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $platformDir) { throw "No Android platform installed under $sdkRoot\platforms" }
$androidJar = Join-Path $platformDir.FullName "android.jar"

$btDir = Get-ChildItem (Join-Path $sdkRoot "build-tools") -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $btDir) { throw "No Android build-tools installed under $sdkRoot\build-tools" }
$aapt2 = Join-Path $btDir.FullName "aapt2.exe"
$d8 = Join-Path $btDir.FullName "d8.bat"
$zipalign = Join-Path $btDir.FullName "zipalign.exe"
$apksigner = Join-Path $btDir.FullName "apksigner.bat"

# 2. Sync mobile-optimized UI assets into android/assets/ui
New-Item -ItemType Directory -Force $assetsUi | Out-Null
Copy-Item (Join-Path $uiSrc "index.html") (Join-Path $assetsUi "index.html") -Force
Copy-Item (Join-Path $uiSrc "styles.css") (Join-Path $assetsUi "styles.css") -Force
Copy-Item (Join-Path $uiSrc "mobile.css") (Join-Path $assetsUi "mobile.css") -Force
Copy-Item (Join-Path $uiSrc "app.js") (Join-Path $assetsUi "app.js") -Force

if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$genDir = Join-Path $work "gen"
$clsDir = Join-Path $work "classes"
$dexDir = Join-Path $work "dex"
New-Item -ItemType Directory -Force $genDir, $clsDir, $dexDir | Out-Null

# 3. Compile Android resources
$resZip = Join-Path $work "res.zip"
$unalignedApk = Join-Path $work "unaligned.apk"
$alignedApk = Join-Path $work "aligned.apk"

& $aapt2 compile --dir (Join-Path $androidDir "res") -o $resZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

& $aapt2 link -o $unalignedApk -I $androidJar --manifest (Join-Path $androidDir "AndroidManifest.xml") --java $genDir $resZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

# 4. Compile Java sources
$javaFiles = @(Get-ChildItem (Join-Path $androidDir "src") -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName)
$genFiles = @(Get-ChildItem $genDir -Filter "*.java" -Recurse | Select-Object -ExpandProperty FullName)
$allJava = $javaFiles + $genFiles
& $javac --release 11 -encoding UTF-8 -classpath $androidJar -d $clsDir $allJava
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

# 5. Convert .class bytecode to classes.dex
$classFiles = @(Get-ChildItem $clsDir -Filter "*.class" -Recurse | Select-Object -ExpandProperty FullName)
$env:JAVA_HOME = "C:\Program Files\Java\jdk-23"
& $d8 --lib $androidJar --min-api 24 --output $dexDir $classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

# 6. Inject classes.dex and forward-slashed UI assets into APK archive
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($unalignedApk, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    Get-ChildItem $dexDir -Filter "*.dex" | ForEach-Object {
        $existing = $zip.GetEntry($_.Name)
        if ($existing) { $existing.Delete() }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $_.Name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    foreach ($assetName in @("index.html", "styles.css", "mobile.css", "app.js")) {
        $entryPath = "assets/ui/" + $assetName
        $existing = $zip.GetEntry($entryPath)
        if ($existing) { $existing.Delete() }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $assetsUi $assetName), $entryPath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}

# 7. Align and Sign APK
& $zipalign -f -p 4 $unalignedApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

$keystore = Join-Path $androidDir "ledgerflow.keystore"
if (-not (Test-Path $keystore)) {
    & $keytool -genkeypair -v -keystore $keystore -alias ledgerflow -keyalg RSA -keysize 2048 -validity 10000 -storepass ledgerflow -keypass ledgerflow -dname "CN=LedgerFlow, OU=Mobile, O=LedgerFlow, L=IN, S=IN, C=IN" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
}

if (Test-Path $outApk) { Remove-Item $outApk -Force }
& $apksigner sign --ks $keystore --ks-pass pass:ledgerflow --ks-key-alias ledgerflow --out $outApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }

& $apksigner verify --print-certs $outApk
if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }

$fi = Get-Item $outApk
Write-Output ("BUILT_APK=" + $fi.FullName + " SIZE=" + $fi.Length)
