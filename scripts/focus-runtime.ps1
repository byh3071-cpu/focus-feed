[CmdletBinding()]
param(
    [ValidateSet('Start', 'Status')]
    [string]$Mode = 'Start',
    [string]$Repository,
    [ValidateRange(1024, 65535)] [int]$AppPort = 3000,
    [ValidateRange(1024, 65535)] [int]$SidecarPort = 8787,
    [string]$McpRepository,
    [string]$BrainRoot,
    [string]$QdrantStartScript = 'C:\Users\Public\dev\_runtime\qdrant\start-qdrant.ps1',
    [string]$OllamaPath,
    [ValidateRange(1, 180)] [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
if (-not $Repository) { $Repository = Split-Path -Parent $PSScriptRoot }

function Invoke-RuntimeHook {
    param([string]$Name, [object[]]$Arguments = @())
    if ($script:FocusRuntimeHooks -and $script:FocusRuntimeHooks.ContainsKey($Name)) {
        return & $script:FocusRuntimeHooks[$Name] @Arguments
    }
    switch ($Name) {
        'GetListeners' {
            return @(Get-NetTCPConnection -State Listen -LocalPort ([int]$Arguments[0]) -ErrorAction SilentlyContinue |
                ForEach-Object { [pscustomobject]@{ Pid = [int]$_.OwningProcess; Address = [string]$_.LocalAddress } })
        }
        'GetProcess' {
            return Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$Arguments[0])" -ErrorAction SilentlyContinue
        }
        'HttpJson' {
            return Invoke-RestMethod -Uri ([string]$Arguments[0]) -TimeoutSec 2 -Method Get
        }
        'Sleep' { Start-Sleep -Milliseconds ([int]$Arguments[0]); return }
        'StartProcess' { return Start-RuntimeProcess @Arguments }
        default { throw "Unknown runtime hook: $Name" }
    }
}

function Resolve-ExistingDirectory([string]$Path, [string]$Label) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label directory is unavailable."
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-ExistingFile([string]$Path, [string]$Label) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label file is unavailable."
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-NodePath {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $command) { throw 'Installed Node.js executable is unavailable.' }
    return $command.Source
}

function Resolve-OllamaExecutable([string]$ExplicitPath) {
    if ($ExplicitPath) { return Resolve-ExistingFile $ExplicitPath 'Ollama' }
    $command = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' } else { $null }
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }
    throw 'Installed Ollama executable is unavailable.'
}

function ConvertTo-NativeArgument([string]$Value) {
    if ($Value -notmatch '[\s"]') { return $Value }
    $builder = [Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (2 * $slashes + 1)))
            [void]$builder.Append('"')
            $slashes = 0
            continue
        }
        if ($slashes) { [void]$builder.Append(('\' * $slashes)); $slashes = 0 }
        [void]$builder.Append($character)
    }
    if ($slashes) { [void]$builder.Append(('\' * (2 * $slashes))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Start-RuntimeProcess {
    param(
        [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory,
        [string]$StdoutPath, [string]$StderrPath, [hashtable]$Environment
    )
    $helper = Resolve-ExistingFile (Join-Path $PSScriptRoot 'focus-runtime-launch.mjs') 'Runtime launch helper'
    $payload = @{
        filePath = $FilePath; arguments = @($Arguments); workingDirectory = $WorkingDirectory
        stdoutPath = $StdoutPath; stderrPath = $StderrPath; environment = $Environment
    } | ConvertTo-Json -Compress -Depth 4
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    $node = Resolve-NodePath
    $output = & $node $helper $encoded
    if ($LASTEXITCODE -ne 0) { throw 'Detached runtime helper failed to start the process.' }
    $started = $output | ConvertFrom-Json
    if (-not $started.Id) { throw 'Detached runtime helper returned no process identifier.' }
    return [pscustomobject]@{ Id = [int]$started.Id }
}

function Test-LoopbackAddress([string]$Address) {
    return $Address -in @('127.0.0.1', '::1')
}

function ConvertTo-IdentityPath([string]$Path) {
    if (-not $Path) { return '' }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\').Replace('/', '\')
}

function Test-ProcessIdentity([int]$ProcessId, [string[]]$RequiredTokens, [string]$Kind, [string]$ExpectedExecutable = '') {
    $process = Invoke-RuntimeHook 'GetProcess' @($ProcessId)
    if (-not $process) { return $false }
    if ($ExpectedExecutable) {
        try {
            if ((ConvertTo-IdentityPath ([string]$process.ExecutablePath)) -ne (ConvertTo-IdentityPath $ExpectedExecutable)) { return $false }
        } catch { return $false }
    }
    $identity = "$($process.ExecutablePath) $($process.CommandLine)"
    foreach ($token in $RequiredTokens) {
        if (-not $token -or $identity.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            return $false
        }
    }
    return $true
}

function Test-ServiceHealth([string]$Kind, [int]$Port, [string]$Model) {
    try {
        switch ($Kind) {
            'app' {
                $body = Invoke-RuntimeHook 'HttpJson' @("http://127.0.0.1:$Port/api/health")
                return $body.service -eq 'focus-feed' -and [int]$body.version -eq 1
            }
            'sidecar' {
                $body = Invoke-RuntimeHook 'HttpJson' @("http://127.0.0.1:$Port/health")
                return $body.ok -eq $true -and $null -ne $body.providers -and
                    $body.providers.claude -is [bool] -and $body.providers.codex -is [bool] -and
                    $body.providers.cursor -is [bool] -and $null -ne $body.transport -and
                    $body.transport.http -is [bool] -and $body.transport.websocket -is [bool]
            }
            'qdrant' {
                try { [void](Invoke-RuntimeHook 'HttpJson' @("http://127.0.0.1:$Port/healthz")); return $true }
                catch {
                    $body = Invoke-RuntimeHook 'HttpJson' @("http://127.0.0.1:$Port/collections")
                    return $null -ne $body.result
                }
            }
            'ollama' {
                $body = Invoke-RuntimeHook 'HttpJson' @("http://127.0.0.1:$Port/api/tags")
                return @($body.models | ForEach-Object { $_.name }) -match "^$([regex]::Escape($Model))(?::|$)"
            }
        }
    } catch { return $false }
    return $false
}

function Test-OllamaEndpointAlive([int]$Port) {
    try {
        $body = Invoke-RuntimeHook 'HttpJson' @("http://127.0.0.1:$Port/api/tags")
        return $null -ne $body.PSObject.Properties['models']
    } catch { return $false }
}

function Get-RuntimeService {
    param(
        [string]$Name, [int]$Port, [string]$Kind, [string[]]$IdentityTokens,
        [string]$Model = '', [string]$ExpectedExecutable = ''
    )
    $listeners = @(Invoke-RuntimeHook 'GetListeners' @($Port))
    if ($listeners.Count -eq 0) {
        return [pscustomobject]@{
            service = $Name; port = $Port; pid = $null; status = 'stopped';
            recoveryAction = 'start'; auth = 'not_checked'; healthScope = 'process_only'
        }
    }
    $loopbackOnly = @($listeners | Where-Object { -not (Test-LoopbackAddress $_.Address) }).Count -eq 0
    $pids = @($listeners | ForEach-Object { [int]$_.Pid } | Select-Object -Unique)
    $identity = $loopbackOnly -and @($pids | Where-Object {
        -not (Test-ProcessIdentity $_ $IdentityTokens $Kind $ExpectedExecutable)
    }).Count -eq 0
    $healthMatches = $loopbackOnly -and (Test-ServiceHealth $Kind $Port $Model)
    $healthy = $identity -and $healthMatches
    $ollamaMissing = $Kind -eq 'ollama' -and $loopbackOnly -and $identity -and
        -not $healthMatches -and (Test-OllamaEndpointAlive $Port)
    $status = if ($healthy) { 'healthy' } elseif ($ollamaMissing) { 'dependency_missing' } elseif ($healthMatches) {
        'needs_identity_check'
    } else { 'collision' }
    return [pscustomobject]@{
        service = $Name; port = $Port; pid = [int]$pids[0]; pids = $pids;
        status = $status
        recoveryAction = if ($healthy) { 'reuse' } elseif ($ollamaMissing) { 'pull_bge-m3_manually' } elseif ($healthMatches) {
            'verify_owner_or_relaunch_with_absolute_command'
        } else { 'free_port_or_choose_another_port' }
        auth = 'not_checked'; healthScope = 'process_only'
    }
}

function Wait-RuntimeService {
    param([string]$Name, [int]$Port, [string]$Kind, [string[]]$IdentityTokens, [string]$Model, [string]$ExpectedExecutable = '')
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    do {
        $state = Get-RuntimeService $Name $Port $Kind $IdentityTokens $Model $ExpectedExecutable
        if ($state.status -eq 'healthy') { return $state }
        if ($state.status -eq 'dependency_missing') { throw "$Name dependency is missing; follow recoveryAction." }
        Invoke-RuntimeHook 'Sleep' @(250)
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Name failed to become healthy."
}

function Assert-CacheIgnored([string]$ResolvedRepository) {
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $git) { $git = Get-Command git -ErrorAction SilentlyContinue }
    if (-not $git) { throw 'Git is unavailable for runtime cache safety check.' }
    & $git.Source -C $ResolvedRepository check-ignore -q -- '.cache/focus-runtime/probe.log'
    if ($LASTEXITCODE -ne 0) { throw 'Repository .cache/focus-runtime must be gitignored before launch.' }
}

function Add-Origin([string]$Existing, [string]$Origin) {
    $values = @($Existing -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($values -notcontains $Origin) { $values += $Origin }
    return ($values -join ',')
}

function Read-ApprovedRuntimeEnvironment([string]$Directory, [string]$FileName, [string[]]$Approved) {
    $values = @{}
    $path = Join-Path $Directory $FileName
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $values }
    $reader = [IO.StreamReader]::new($path, [Text.UTF8Encoding]::new($false, $true))
    try {
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ($line -notmatch '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$') { continue }
            $key = $Matches[1]
            if ($Approved -notcontains $key) { continue }
            $value = $Matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $values[$key] = $value
        }
    } finally { $reader.Dispose() }
    return $values
}

function Assert-LocalMcpRuntimeConfiguration([hashtable]$Values, [string]$ExplicitBrainRoot) {
    if ($Values.QDRANT_PATH) { throw 'MCP .env selects local Qdrant storage instead of the runtime server.' }
    if ($Values.QDRANT_URL -and $Values.QDRANT_URL -notin @('http://127.0.0.1:6333', 'http://localhost:6333')) {
        throw 'MCP .env Qdrant target does not match the managed loopback runtime.'
    }
    if ($Values.OLLAMA_URL -and $Values.OLLAMA_URL -notin @('http://127.0.0.1:11434', 'http://localhost:11434')) {
        throw 'MCP .env Ollama target does not match the managed loopback runtime.'
    }
    if ($Values.EMBEDDING_MODEL -and $Values.EMBEDDING_MODEL -ne 'bge-m3') {
        throw 'MCP .env embedding model does not match bge-m3.'
    }
    if ($ExplicitBrainRoot -and $Values.YOHAN_BRAIN_ROOT) {
        $configured = [IO.Path]::GetFullPath($Values.YOHAN_BRAIN_ROOT)
        if ($configured -ne $ExplicitBrainRoot) { throw 'Explicit Brain root does not match MCP .env.' }
    }
}

function Get-MutexName([string]$RepositoryPath, [int]$ApplicationPort, [int]$AgentPort) {
    $bytes = [Text.Encoding]::UTF8.GetBytes("$RepositoryPath|$ApplicationPort|$AgentPort")
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $hash = $algorithm.ComputeHash($bytes) } finally { $algorithm.Dispose() }
    $hex = ([BitConverter]::ToString($hash)).Replace('-', '')
    return 'Local\focus-runtime-' + $hex.Substring(0, 24)
}

function Invoke-FocusRuntime {
    $resolvedRepository = Resolve-ExistingDirectory $Repository 'Focus repository'
    if ($AppPort -eq $SidecarPort -or $AppPort -in @(6333, 11434) -or $SidecarPort -in @(6333, 11434)) {
        throw 'Runtime ports must be distinct.'
    }
    $nextBin = Resolve-ExistingFile (Join-Path $resolvedRepository 'node_modules\next\dist\bin\next') 'Next.js CLI'
    $sidecarScript = Resolve-ExistingFile (Join-Path $resolvedRepository 'scripts\knowledge-agent-sidecar.mjs') 'Knowledge sidecar'
    $nodePath = Resolve-NodePath
    $focusEnvironment = Read-ApprovedRuntimeEnvironment $resolvedRepository '.env.local' @(
        'FOCUS_FEED_MCP_ROOT', 'FOCUS_FEED_BRAIN_ROOT'
    )
    $resolvedMcp = if ($McpRepository) { Resolve-ExistingDirectory $McpRepository 'MCP repository' } elseif ($focusEnvironment.FOCUS_FEED_MCP_ROOT) {
        Resolve-ExistingDirectory $focusEnvironment.FOCUS_FEED_MCP_ROOT 'MCP repository'
    } elseif ($env:FOCUS_FEED_MCP_ROOT) { Resolve-ExistingDirectory $env:FOCUS_FEED_MCP_ROOT 'MCP repository' } else { $null }
    $resolvedBrain = if ($BrainRoot) { Resolve-ExistingDirectory $BrainRoot 'Brain root' } elseif ($focusEnvironment.FOCUS_FEED_BRAIN_ROOT) {
        Resolve-ExistingDirectory $focusEnvironment.FOCUS_FEED_BRAIN_ROOT 'Brain root'
    } elseif ($env:FOCUS_FEED_BRAIN_ROOT) { Resolve-ExistingDirectory $env:FOCUS_FEED_BRAIN_ROOT 'Brain root' } else { $null }
    if ($McpRepository -and $focusEnvironment.FOCUS_FEED_MCP_ROOT -and
        (Resolve-ExistingDirectory $focusEnvironment.FOCUS_FEED_MCP_ROOT 'MCP repository') -ne $resolvedMcp) {
        throw 'Explicit MCP repository does not match Focus .env.local.'
    }
    if ($BrainRoot -and $focusEnvironment.FOCUS_FEED_BRAIN_ROOT -and
        (Resolve-ExistingDirectory $focusEnvironment.FOCUS_FEED_BRAIN_ROOT 'Brain root') -ne $resolvedBrain) {
        throw 'Explicit Brain root does not match Focus .env.local.'
    }
    if ($resolvedMcp) {
        $mcpRuntimeEnvironment = Read-ApprovedRuntimeEnvironment $resolvedMcp '.env' @(
            'QDRANT_URL', 'QDRANT_PATH', 'OLLAMA_URL', 'EMBEDDING_MODEL', 'YOHAN_BRAIN_ROOT'
        )
        Assert-LocalMcpRuntimeConfiguration $mcpRuntimeEnvironment $resolvedBrain
        if (-not $resolvedBrain -and $mcpRuntimeEnvironment.YOHAN_BRAIN_ROOT) {
            $resolvedBrain = Resolve-ExistingDirectory $mcpRuntimeEnvironment.YOHAN_BRAIN_ROOT 'Brain root'
        }
    }
    $resolvedQdrantScript = Resolve-ExistingFile $QdrantStartScript 'Qdrant start helper'
    $qdrantDirectory = Split-Path $resolvedQdrantScript
    $resolvedQdrantExecutable = Resolve-ExistingFile (Join-Path $qdrantDirectory '1.18.3\qdrant.exe') 'Qdrant executable'
    $resolvedQdrantConfig = Resolve-ExistingFile (Join-Path $qdrantDirectory 'config.yaml') 'Qdrant config'
    $resolvedOllama = Resolve-OllamaExecutable $OllamaPath
    $logDirectory = Join-Path $resolvedRepository '.cache\focus-runtime'
    $statePath = Join-Path $logDirectory 'runtime-state.json'
    Assert-CacheIgnored $resolvedRepository

    $definitions = @(
        @{ Name = 'app'; Port = $AppPort; Kind = 'app'; Tokens = @((Join-Path $resolvedRepository 'node_modules\next\dist')); Model = ''; Executable = $nodePath },
        @{ Name = 'sidecar'; Port = $SidecarPort; Kind = 'sidecar'; Tokens = @($sidecarScript); Model = ''; Executable = $nodePath },
        @{ Name = 'qdrant'; Port = 6333; Kind = 'qdrant'; Tokens = @($resolvedQdrantConfig); Model = ''; Executable = $resolvedQdrantExecutable },
        @{ Name = 'ollama'; Port = 11434; Kind = 'ollama'; Tokens = @('serve'); Model = 'bge-m3'; Executable = $resolvedOllama }
    )
    $readState = { @($definitions | ForEach-Object { Get-RuntimeService $_.Name $_.Port $_.Kind $_.Tokens $_.Model $_.Executable }) }
    if ($Mode -eq 'Status') {
        $services = & $readState
        return [ordered]@{
            status = if (@($services | Where-Object status -ne 'healthy').Count) { 'attention_required' } else { 'healthy' }
            recoveryAction = if (@($services | Where-Object status -ne 'healthy').Count) { 'run_start_or_resolve_collision' } else { 'none' }
            auth = 'not_checked'; repository = $resolvedRepository
            targets = @{ app = "http://127.0.0.1:$AppPort"; sidecar = "http://127.0.0.1:$SidecarPort"; qdrant = 'http://127.0.0.1:6333'; ollama = 'http://127.0.0.1:11434'; model = 'bge-m3' }
            services = $services
        }
    }

    $mutex = [Threading.Mutex]::new($false, (Get-MutexName $resolvedRepository $AppPort $SidecarPort))
    if (-not $mutex.WaitOne(0)) { throw 'Another launcher owns this repository and port set.' }
    try {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $states = & $readState
        $blocked = @($states | Where-Object { $_.status -notin @('healthy', 'stopped') })
        if ($blocked.Count) { throw "Occupied runtime port failed identity or health validation: $($blocked[0].service)." }
        $started = @{}
        $start = {
            param($Name, $File, $Arguments, $Working, $Environment)
            $started[$Name] = (Invoke-RuntimeHook 'StartProcess' @(
                $File, [string[]]$Arguments, $Working,
                (Join-Path $logDirectory "$Name.stdout.log"),
                (Join-Path $logDirectory "$Name.stderr.log"), $Environment
            )).Id
        }
        if (($states | Where-Object service -eq 'qdrant').status -eq 'stopped') {
            $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
            & $start 'qdrant' $powershell @('-NoProfile', '-File', $resolvedQdrantScript) (Split-Path $resolvedQdrantScript) @{}
        }
        if (($states | Where-Object service -eq 'ollama').status -eq 'stopped') {
            & $start 'ollama' $resolvedOllama @('serve') (Split-Path $resolvedOllama) @{
                OLLAMA_HOST = '127.0.0.1:11434'
            }
        }
        if (($states | Where-Object service -eq 'app').status -eq 'stopped') {
            $appEnvironment = @{}
            if ($resolvedMcp) { $appEnvironment['FOCUS_FEED_MCP_ROOT'] = $resolvedMcp }
            if ($resolvedBrain) { $appEnvironment['FOCUS_FEED_BRAIN_ROOT'] = $resolvedBrain }
            & $start 'app' $nodePath @($nextBin, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', "$AppPort") $resolvedRepository $appEnvironment
        }
        if (($states | Where-Object service -eq 'sidecar').status -eq 'stopped') {
            $environment = @{
                KNOWLEDGE_AGENT_PORT = "$SidecarPort"
                KNOWLEDGE_AGENT_ORIGINS = Add-Origin $env:KNOWLEDGE_AGENT_ORIGINS "http://127.0.0.1:$AppPort"
            }
            & $start 'sidecar' $nodePath @($sidecarScript) $resolvedRepository $environment
        }
        $final = @()
        foreach ($definition in $definitions) {
            $existing = $states | Where-Object service -eq $definition.Name
            $final += if ($existing.status -eq 'healthy') { $existing } else {
                Wait-RuntimeService $definition.Name $definition.Port $definition.Kind $definition.Tokens $definition.Model $definition.Executable
            }
        }
        $result = [ordered]@{
            status = 'healthy'; recoveryAction = 'none'; auth = 'not_checked'; repository = $resolvedRepository
            targets = @{ app = "http://127.0.0.1:$AppPort"; sidecar = "http://127.0.0.1:$SidecarPort"; qdrant = 'http://127.0.0.1:6333'; ollama = 'http://127.0.0.1:11434'; model = 'bge-m3' }
            services = $final; launcherPids = $started; logs = $logDirectory
        }
        $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding utf8
        return $result
    } finally {
        $mutex.ReleaseMutex()
        $mutex.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-FocusRuntime | ConvertTo-Json -Depth 6
    } catch {
        [ordered]@{
            status = 'failed'; recoveryAction = 'inspect_collision_or_runtime_logs';
            auth = 'not_checked'; error = $_.Exception.Message
        } | ConvertTo-Json -Depth 4
        exit 1
    }
}
