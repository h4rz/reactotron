import childProcess from "child_process"

/**
 * Kill serve-sim processes left behind by a previous Reactotron run.
 *
 * serve-sim has no parent-death detection of its own: it handles SIGTERM and
 * friends, but nothing tells it to exit when Reactotron goes away without
 * sending a signal. A crash, a force quit, or `kill -9` therefore strands the
 * preview server, which launchd reparents to PID 1 and nothing ever reaps.
 * Stranded servers hold their ports and have been observed spinning at most of
 * a core each, so several of them accumulate into real CPU cost for the user.
 *
 * Reactotron cannot fix the child from the outside, so it sweeps on launch
 * instead. Only orphans are eligible: a process whose parent is still alive
 * belongs to another running Reactotron and is left untouched.
 */

// Matches how startServeSim launches the CLI: Electron re-invoked as Node with
// the bundled serve-sim entry point as its script argument.
const SERVE_SIM_COMMAND = /node_modules\/(?:@expo\/)?serve-sim\/dist\/serve-sim\.js/

type ProcessEntry = { pid: number; ppid: number }

function listServeSimProcesses(): ProcessEntry[] {
  // `ps -eo pid=,ppid=,args=` is available on macOS and Linux; Reactotron only
  // spawns serve-sim on macOS, but the sweep is harmless elsewhere.
  const output = childProcess.execFileSync("ps", ["-eo", "pid=,ppid=,args="], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })

  return output
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      if (!match || !SERVE_SIM_COMMAND.test(match[3])) return null
      return { pid: Number(match[1]), ppid: Number(match[2]) }
    })
    .filter((entry): entry is ProcessEntry => entry !== null)
}

export function killOrphanedServeSimProcesses(): void {
  let processes: ProcessEntry[]

  try {
    processes = listServeSimProcesses()
  } catch (error) {
    // A failed sweep must never stop the app from starting.
    console.log("[Reactotron Desktop] Could not scan for stale serve-sim processes.", error)
    return
  }

  for (const { pid, ppid } of processes) {
    // Anything still owned by a live parent belongs to another Reactotron.
    if (ppid !== 1 || pid === process.pid) continue

    try {
      // These are known to ignore or outlive SIGTERM, so do not negotiate.
      process.kill(pid, "SIGKILL")
      console.log(`[Reactotron Desktop] Killed stale serve-sim process ${pid}.`)
    } catch {
      // Already gone, or owned by another user. Neither is actionable.
    }
  }
}
