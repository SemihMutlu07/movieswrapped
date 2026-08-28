# External watchdog for the desktop worker.
#
# Why this exists as a separate process:
# start-worker-supervisor.ps1 has an in-loop memory ceiling, but that check can only run
# between iterations. During the 2026-08-02 runaway the supervisor was blocked *inside* a
# single ConvertTo-Json call, so it sailed past 1.7GB without the in-loop valve ever
# executing, and the machine bugchecked with MEMORY_MANAGEMENT (0x1A). A ceiling that
# lives in the same thread as the bug cannot save you from the bug.
#
# This script is deliberately single-shot: Task Scheduler runs it once a minute and it
# exits. It has no loop, so it has nowhere to leak, and nothing to get stuck in.
#
# It is a backstop, not the fix. The ConvertTo-Json cause is fixed at source in
# start-worker-supervisor.ps1 (see the comment above Get-LogTail). This is here for the
# *next* leak, whatever that turns out to be.

param(
    # Supervisor steady-state is ~75MB. 400MB matches the in-loop valve.
    [int]$MaxSupervisorMB = 400,
    # The worker legitimately allocates while scraping and enriching (measured ~106MB mid-job,
    # falling back to ~18MB when idle). This ceiling is deliberately far above normal so it
    # only ever catches genuine runaway, never healthy work.
    [int]$MaxWorkerMB = 2000,
    [string]$LogPath = (Join-Path $PSScriptRoot "worker-watchdog.log")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-WatchdogLog {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Message
    try {
        if ((Test-Path $LogPath) -and ((Get-Item $LogPath -Force).Length -gt 512KB)) {
            Move-Item -Path $LogPath -Destination "$LogPath.1" -Force -ErrorAction SilentlyContinue
        }
        Add-Content -Path $LogPath -Value $line
    } catch {
        # Never let logging failure stop the watchdog from doing its actual job.
    }
    Write-Host $line
}

# Returns processes matching a command-line marker. A process whose command line cannot be
# read (more privileged than us) is skipped rather than guessed at — this script kills
# things, so it must only ever act on a positive identification.
function Get-MatchingProcesses {
    param([string]$Name, [string]$Marker)
    try {
        return @(Get-CimInstance Win32_Process -Filter "Name='$Name'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Marker) })
    } catch {
        Write-WatchdogLog ("process scan failed for {0}: {1}" -f $Name, $_.Exception.Message)
        return @()
    }
}

function Test-Ceiling {
    param([object[]]$Processes, [int]$CeilingMB, [string]$Label)
    $killed = 0
    foreach ($proc in $Processes) {
        $live = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $live) { continue }
        $mb = [Math]::Round($live.WorkingSet64 / 1MB, 1)
        if ($mb -gt $CeilingMB) {
            Write-WatchdogLog ("KILL {0} pid={1} workingSet={2}MB exceeds {3}MB ceiling" -f $Label, $proc.ProcessId, $mb, $CeilingMB)
            # /T so the supervisor's python child goes with it; Task Scheduler's
            # RestartCount/RestartInterval brings the supervisor back within a minute,
            # and the supervisor starts a fresh worker.
            taskkill.exe /PID $proc.ProcessId /T /F | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $killed++
            } else {
                Write-WatchdogLog ("taskkill FAILED pid={0} exit={1}; not counted as killed" -f $proc.ProcessId, $LASTEXITCODE)
            }
        } elseif ($mb -gt ($CeilingMB * 0.5)) {
            # Early warning, so a slow leak leaves a trail before it ever trips the ceiling.
            Write-WatchdogLog ("WARN {0} pid={1} workingSet={2}MB is over half the {3}MB ceiling" -f $Label, $proc.ProcessId, $mb, $CeilingMB)
        }
    }
    return $killed
}

# A watchdog that silently protects nothing is worse than no watchdog, because it buys
# false confidence. This is the exact way that happens here: process identification reads
# Win32_Process.CommandLine, and a non-elevated query gets $null for the command line of a
# more privileged process. The supervisor is registered with -RunLevel Highest, so a
# watchdog scheduled *without* "Run with highest privileges" sees a supervisor it cannot
# identify, skips it by the fail-safe rule, and reports nothing wrong forever.
# Detect and shout about that condition rather than failing closed and quiet.
function Test-CanSeeCommandLines {
    try {
        $candidates = @(Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction Stop)
        if ($candidates.Count -eq 0) { return }
        $blind = @($candidates | Where-Object { -not $_.CommandLine })
        if ($blind.Count -gt 0) {
            Write-WatchdogLog ("WARN cannot read the command line of {0}/{1} candidate process(es) (pids: {2}). This watchdog is probably not running elevated, and cannot police an elevated supervisor. Re-register its scheduled task with -RunLevel Highest." -f `
                $blind.Count, $candidates.Count, (($blind | Select-Object -First 5 | ForEach-Object { $_.ProcessId }) -join ","))
        }
    } catch {
        Write-WatchdogLog ("WARN privilege self-check failed: {0}" -f $_.Exception.Message)
    }
}

Test-CanSeeCommandLines

# The @() around each call is load-bearing: PowerShell unwraps a single-element array on
# return from a function, so with exactly one supervisor running $supervisors would be a
# bare CimInstance and "+=" would throw op_Addition — killing the watchdog before it ever
# checked a ceiling. Caught by the kill-path test, which is why that test exists.
$supervisors = @(Get-MatchingProcesses -Name "powershell.exe" -Marker "start-worker-supervisor.ps1") +
               @(Get-MatchingProcesses -Name "pwsh.exe" -Marker "start-worker-supervisor.ps1")
$workers = @(Get-MatchingProcesses -Name "python.exe" -Marker "app.worker.desktop_scrape_worker")

$killed = 0
$killed += Test-Ceiling -Processes $supervisors -CeilingMB $MaxSupervisorMB -Label "supervisor"
$killed += Test-Ceiling -Processes $workers -CeilingMB $MaxWorkerMB -Label "worker"

# Report only when something is worth reading. A watchdog that logs a line a minute
# buries the one line that matters.
if ($killed -gt 0) {
    Write-WatchdogLog ("watchdog killed {0} process(es)" -f $killed)
}

exit 0
