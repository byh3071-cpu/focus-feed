$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'focus-runtime.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function New-TestRepository {
    $path = Join-Path ([IO.Path]::GetTempPath()) ("focus-runtime-test-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path (Join-Path $path 'node_modules\next\dist\bin') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $path 'scripts') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $path 'node_modules\next\dist\bin\next') -Value ''
    Set-Content -LiteralPath (Join-Path $path 'scripts\knowledge-agent-sidecar.mjs') -Value ''
    Set-Content -LiteralPath (Join-Path $path 'qdrant.ps1') -Value ''
    New-Item -ItemType Directory -Path (Join-Path $path '1.18.3') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $path '1.18.3\qdrant.exe') -Value ''
    Set-Content -LiteralPath (Join-Path $path 'config.yaml') -Value ''
    Set-Content -LiteralPath (Join-Path $path 'ollama.exe') -Value ''
    Set-Content -LiteralPath (Join-Path $path '.gitignore') -Value "/.cache/`n"
    & git -C $path init -q
    return $path
}

function Reset-Mocks {
    $script:MockListeners = @{}
    $script:MockProcesses = @{}
    $script:Started = [Collections.Generic.List[object]]::new()
    $script:FailStart = $false
    $script:WrongApp = $false
    $script:MissingModel = $false
    $script:NextPid = 1000
    $script:FocusRuntimeHooks = @{
        GetListeners = {
            param($Port)
            if ($script:MockListeners.ContainsKey([int]$Port)) { return @($script:MockListeners[[int]$Port]) }
            return @()
        }
        GetProcess = { param($ProcessId) return $script:MockProcesses[[int]$ProcessId] }
        HttpJson = {
            param($Url)
            if ($Url -match '/api/health$') {
                if ($script:WrongApp) { return [pscustomobject]@{ service = 'other-service'; version = 1 } }
                return [pscustomobject]@{ service = 'focus-feed'; version = 1 }
            }
            if ($Url -match ':8787/health$') {
                return [pscustomobject]@{
                    ok = $true
                    providers = [pscustomobject]@{ claude = $false; codex = $false; cursor = $false }
                    transport = [pscustomobject]@{ http = $true; websocket = $true }
                }
            }
            if ($Url -match ':6333/') { return [pscustomobject]@{ result = @() } }
            if ($Url -match ':11434/api/tags$') {
                return [pscustomobject]@{ models = if ($script:MissingModel) { @() } else { @([pscustomobject]@{ name = 'bge-m3:latest' }) } }
            }
            throw "unexpected URL $Url"
        }
        Sleep = { param($Milliseconds) }
        StartProcess = {
            param($FilePath, $Arguments, $WorkingDirectory, $StdoutPath, $StderrPath, $Environment)
            if ($script:FailStart) { throw 'mock start failure' }
            $script:NextPid++
            $pidValue = $script:NextPid
            $command = "$FilePath " + (@($Arguments) -join ' ')
            $port = if ($command -match 'qdrant\.ps1') { 6333 }
                elseif ($command -match 'ollama(?:\.exe)?\s+serve') { 11434 }
                elseif ($command -match 'knowledge-agent-sidecar\.mjs') { 8787 }
                else { 3000 }
            $script:MockListeners[$port] = [pscustomobject]@{ Pid = $pidValue; Address = '127.0.0.1' }
            $identity = if ($port -eq 6333) { "$(Join-Path $script:Repository '1.18.3\qdrant.exe') --config-path $(Join-Path $script:Repository 'config.yaml')" } else { $command }
            $executable = if ($port -eq 6333) { Join-Path $script:Repository '1.18.3\qdrant.exe' } else { $FilePath }
            $script:MockProcesses[$pidValue] = [pscustomobject]@{ ExecutablePath = $executable; CommandLine = $identity }
            $script:Started.Add([pscustomobject]@{
                Port = $port; FilePath = $FilePath; Arguments = @($Arguments); Environment = $Environment
            })
            return [pscustomobject]@{ Id = $pidValue }
        }
    }
}

function Set-HealthyServices([string]$Repo) {
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue)
    if (-not $node) { $node = Get-Command node }
    $items = @(
        @{ Port = 3000; Pid = 201; Identity = "$($node.Source) $(Join-Path $Repo 'node_modules\next\dist\server\lib\start-server.js')" },
        @{ Port = 8787; Pid = 202; Identity = "$($node.Source) $(Join-Path $Repo 'scripts\knowledge-agent-sidecar.mjs')" },
        @{ Port = 6333; Pid = 203; Identity = "$(Join-Path $Repo '1.18.3\qdrant.exe') --config-path $(Join-Path $Repo 'config.yaml')" },
        @{ Port = 11434; Pid = 204; Identity = "$(Join-Path $Repo 'ollama.exe') serve" }
    )
    foreach ($item in $items) {
        $script:MockListeners[$item.Port] = [pscustomobject]@{ Pid = $item.Pid; Address = '127.0.0.1' }
        $script:MockProcesses[$item.Pid] = [pscustomobject]@{
            ExecutablePath = if ($item.Port -eq 11434) { Join-Path $Repo 'ollama.exe' } else { $node.Source }
            CommandLine = $item.Identity
        }
    }
    $script:MockProcesses[203].ExecutablePath = Join-Path $Repo '1.18.3\qdrant.exe'
}

function Set-InvocationDefaults([string]$Repo) {
    $script:Mode = 'Start'
    $script:Repository = $Repo
    $script:AppPort = 3000
    $script:SidecarPort = 8787
    $script:McpRepository = $null
    $script:BrainRoot = $null
    $script:QdrantStartScript = Join-Path $Repo 'qdrant.ps1'
    $script:QdrantExecutable = Join-Path $Repo '1.18.3\qdrant.exe'
    $script:QdrantConfig = Join-Path $Repo 'config.yaml'
    $script:OllamaPath = Join-Path $Repo 'ollama.exe'
    $script:StartupTimeoutSeconds = 1
}

$repositories = [Collections.Generic.List[string]]::new()
try {
    # Start: all absent services launch once, bind to mocked loopback listeners, and become healthy.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo
    $env:KNOWLEDGE_AGENT_ORIGINS = 'https://existing.example'
    $result = Invoke-FocusRuntime
    Assert-True ($result.status -eq 'healthy') 'start should return healthy'
    Assert-True ($script:Started.Count -eq 4) 'start should launch four absent services'
    $sidecar = $script:Started | Where-Object Port -eq 8787
    Assert-True ($sidecar.Environment.KNOWLEDGE_AGENT_ORIGINS -eq 'https://existing.example,http://127.0.0.1:3000') 'origins should append exact app origin'
    $ollama = $script:Started | Where-Object Port -eq 11434
    Assert-True ($ollama.Environment.OLLAMA_HOST -eq '127.0.0.1:11434') 'Ollama must bind loopback explicitly'

    # Focus .env.local contributes only explicit non-secret runtime roots to the app child.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo
    $mcp = Join-Path $repo 'mcp'; $brain = Join-Path $repo 'brain'
    New-Item -ItemType Directory -Path $mcp,$brain | Out-Null
    [IO.File]::WriteAllText((Join-Path $mcp '.env'), "QDRANT_URL=http://127.0.0.1:6333`nOLLAMA_URL=http://127.0.0.1:11434`nEMBEDDING_MODEL=bge-m3", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $repo '.env.local'), "FOCUS_FEED_MCP_ROOT=$mcp`nFOCUS_FEED_BRAIN_ROOT=$brain`nSUPABASE_SERVICE_ROLE_KEY=ignored", [Text.UTF8Encoding]::new($false))
    $parsedFocus = Read-ApprovedRuntimeEnvironment $repo '.env.local' @('FOCUS_FEED_MCP_ROOT', 'FOCUS_FEED_BRAIN_ROOT')
    Assert-True ($parsedFocus['FOCUS_FEED_MCP_ROOT'] -eq $mcp) 'approved Focus root should parse'
    $result = Invoke-FocusRuntime
    $app = $script:Started | Where-Object Port -eq 3000
    Assert-True ($app.Environment.FOCUS_FEED_MCP_ROOT -eq $mcp) "app should receive configured MCP root (got '$($app.Environment.FOCUS_FEED_MCP_ROOT)')"
    Assert-True ($app.Environment.FOCUS_FEED_BRAIN_ROOT -eq $brain) 'app should receive configured Brain root'
    Assert-True (-not $app.Environment.ContainsKey('SUPABASE_SERVICE_ROLE_KEY')) 'secret env keys must not be parsed or copied'

    # Reuse: healthy matching listeners are retained and nothing starts.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo; Set-HealthyServices $repo
    $result = Invoke-FocusRuntime
    Assert-True ($result.status -eq 'healthy') 'reuse should stay healthy'
    Assert-True ($script:Started.Count -eq 0) 'reuse must not duplicate processes'
    Assert-True (@($result.services | Where-Object recoveryAction -eq 'reuse').Count -eq 4) 'all services should report reuse'

    # Status is observational and never starts a stopped service.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo
    $script:Mode = 'Status'
    $result = Invoke-FocusRuntime
    Assert-True ($result.status -eq 'attention_required') 'stopped status should require attention'
    Assert-True (@($result.services | Where-Object status -eq 'stopped').Count -eq 4) 'status should report all stopped services'
    Assert-True ($script:Started.Count -eq 0) 'status must not launch services'

    # Collision: occupied unhealthy port is rejected and nothing starts.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo
    $script:MockListeners[3000] = [pscustomobject]@{ Pid = 301; Address = '0.0.0.0' }
    $script:MockProcesses[301] = [pscustomobject]@{ ExecutablePath = 'unknown.exe'; CommandLine = 'unknown' }
    try { Invoke-FocusRuntime; throw 'expected collision failure' } catch {
        Assert-True ($_.Exception.Message -match 'Occupied runtime port') 'collision should be explicit'
    }
    Assert-True ($script:Started.Count -eq 0) 'collision must not start around occupied port'

    # Wrong service identity: an HTTP 200 with another app identity cannot be reused or replaced.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo; Set-HealthyServices $repo
    $script:WrongApp = $true
    try { Invoke-FocusRuntime; throw 'expected wrong-service failure' } catch {
        Assert-True ($_.Exception.Message -match 'Occupied runtime port') 'wrong service must be collision'
    }
    Assert-True ($script:Started.Count -eq 0) 'wrong service must never trigger replacement start'

    # Matching HTTP with uncertain process ownership is reported separately and never claimed or replaced.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo; Set-HealthyServices $repo
    $script:MockProcesses[202] = [pscustomobject]@{ ExecutablePath = 'node.exe'; CommandLine = 'node scripts/knowledge-agent-sidecar.mjs' }
    $script:Mode = 'Status'
    $result = Invoke-FocusRuntime
    $uncertain = $result.services | Where-Object service -eq 'sidecar'
    Assert-True ($uncertain.status -eq 'needs_identity_check') 'uncertain healthy identity should be explicit'
    Assert-True ($script:Started.Count -eq 0) 'identity review must not start or replace a process'

    # Every listener owner must match; a second foreign PID prevents reuse.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo; Set-HealthyServices $repo
    $script:MockListeners[6333] = @($script:MockListeners[6333], [pscustomobject]@{ Pid = 205; Address = '127.0.0.1' })
    $script:MockProcesses[205] = [pscustomobject]@{ ExecutablePath = 'C:\other\qdrant.exe'; CommandLine = 'qdrant.exe --config-path C:\other\config.yaml' }
    $script:Mode = 'Status'
    $result = Invoke-FocusRuntime
    $qdrantState = $result.services | Where-Object service -eq 'qdrant'
    Assert-True ($qdrantState.status -eq 'needs_identity_check') 'all listener PIDs must match managed Qdrant identity'
    Assert-True ($qdrantState.pids.Count -eq 2) 'status should expose every distinct listener PID'

    # Running Ollama without the required model is a dependency gap, not a port collision.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo; Set-HealthyServices $repo
    $script:MissingModel = $true; $script:Mode = 'Status'
    $result = Invoke-FocusRuntime
    $ollamaState = $result.services | Where-Object service -eq 'ollama'
    Assert-True ($ollamaState.status -eq 'dependency_missing') 'missing model should be distinct from collision'
    Assert-True ($ollamaState.recoveryAction -eq 'pull_bge-m3_manually') 'model recovery must be manual'

    # Start failure is surfaced and no process is killed or retried.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo
    $script:FailStart = $true
    try { Invoke-FocusRuntime; throw 'expected start failure' } catch {
        Assert-True ($_.Exception.Message -match 'mock start failure') 'start failure should surface'
    }
    Assert-True ($script:Started.Count -eq 0) 'failed start should not claim a process'

    # OS-owned redirection survives the short-lived launcher process and preserves parent env.
    $repo = New-TestRepository; $repositories.Add($repo)
    $launcher = Join-Path $repo 'detached-launch.ps1'
    $stdout = Join-Path $repo 'delayed.stdout.log'
    $stderr = Join-Path $repo 'delayed.stderr.log'
    $delayedChild = Join-Path $repo 'delayed-child.ps1'
    [IO.File]::WriteAllText($delayedChild, 'Start-Sleep -Milliseconds 2500; Write-Output $env:FOCUS_RUNTIME_CHILD_MARKER', [Text.UTF8Encoding]::new($false))
    $runtimeScript = Join-Path $PSScriptRoot 'focus-runtime.ps1'
    $launcherSource = @'
param($RuntimeScript, $StdoutPath, $StderrPath, $WorkDirectory, $DelayedChild)
. $RuntimeScript
Start-RuntimeProcess -FilePath (Get-Command powershell.exe).Source `
    -Arguments @('-NoProfile', '-File', $DelayedChild) `
    -WorkingDirectory $WorkDirectory -StdoutPath $StdoutPath -StderrPath $StderrPath `
    -Environment @{ FOCUS_RUNTIME_CHILD_MARKER = 'delayed-output' } | Out-Null
'@
    [IO.File]::WriteAllText($launcher, $launcherSource, [Text.UTF8Encoding]::new($false))
    [Environment]::SetEnvironmentVariable('FOCUS_RUNTIME_CHILD_MARKER', 'parent-value', 'Process')
    & powershell.exe -NoProfile -File $launcher -RuntimeScript $runtimeScript -StdoutPath $stdout -StderrPath $stderr -WorkDirectory $repo -DelayedChild $delayedChild
    Assert-True ($LASTEXITCODE -eq 0) 'short-lived launcher should exit successfully'
    Assert-True ([Environment]::GetEnvironmentVariable('FOCUS_RUNTIME_CHILD_MARKER', 'Process') -eq 'parent-value') 'launcher process env must be restored'
    $earlyContent = if (Test-Path $stdout) { [string]::Join("`n", @(Get-Content $stdout -ErrorAction SilentlyContinue)) } else { '' }
    Assert-True ($earlyContent -notmatch 'delayed-output') "child output should still be delayed when launcher exits (got '$earlyContent')"
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $content = if (Test-Path $stdout) { [string]::Join("`n", @(Get-Content $stdout -ErrorAction SilentlyContinue)) } else { '' }
    } while ($content -notmatch 'delayed-output' -and [DateTime]::UtcNow -lt $deadline)
    Assert-True ($content -match 'delayed-output') 'detached child should write after launcher exits'
    Start-Sleep -Milliseconds 500
    [Environment]::SetEnvironmentVariable('FOCUS_RUNTIME_CHILD_MARKER', $null, 'Process')

    # Explicit MCP configuration cannot silently redirect managed local services.
    $repo = New-TestRepository; $repositories.Add($repo); Reset-Mocks; Set-InvocationDefaults $repo
    $mcp = Join-Path $repo 'mcp'; New-Item -ItemType Directory -Path $mcp | Out-Null
    [IO.File]::WriteAllText((Join-Path $mcp '.env'), "QDRANT_URL=https://remote.example`nSECRET_TOKEN=must-not-be-used", [Text.UTF8Encoding]::new($false))
    $script:McpRepository = $mcp
    try { Invoke-FocusRuntime; throw 'expected MCP target mismatch' } catch {
        Assert-True ($_.Exception.Message -match 'does not match') 'remote MCP target should be rejected'
    }
    Assert-True ($script:Started.Count -eq 0) 'configuration mismatch must fail before start'

    Write-Output 'focus-runtime tests passed: start, reuse, status, collision, wrong identity, failure, config mismatch'
} finally {
    Remove-Item Env:KNOWLEDGE_AGENT_ORIGINS -ErrorAction SilentlyContinue
    Remove-Item Env:FOCUS_RUNTIME_CHILD_MARKER -ErrorAction SilentlyContinue
    foreach ($repo in $repositories) {
        if (-not $repo -or -not (Test-Path -LiteralPath $repo)) { continue }
        $resolved = (Resolve-Path -LiteralPath $repo).Path
        $fixtureParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        $resolvedParent = [IO.Path]::GetDirectoryName($resolved).TrimEnd('\')
        $leaf = [IO.Path]::GetFileName($resolved)
        if ($resolved -eq $fixtureParent -or $resolvedParent -ne $fixtureParent -or
            $leaf -notmatch '^focus-runtime-test-[0-9a-f-]{36}$') {
            throw "Refusing to remove unexpected test path: $resolved"
        }
        for ($attempt = 0; $attempt -lt 100 -and (Test-Path -LiteralPath $resolved); $attempt++) {
            try { Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop } catch {
                if ($attempt -eq 99) { throw }
                Start-Sleep -Milliseconds 100
            }
        }
        if (Test-Path -LiteralPath $resolved) { throw "Failed to remove verified test path: $resolved" }
    }
}
