import { Client } from "basic-ftp";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/** Una línea del diálogo de control FTP (comandos enviados y respuestas). */
export interface LogEntry {
  id: number;
  time: string;
  dir: "out" | "in" | "info" | "error";
  text: string;
}

/**
 * Cada navegador tiene su propia sesión con su propio Client de basic-ftp.
 * basic-ftp no admite dos operaciones simultáneas sobre la misma conexión,
 * por eso cada sesión tiene una cola (lock) que serializa las operaciones.
 */
export class FtpSession {
  client: Client | null = null;
  host = "";
  user = "";
  log: LogEntry[] = [];
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  lastUsed = Date.now();

  addLog(dir: LogEntry["dir"], text: string) {
    this.log.push({ id: this.nextId++, time: new Date().toISOString(), dir, text });
    if (this.log.length > 1000) this.log.splice(0, this.log.length - 1000);
  }

  /** Ejecuta una operación FTP en orden, nunca dos a la vez. */
  run<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    this.lastUsed = Date.now();
    const task = this.queue.then(() => {
      if (!this.client || this.client.closed) {
        throw new HttpError(409, "No hay conexión FTP activa");
      }
      return fn(this.client);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  async connect(opts: { host: string; port: number; user: string; password: string; secure: boolean }) {
    this.close();
    const client = new Client(30_000);
    client.ftp.verbose = true;
    // basic-ftp escribe por "log" cada comando ("> USER ...") y cada respuesta ("< 230 ...").
    // Lo interceptamos para mostrarlo en la consola de la interfaz.
    client.ftp.log = (msg: string) => {
      // Una respuesta multilínea (ej. FEAT) llega en un solo mensaje: todas sus líneas son "in".
      const dir: LogEntry["dir"] = msg.startsWith(">") ? "out" : msg.startsWith("<") ? "in" : "info";
      const body = dir === "info" ? msg : msg.slice(1);
      for (const line of body.split(/\r?\n/)) {
        if (line.trim()) this.addLog(dir, line.trim());
      }
    };
    this.addLog("info", `Conectando a ${opts.host}:${opts.port}${opts.secure ? " (FTPS explícito)" : ""}...`);
    await client.access({
      host: opts.host,
      port: opts.port,
      user: opts.user,
      password: opts.password,
      secure: opts.secure,
      secureOptions: opts.secure ? { rejectUnauthorized: false } : undefined,
    });
    this.client = client;
    this.host = opts.host;
    this.user = opts.user;
  }

  close() {
    if (this.client) {
      this.client.close();
      this.addLog("info", "Conexión cerrada");
    }
    this.client = null;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const sessions = new Map<string, FtpSession>();

/** Middleware: asigna una cookie "sid" y adjunta la sesión FTP al request. */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const cookie = req.headers.cookie ?? "";
  let sid = /(?:^|;\s*)sid=([\w-]+)/.exec(cookie)?.[1];
  if (!sid || !sessions.has(sid)) {
    sid = randomUUID();
    sessions.set(sid, new FtpSession());
    res.setHeader("Set-Cookie", `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  }
  (req as Request & { ftp: FtpSession }).ftp = sessions.get(sid)!;
  next();
}

// Cierra sesiones inactivas por más de 30 minutos.
setInterval(() => {
  const limit = Date.now() - 30 * 60_000;
  for (const [sid, s] of sessions) {
    if (s.lastUsed < limit) {
      s.close();
      sessions.delete(sid);
    }
  }
}, 60_000).unref();
