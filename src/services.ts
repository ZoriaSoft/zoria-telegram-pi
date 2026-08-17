import { spawnSync } from "node:child_process";

interface SpawnOk {
  stdout: string;
}

/** supervisorctl çalıştırır; exit code'u yoksayar (status STOPPED servislerde 3 döner). */
function runSupervisorctl(args: string[]): SpawnOk {
  const res = spawnSync("supervisorctl", args, { encoding: "utf8", timeout: 30_000 });
  if (res.error) {
    throw new Error(`supervisorctl erişilemedi: ${res.error.message}`);
  }
  return { stdout: res.stdout ?? "" };
}

export interface ServiceInfo {
  name: string;
  state: string;
  detail: string;
}

const STATE_EMOJI: Record<string, string> = {
  RUNNING: "🟢",
  STARTING: "🟡",
  STOPPED: "🔴",
  EXITED: "🔴",
  FATAL: "⛔",
  BACKOFF: "🟠",
  UNKNOWN: "⚪",
};

/** supervisorctl status çıktısını ayrıştırır. */
function parseLine(line: string): ServiceInfo {
  const m = line.match(/^(\S+)\s+(\S+)\s*(.*)$/);
  if (!m) return { name: line.trim(), state: "?", detail: "" };
  return { name: m[1]!, state: m[2]!, detail: (m[3] ?? "").trim() };
}

export function listServices(confPath: string): ServiceInfo[] {
  const { stdout } = runSupervisorctl(["-c", confPath, "status"]);
  return stdout.split("\n").filter(Boolean).map(parseLine);
}

export function restartService(confPath: string, name: string): string {
  const { stdout } = runSupervisorctl(["-c", confPath, "restart", name]);
  return stdout.trim();
}

/** Servis satırı: 🟢 RUNNING · pid · uptime gibi. */
export function serviceLine(s: ServiceInfo): string {
  const emoji = STATE_EMOJI[s.state] ?? "⚪";
  const detail = s.detail ? ` · ${s.detail}` : "";
  return `${emoji} <code>${s.name}</code> · ${s.state}${detail}`;
}
