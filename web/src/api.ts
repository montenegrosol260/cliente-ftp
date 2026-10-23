export interface Entry {
  name: string;
  type: "dir" | "file" | "link";
  size: number;
  modified: string | null;
  permissions: string | null;
}

export interface LogEntry {
  id: number;
  time: string;
  dir: "out" | "in" | "info" | "error";
  text: string;
}

export interface ConnectParams {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error HTTP ${res.status}`);
  return data as T;
}

const q = (path: string) => encodeURIComponent(path);

export const api = {
  status: () => call<{ connected: boolean; host: string; user: string }>("GET", "/api/status"),
  connect: (p: ConnectParams) => call<{ pwd: string; host: string; user: string }>("POST", "/api/connect", p),
  disconnect: () => call("POST", "/api/disconnect"),
  list: (path?: string) =>
    call<{ pwd: string; entries: Entry[] }>("GET", `/api/list${path ? `?path=${q(path)}` : ""}`),
  mkdir: (path: string) => call("POST", "/api/mkdir", { path }),
  removeFile: (path: string) => call("DELETE", `/api/file?path=${q(path)}`),
  removeDir: (path: string) => call("DELETE", `/api/dir?path=${q(path)}`),
  rename: (from: string, to: string) => call("POST", "/api/rename", { from, to }),
  upload: (dir: string, files: File[]) => {
    const fd = new FormData();
    fd.append("dir", dir);
    files.forEach((f) => fd.append("files", f));
    return call("POST", "/api/upload", fd);
  },
  downloadUrl: (path: string) => `/api/download?path=${q(path)}`,
  raw: (command: string) => call<{ code: number; message: string }>("POST", "/api/raw", { command }),
  log: (since: number) => call<{ entries: LogEntry[] }>("GET", `/api/log?since=${since}`),
};

export const join = (dir: string, name: string) => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
