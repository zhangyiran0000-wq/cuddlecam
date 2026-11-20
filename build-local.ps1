param([string]$JavaHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$project = $PSScriptRoot
if (!$JavaHome) {
    $candidates = @((Join-Path $project '.tools/jdk'), 'C:\Program Files\Android\Android Studio\jbr')
    if (Test-Path -LiteralPath 'C:\Program Files\JetBrains') {
        $candidates += @(Get-ChildItem -LiteralPath 'C:\Program Files\JetBrains' -Directory | ForEach-Object { Join-Path $_.FullName 'jbr' })
    }
    foreach ($candidate in $candidates) {
        if (!(Test-Path -LiteralPath "$candidate\bin\javac.exe") -or !(Test-Path -LiteralPath "$candidate\release")) { continue }
        $release = [IO.File]::ReadAllText("$candidate\release")
        if ($release -match 'JAVA_VERSION="(\d+)' -and [int]$Matches[1] -ge 17) { $JavaHome = $candidate; break }
    }
}
if (!$JavaHome -or !(Test-Path -LiteralPath "$JavaHome\bin\javac.exe")) {
    throw 'Set JAVA_HOME to JDK 17 or newer, or pass -JavaHome <JDK directory>.'
}
$jdk = Join-Path $JavaHome 'bin'
$javaVersion = & "$jdk/javac.exe" -version 2>&1
if ($LASTEXITCODE -or "$javaVersion" -notmatch 'javac (\d+)' -or [int]$Matches[1] -lt 17) {
    throw "JDK 17 or newer required. Selected compiler: $javaVersion"
}
Write-Output "Using $javaVersion at $JavaHome"
$sdk = Join-Path $project '.tools/android-platform-35/android.jar'
$bt = Join-Path $project '.tools/android-build-tools-35'
$ortRoot = Join-Path $project '.tools/onnxruntime-android'
$ort = Join-Path $ortRoot 'classes.jar'
$key = Join-Path $project '.local-signing/couplecam-dev.p12'
$web = Join-Path $project 'web'
foreach ($file in @($sdk, $ort, $key, "$bt/aapt2.exe", "$bt/lib/d8.jar", "$bt/lib/apksigner.jar")) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing recovered build dependency: $file" }
}
$manifestPath = Join-Path $project 'app/src/main/AndroidManifest.xml'
$manifestText = [IO.File]::ReadAllText($manifestPath)
$manifest = [xml]$manifestText
$version = $manifest.manifest.versionName
$code = $manifest.manifest.versionCode
$gradle = [IO.File]::ReadAllText((Join-Path $project 'app/build.gradle'))
if ($gradle -notmatch "versionName\s+'$([regex]::Escape($version))'" -or $gradle -notmatch "versionCode\s+$code\b") {
    throw 'Version values in app/build.gradle and AndroidManifest.xml must match.'
}
$build = Join-Path $project ('.build/local-' + [guid]::NewGuid().ToString('N'))
$output = Join-Path $project 'outputs'
New-Item -ItemType Directory -Force "$build/classes", "$build/dex", $output | Out-Null
function Check-Tool { if ($LASTEXITCODE) { throw "Build tool failed with exit code $LASTEXITCODE" } }
$sources = @(Get-ChildItem -LiteralPath (Join-Path $project 'app/src/main/java') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
& "$jdk/javac.exe" -source 8 -target 8 -Xlint:-options -bootclasspath "$sdk;$bt/core-lambda-stubs.jar" -classpath $ort -encoding UTF-8 -d "$build/classes" $sources
Check-Tool
$classes = @(Get-ChildItem -LiteralPath "$build/classes" -Recurse -Filter '*.class' | Select-Object -ExpandProperty FullName)
& "$jdk/java.exe" -cp "$bt/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 29 --lib $sdk --output "$build/dex" $ort $classes
Check-Tool
& "$bt/aapt2.exe" compile --dir (Join-Path $project 'app/src/main/res') -o "$build/resources.zip"
Check-Tool
[IO.File]::WriteAllText("$build/AndroidManifest.xml", $manifestText.Replace('<application ', '<application android:extractNativeLibs="true" ').Replace('<manifest ', '<manifest package="app.couplecam.camera" '))
& "$bt/aapt2.exe" link --manifest "$build/AndroidManifest.xml" -I $sdk --min-sdk-version 29 --target-sdk-version 35 -o "$build/unsigned.apk" "$build/resources.zip"
Check-Tool
$zip = [IO.Compression.ZipFile]::Open("$build/unsigned.apk", [IO.Compression.ZipArchiveMode]::Update)
try {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$build/dex/classes.dex", 'classes.dex') | Out-Null
    foreach ($lib in Get-ChildItem -LiteralPath "$ortRoot/jni" -Filter '*.so' -File -Recurse) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $lib.FullName, ('lib/' + $lib.Directory.Name + '/' + $lib.Name)) | Out-Null
    }
    foreach ($asset in Get-ChildItem -LiteralPath $web -File -Recurse) {
        $relative = $asset.FullName.Substring($web.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $asset.FullName, "assets/$relative") | Out-Null
    }
} finally { $zip.Dispose() }
& "$bt/zipalign.exe" -f 4 "$build/unsigned.apk" "$build/aligned.apk"
Check-Tool
$apk = Join-Path $output "CuddleCam-$version.apk"
& "$jdk/java.exe" -jar "$bt/lib/apksigner.jar" sign --ks $key --ks-key-alias couplecam --ks-pass pass:android --key-pass pass:android --v4-signing-enabled false --out "$build/signed.apk" "$build/aligned.apk"
Check-Tool
& "$jdk/java.exe" -jar "$bt/lib/apksigner.jar" verify --verbose --print-certs "$build/signed.apk"
Check-Tool
& "$bt/zipalign.exe" -c 4 "$build/signed.apk"
Check-Tool
Copy-Item -LiteralPath "$build/signed.apk" -Destination $apk
& "$bt/aapt.exe" dump badging $apk | Select-String '^package:|^sdkVersion:|^targetSdkVersion:|^launchable-activity:|uses-permission:'
Check-Tool
Get-FileHash -LiteralPath $apk -Algorithm SHA256
Write-Output "Built: $apk"
