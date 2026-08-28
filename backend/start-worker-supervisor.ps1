param(
    [string]$BackendDir = $PSScriptRoot,
    [int]$PollIntervalSeconds = 10,
    [int]$RestartGraceSeconds = 20,
    [int]$LogTailLines = 80,
    # Hard ceiling on this supervisor's own memory use, checked once per loop.
    # The 2026-08-02 runaway growth is now fixed at its source (see Get-LogTail), so
    # this is a backstop for some *future* leak, not the primary defence.
    # Its known limitation: it is checked from inside the loop, so it cannot fire while
    # the loop is blocked inside a single call — during the ConvertTo-Json stall the
    # process passed 1.7GB without ever reaching this line. watchdog-worker-supervisor.ps1
    # exists precisely to cover that case from outside the process. Do not treat this
    # in-loop valve as sufficient on its own.
    [int]$MaxWorkingSetMB = 400
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
# Standard practice for a script that calls Invoke-RestMethod in a loop: progress-bar
# rendering is pure overhead here. NOTE: this was once believed to be the cause of the
# MEMORY_MANAGEMENT (0x1A) BSODs and shipped as such in fdf6dd5 — it was not, and the
# leak continued afterwards. The real cause is documented above Get-LogTail. Keeping
# this line because it is correct hygiene, not because it fixes anything.
$ProgressPreference = "SilentlyContinue"

$SupervisorVersion = "2026-08-28"
$SupervisorStartedAt = (Get-Date).ToUniversalTime().ToString("o")
$SupervisorLog = Join-Path $BackendDir "worker-supervisor.log"
$WorkerLog = Join-Path $BackendDir "worker.log"
$WorkerErrorLog = Join-Path $BackendDir "worker-error.log"
$LastSeenRestartToken = $null
$DesiredState = "run"
$LastControlError = $null
$Child = $null
$ChildStartedAt = $null
$ChildExitCode = $null
$PythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"

function Write-SupervisorLog {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Message
    # This file is append-only and the supervisor runs for months at a time, so without
    # rotation it grows without bound — and Get-LogTail reads it on every poll. Roll at
    # 1MB, keeping one previous generation.
    try {
        if ((Test-Path $SupervisorLog) -and ((Get-Item $SupervisorLog -Force).Length -gt 1MB)) {
            Move-Item -Path $SupervisorLog -Destination "$SupervisorLog.1" -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # Rotation is best-effort; never let it take the supervisor down.
    }
    Add-Content -Path $SupervisorLog -Value $line
    Write-Host $line
}

# Only one supervisor (and therefore one worker child) may run at a time — a second
# launch (e.g. double-clicking the desktop shortcut while it's already running from
# Startup) would otherwise race the first for scrape claims. The mutex is owned by
# the OS and released automatically if this process dies, so there's no stale-lock
# cleanup to worry about.
$InstanceMutex = New-Object System.Threading.Mutex($false, "Global\LetterboxdDesktopWorkerSupervisor")
$instanceAcquired = $false
try {
    $instanceAcquired = $InstanceMutex.WaitOne([TimeSpan]::Zero)
} catch [System.Threading.AbandonedMutexException] {
    # Watchdog taskkill (/T /F) can abandon the mutex; the next start must take
    # over instead of aborting under $ErrorActionPreference = "Stop".
    Write-SupervisorLog "previous instance left an abandoned mutex (watchdog kill?); taking over"
    $instanceAcquired = $true
}
if (-not $instanceAcquired) {
    Write-SupervisorLog "another supervisor instance is already running; exiting"
    exit 0
}

function Load-DotEnv {
    $envPath = Join-Path $BackendDir ".env"
    if (-not (Test-Path $envPath)) {
        return
    }
    foreach ($line in Get-Content $envPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
            continue
        }
        $name, $value = $trimmed.Split("=", 2)
        $name = $name.Trim()
        $value = $value.Trim().Trim('"').Trim("'")
        if ($name -and -not [Environment]::GetEnvironmentVariable($name, "Process")) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Get-BackendUrl {
    return ([string]$env:WORKER_BACKEND_URL).TrimEnd("/")
}

function Get-WorkerHeaders {
    return @{ "X-Worker-Token" = [string]$env:WORKER_TOKEN }
}

function Invoke-WorkerApi {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )
    $backendUrl = Get-BackendUrl
    if (-not $backendUrl -or -not $env:WORKER_TOKEN) {
        throw "WORKER_BACKEND_URL and WORKER_TOKEN must be set in .env or the process environment."
    }
    $params = @{
        Uri = "$backendUrl$Path"
        Method = $Method
        Headers = Get-WorkerHeaders
        TimeoutSec = 15
    }
    if ($null -ne $Body) {
        # Depth 4 is more than the flat supervisor payload needs. It is deliberately low
        # so that if a future caller ever passes an object graph deeper than expected,
        # ConvertTo-Json truncates instead of walking off into it (see Get-LogTail for
        # what that cost us). Anything passed here must be plain strings/numbers/hashtables.
        $params.Body = $Body | ConvertTo-Json -Depth 4
        $params.ContentType = "application/json"
    }
    return Invoke-RestMethod @params
}

function Test-ChildRunning {
    if ($null -eq $script:Child) {
        return $false
    }
    try {
        return -not $script:Child.HasExited
    } catch {
        return $false
    }
}

function Start-WorkerChild {
    if (Test-ChildRunning) {
        return
    }
    if (-not (Test-Path $PythonExe)) {
        throw "Worker interpreter not found at $PythonExe. Create backend/.venv before starting the supervisor."
    }
    Write-SupervisorLog ("starting worker child interpreter={0}" -f $PythonExe)
    $script:Child = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList @("-m", "app.worker.desktop_scrape_worker") `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $WorkerLog `
        -RedirectStandardError $WorkerErrorLog `
        -PassThru `
        -WindowStyle Hidden
    $script:ChildStartedAt = (Get-Date).ToUniversalTime().ToString("o")
    $script:ChildExitCode = $null
    Write-SupervisorLog ("worker child started pid={0}" -f $script:Child.Id)
}

function Stop-WorkerChild {
    if (-not (Test-ChildRunning)) {
        return
    }
    $pidToStop = $script:Child.Id
    Write-SupervisorLog ("stopping worker child pid={0}" -f $pidToStop)
    try {
        taskkill.exe /PID $pidToStop /T | Out-Null
        Wait-Process -Id $pidToStop -Timeout $RestartGraceSeconds -ErrorAction SilentlyContinue
    } catch {
        Write-SupervisorLog ("graceful stop failed: {0}" -f $_.Exception.Message)
    }
    if (Test-ChildRunning) {
        Write-SupervisorLog ("forcing worker child stop pid={0}" -f $pidToStop)
        taskkill.exe /PID $pidToStop /T /F | Out-Null
    }
    try {
        $script:Child.Refresh()
        $script:ChildExitCode = $script:Child.ExitCode
    } catch {
        $script:ChildExitCode = $null
    }
}

# A worker child started with Start-Process is an independent process, not attached to
# this supervisor via a job object — so if the supervisor dies (crash, memory valve, kill)
# the python worker keeps running, keeps polling the backend and keeps serving prod, with
# its stdout pointing at a log file the next supervisor run will truncate. That is exactly
# what happened on 2026-08-02/03: prod was being served for 10+ hours by an orphan nobody
# knew was there, invisible because worker.log read empty.
#
# Left alone, the next supervisor start adds a *second* worker that races the orphan for
# job claims — the repeated "Fair claim failed: HTTP 409" in worker-error.log. So adopt
# the machine's state before starting anything: kill any pre-existing worker process.
#
# Fail-safe by construction: a process whose command line we cannot read (a more
# privileged process than us) is skipped rather than guessed at, so this can never kill
# something it has not positively identified as our worker.
function Stop-OrphanWorkers {
    $marker = "app.worker.desktop_scrape_worker"
    $orphans = @()
    $pythons = @()
    try {
        $pythons = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction Stop)
        $orphans = @($pythons | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($marker) })
    } catch {
        Write-SupervisorLog ("orphan scan failed, continuing: {0}" -f $_.Exception.Message)
        return
    }
    # The fail-safe skip above turns into a silent one when this supervisor is not
    # elevated: an elevated orphan's command line reads back $null, so it is invisible
    # rather than merely unkillable, and we would start a second worker to race it.
    # Say so, otherwise the next 409 storm looks like it came from nowhere.
    $unreadable = @($pythons | Where-Object { -not $_.CommandLine })
    if ($unreadable.Count -gt 0) {
        Write-SupervisorLog ("WARN {0} python process(es) have unreadable command lines (pids: {1}); if one is an orphaned worker it cannot be identified or stopped from a non-elevated supervisor, and will race this one for job claims" -f `
            $unreadable.Count, (($unreadable | ForEach-Object { $_.ProcessId }) -join ","))
    }
    if ($orphans.Count -eq 0) {
        return
    }
    foreach ($orphan in $orphans) {
        Write-SupervisorLog ("killing orphaned worker from a previous supervisor pid={0}" -f $orphan.ProcessId)
        taskkill.exe /PID $orphan.ProcessId /T /F | Out-Null
    }
    # Give the backend a moment to time out their in-flight claims before we start a new
    # worker, so the fresh child does not immediately collide with jobs the orphan held.
    Start-Sleep -Seconds 3
}

# Pull target branch. `desktop_server` was deleted upstream after merge, which made
# every supervisor start log "git pull failed exit 128"; the worker still started from
# the local checkout but never fast-forwarded. `main` is the live branch now.
$PullBranch = "main"

function Update-RepoFastForward {
    Write-SupervisorLog "verifying $PullBranch checkout before worker start"
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # git writes routine progress info (e.g. "From https://...") to stderr; with
        # $ErrorActionPreference = "Stop" a 2>&1 redirect turns those harmless lines into
        # terminating errors before the exit-code check below ever runs. Relax it for the
        # native git calls only.
        $ErrorActionPreference = "Continue"
        $RepoDir = Split-Path $BackendDir -Parent
        $output = git -C $RepoDir fetch origin $PullBranch 2>&1
        foreach ($line in $output) { Write-SupervisorLog ("git: {0}" -f $line) }
        if ($LASTEXITCODE -ne 0) { throw "git fetch failed with exit code $LASTEXITCODE" }

        $currentBranch = git -C $RepoDir rev-parse --abbrev-ref HEAD
        if ($currentBranch -ne $PullBranch) {
            $stayedClean = -not (git -C $RepoDir status --porcelain)
            if (-not $stayedClean) {
                Write-SupervisorLog ("working tree dirty; staying on '{0}' instead of switching to '{1}'" -f $currentBranch, $PullBranch)
                return
            }
            $output = git -C $RepoDir checkout $PullBranch 2>&1
            foreach ($line in $output) { Write-SupervisorLog ("git: {0}" -f $line) }
            if ($LASTEXITCODE -ne 0) { throw "git checkout failed with exit code $LASTEXITCODE" }
        }

        $output = git -C $RepoDir pull --ff-only origin $PullBranch 2>&1
        foreach ($line in $output) { Write-SupervisorLog ("git: {0}" -f $line) }
        if ($LASTEXITCODE -ne 0) {
            throw "git pull --ff-only failed with exit code $LASTEXITCODE"
        }
    } catch {
        Write-SupervisorLog ("git pull failed: {0}" -f $_.Exception.Message)
        throw
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

# DO NOT hand raw Get-Content output to ConvertTo-Json — that was the BSOD.
#
# In Windows PowerShell 5.1 every string Get-Content returns is wrapped in a PSObject
# carrying ETS note properties: PSPath, PSParentPath, PSChildName, ReadCount, and
# critically PSDrive (PSDriveInfo) and PSProvider (ProviderInfo). Those last two are
# rich objects whose own properties point back into the provider graph, so
# ConvertTo-Json -Depth 8 walks that graph once per log line and never returns.
#
# Measured 2026-08-03 on the same 5 lines of text, sole difference the decoration:
#   [string]-cast  -> 51 ms, 528 JSON chars
#   raw Get-Content -> never returned (killed at 45s), ~9 MB/s unbounded growth
# With $LogTailLines = 80 in production that is the 6-10GB MEMORY_MANAGEMENT (0x1A)
# BSOD, confirmed experimentally rather than theorised. It also explains why
# TimeoutSec never helped: the stall is in ConvertTo-Json, before Invoke-RestMethod
# is ever reached.
#
# The per-element [string] cast below is what strips the decoration. Keep it.
function Get-LogTail {
    $lines = @()
    if (Test-Path $SupervisorLog) {
        $lines += "--- supervisor ---"
        $lines += Get-Content $SupervisorLog -Tail ([Math]::Min(20, $LogTailLines)) -ErrorAction SilentlyContinue
    }
    if (Test-Path $WorkerLog) {
        $lines += "--- worker ---"
        $lines += Get-Content $WorkerLog -Tail $LogTailLines -ErrorAction SilentlyContinue
    }
    # The line cap is a second guard: the python child's stderr has been observed
    # emitting single lines padded with thousands of characters (a \r-based progress
    # indicator degrading when stdout is redirected to a file), and an unbounded line
    # would bloat the request body even once the ETS problem is gone.
    return [string[]]@(
        $lines |
            Select-Object -Last $LogTailLines |
            ForEach-Object {
                $text = [string]$_
                if ($text.Length -gt 2000) { $text.Substring(0, 2000) + "...[truncated]" } else { $text }
            }
    )
}

function Get-ControlPath {
    if ($null -eq $script:LastSeenRestartToken) {
        return "/api/worker/control"
    }
    $token = [uri]::EscapeDataString([string]$script:LastSeenRestartToken)
    return "/api/worker/control?last_seen_restart_token=$token"
}

function Report-Supervisor {
    $childStatus = "stopped"
    $childPid = $null
    if (Test-ChildRunning) {
        $childStatus = "running"
        $childPid = $script:Child.Id
    }
    $payload = @{
        supervisor_version = $SupervisorVersion
        supervisor_started_at = $SupervisorStartedAt
        backend_url = Get-BackendUrl
        poll_interval_seconds = $PollIntervalSeconds
        desired_state = $script:DesiredState
        child_status = $childStatus
        child_pid = $childPid
        child_started_at = $script:ChildStartedAt
        child_exit_code = $script:ChildExitCode
        last_restart_token_seen = $script:LastSeenRestartToken
        last_control_error = $script:LastControlError
        log_tail = @(Get-LogTail)
    }
    Invoke-WorkerApi -Method "POST" -Path "/api/worker/supervisor" -Body $payload | Out-Null
}

Load-DotEnv
Stop-OrphanWorkers
Update-RepoFastForward
$RepoDir = Split-Path $BackendDir -Parent
$branch = git -C $RepoDir branch --show-current
$sha = git -C $RepoDir rev-parse HEAD
Write-SupervisorLog ("worker supervisor verified interpreter={0} branch={1} sha={2}" -f $PythonExe, $branch, $sha)
Write-SupervisorLog "worker supervisor starting"

$script:LoopCount = 0
while ($true) {
    $script:LoopCount++
    # A quiet loop by default. The per-step DIAG breadcrumbs that found the ConvertTo-Json
    # stall wrote 5 lines per poll (~43k lines/day) into the same file Get-LogTail reads;
    # this periodic line keeps the memory trend observable at ~1/1000th the volume.
    if ($script:LoopCount % 30 -eq 1) {
        Write-SupervisorLog ("alive loop={0} mem={1}MB child={2}" -f `
            $script:LoopCount,
            [Math]::Round(([System.Diagnostics.Process]::GetCurrentProcess()).WorkingSet64 / 1MB, 1),
            $(if (Test-ChildRunning) { "running" } else { "stopped" }))
    }
    try {
        $control = Invoke-WorkerApi -Method "GET" -Path (Get-ControlPath)
        $script:LastControlError = $null
        if ($control.desired_state) {
            $script:DesiredState = [string]$control.desired_state
        }
        if ($control.should_restart -eq $true) {
            Write-SupervisorLog ("restart requested token={0}" -f $control.restart_token)
            Stop-WorkerChild
            Update-RepoFastForward
            $script:LastSeenRestartToken = $control.restart_token
            Start-WorkerChild
        } else {
            $script:LastSeenRestartToken = $control.restart_token
        }
    } catch {
        $script:LastControlError = $_.Exception.Message
        $script:DesiredState = "run"
        Write-SupervisorLog ("control poll failed; failing open to run: {0}" -f $script:LastControlError)
    }

    if (-not (Test-ChildRunning)) {
        Start-WorkerChild
    }

    try {
        Report-Supervisor
    } catch {
        Write-SupervisorLog ("supervisor report failed: {0}" -f $_.Exception.Message)
    }

    $currentWorkingSetMB = [Math]::Round(([System.Diagnostics.Process]::GetCurrentProcess()).WorkingSet64 / 1MB, 1)
    if ($currentWorkingSetMB -gt $MaxWorkingSetMB) {
        Write-SupervisorLog ("memory safety valve tripped: {0} MB > {1} MB limit; stopping child and exiting for a clean restart" -f $currentWorkingSetMB, $MaxWorkingSetMB)
        Stop-WorkerChild
        $InstanceMutex.ReleaseMutex() | Out-Null
        exit 1
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}
