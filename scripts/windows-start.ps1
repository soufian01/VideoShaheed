$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$NodeDir = Join-Path $RuntimeDir "node"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd = Join-Path $NodeDir "npm.cmd"
$AppUrl = "http://localhost:3000"
$server = $null

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "[VideoShaheed] $Message" -ForegroundColor Cyan
}

function Install-PortableNode {
    if (Test-Path $NodeExe) {
        return
    }

    Write-Step "Primo avvio: scarico automaticamente Node.js. Non serve installare nulla."
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

    $architecture = switch ($env:PROCESSOR_ARCHITECTURE) {
        "ARM64" { "arm64" }
        "AMD64" { "x64" }
        default {
            if ($env:PROCESSOR_ARCHITEW6432 -eq "AMD64") { "x64" }
            else { throw "Questa versione richiede Windows a 64 bit." }
        }
    }

    $releaseBase = "https://nodejs.org/download/release/latest-v22.x/"
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri ($releaseBase + "SHASUMS256.txt")).Content
    $pattern = "(?m)^([a-f0-9]{64})  (node-v[^\r\n ]+-win-$architecture\.zip)$"
    $release = [regex]::Match($checksums, $pattern)
    if (-not $release.Success) {
        throw "Non riesco a trovare il pacchetto ufficiale Node.js per questo computer."
    }

    $expectedHash = $release.Groups[1].Value.ToUpperInvariant()
    $fileName = $release.Groups[2].Value
    $zipPath = Join-Path $RuntimeDir $fileName
    $extractDir = Join-Path $RuntimeDir "node-extract"

    Invoke-WebRequest -UseBasicParsing -Uri ($releaseBase + $fileName) -OutFile $zipPath
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        Remove-Item -LiteralPath $zipPath -Force
        throw "Il controllo di sicurezza del download Node.js non e riuscito."
    }

    if (Test-Path $extractDir) {
        Remove-Item -LiteralPath $extractDir -Recurse -Force
    }
    if (Test-Path $NodeDir) {
        Remove-Item -LiteralPath $NodeDir -Recurse -Force
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $expandedNode = Get-ChildItem -LiteralPath $extractDir -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "node.exe") } |
        Select-Object -First 1
    if (-not $expandedNode) {
        throw "Il pacchetto Node.js scaricato non e valido."
    }

    Move-Item -LiteralPath $expandedNode.FullName -Destination $NodeDir
    Remove-Item -LiteralPath $extractDir -Recurse -Force
    Remove-Item -LiteralPath $zipPath -Force
}

try {
    if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
        throw "package.json non trovato. Estrai tutto lo ZIP prima di avviare il programma."
    }

    Install-PortableNode
    $env:Path = "$NodeDir;$env:Path"

    Write-Step "Controllo i componenti dell'app..."
    $packageLock = Join-Path $ProjectRoot "package-lock.json"
    $installMarker = Join-Path $RuntimeDir "installed-lock.sha256"
    $currentLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packageLock).Hash
    $installedLockHash = if (Test-Path $installMarker) {
        (Get-Content -LiteralPath $installMarker -Raw).Trim()
    } else {
        ""
    }

    if (-not (Test-Path (Join-Path $ProjectRoot "node_modules")) -or $installedLockHash -ne $currentLockHash) {
        Write-Step "Installo i componenti necessari. Il primo avvio puo richiedere alcuni minuti..."
        Push-Location $ProjectRoot
        try {
            & $NpmCmd ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                throw "Installazione dei componenti non riuscita."
            }
            Set-Content -LiteralPath $installMarker -Value $currentLockHash -NoNewline
        } finally {
            Pop-Location
        }
    }

    Write-Step "Avvio l'app. Questa finestra deve rimanere aperta."
    $server = Start-Process -FilePath $NpmCmd `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory $ProjectRoot `
        -NoNewWindow `
        -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($server.HasExited) {
            break
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $AppUrl -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $ready) {
        throw "Il server locale non ha risposto in tempo."
    }

    Write-Step "VideoShaheed e pronto. Apro il browser..."
    Start-Process $AppUrl
    Write-Host ""
    Write-Host "Per chiudere VideoShaheed, chiudi questa finestra." -ForegroundColor Yellow
    Write-Host ""

    $server.WaitForExit()
    exit $server.ExitCode
} catch {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
    Write-Host ""
    Write-Host ("ERRORE: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
