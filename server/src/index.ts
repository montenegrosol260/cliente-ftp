import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { FileType, FTPError, type FileInfo } from "basic-ftp";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import { posix } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FtpSession, HttpError, sessionMiddleware } from "./session.js";

type Req = Request & { ftp: FtpSession };
type Handler = (req: Req, res: Response) => Promise<unknown>;

const app = express();
app.use(express.json());
app.use("/api", sessionMiddleware);

/** Envuelve un handler async y traduce errores FTP a respuestas HTTP. */
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req as Req, res).catch(next);

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v === "") throw new HttpError(400, `Falta el parámetro "${name}"`);
  return v;
};

function typeName(t: FileType) {
  return t === FileType.Directory ? "dir" : t === FileType.SymbolicLink ? "link" : "file";
}

function mapEntry(f: FileInfo) {
  return {
    name: f.name,
    type: typeName(f.type),
    size: f.size,
    modified: f.modifiedAt?.toISOString() ?? f.rawModifiedAt ?? null,
    permissions: f.permissions
      ? `${f.permissions.user}${f.permissions.group}${f.permissions.world}`
      : null,
  };
}

// ---------- Conexión ----------

app.post("/api/connect", h(async (req, res) => {
  const { host, port = 21, user = "anonymous", password = "", secure = false } = req.body ?? {};
  await req.ftp.connect({ host: str(host, "host"), port: Number(port), user, password, secure: !!secure });
  const pwd = await req.ftp.run((c) => c.pwd());
  res.json({ connected: true, host: req.ftp.host, user: req.ftp.user, pwd });
}));

app.post("/api/disconnect", h(async (req, res) => {
  if (req.ftp.client && !req.ftp.client.closed) {
    await req.ftp.run((c) => c.send("QUIT")).catch(() => undefined);
  }
  req.ftp.close();
  res.json({ connected: false });
}));

app.get("/api/status", h(async (req, res) => {
  const c = req.ftp.client;
  res.json({ connected: !!c && !c.closed, host: req.ftp.host, user: req.ftp.user });
}));

// ---------- Navegación ----------

// PWD
app.get("/api/pwd", h(async (req, res) => {
  res.json({ pwd: await req.ftp.run((c) => c.pwd()) });
}));

// CWD + LIST (o MLSD si el servidor lo soporta)
app.get("/api/list", h(async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : undefined;
  const result = await req.ftp.run(async (c) => {
    if (path) await c.cd(path);
    const pwd = await c.pwd();
    const list = await c.list();
    return { pwd, entries: list.map(mapEntry) };
  });
  result.entries.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
  );
  res.json(result);
}));

// CDUP
app.post("/api/cdup", h(async (req, res) => {
  const pwd = await req.ftp.run(async (c) => {
    await c.cdup();
    return c.pwd();
  });
  res.json({ pwd });
}));

// ---------- Operaciones sobre archivos ----------

// MKD
app.post("/api/mkdir", h(async (req, res) => {
  const path = str(req.body?.path, "path");
  await req.ftp.run((c) => c.send(`MKD ${path}`));
  res.json({ ok: true });
}));

// DELE
app.delete("/api/file", h(async (req, res) => {
  const path = str(req.query.path, "path");
  await req.ftp.run((c) => c.remove(path));
  res.json({ ok: true });
}));

// RMD (recursivo: borra el contenido y después el directorio)
app.delete("/api/dir", h(async (req, res) => {
  const path = str(req.query.path, "path");
  await req.ftp.run(async (c) => {
    const back = await c.pwd();
    await c.removeDir(path);
    await c.cd(back).catch(() => undefined);
  });
  res.json({ ok: true });
}));

// RNFR + RNTO
app.post("/api/rename", h(async (req, res) => {
  const from = str(req.body?.from, "from");
  const to = str(req.body?.to, "to");
  await req.ftp.run((c) => c.rename(from, to));
  res.json({ ok: true });
}));

// RETR: el archivo se transmite directo del servidor FTP al navegador.
app.get("/api/download", h(async (req, res) => {
  const path = str(req.query.path, "path");
  const name = posix.basename(path);
  await req.ftp.run(async (c) => {
    const size = await c.size(path).catch(() => undefined);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    if (size !== undefined) res.setHeader("Content-Length", String(size));
    const started = Date.now();
    await c.downloadTo(res, path);
    req.ftp.addLog("info", `Descarga completa: ${name} (${size ?? "?"} bytes en ${Date.now() - started} ms)`);
  });
}));

// STOR: los archivos llegan al backend por multipart y se suben al servidor FTP.
const upload = multer({ dest: tmpdir(), limits: { fileSize: 1024 * 1024 * 1024 } });
app.post("/api/upload", upload.array("files"), h(async (req, res) => {
  const dir = str(req.body?.dir, "dir");
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new HttpError(400, "No se recibieron archivos");
  try {
    for (const f of files) {
      const remote = posix.join(dir, f.originalname);
      await req.ftp.run(async (c) => {
        const started = Date.now();
        await c.uploadFrom(f.path, remote);
        req.ftp.addLog("info", `Subida completa: ${f.originalname} (${f.size} bytes en ${Date.now() - started} ms)`);
      });
    }
  } finally {
    await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
  }
  res.json({ ok: true, uploaded: files.map((f) => f.originalname) });
}));

// ---------- Comandos manuales (consola) ----------

// Comandos que necesitan conexión de datos: se usan desde los botones, no desde la consola.
const DATA_COMMANDS = new Set(["LIST", "NLST", "MLSD", "RETR", "STOR", "STOU", "APPE", "PASV", "EPSV", "PORT", "EPRT"]);

app.post("/api/raw", h(async (req, res) => {
  const command = str(req.body?.command, "command").trim();
  const verb = command.split(/\s+/)[0].toUpperCase();
  if (DATA_COMMANDS.has(verb)) {
    throw new HttpError(400, `${verb} usa un canal de datos: usá los botones de la interfaz (listar, subir, bajar)`);
  }
  if (verb === "QUIT") throw new HttpError(400, "Para cerrar la sesión usá el botón Desconectar");
  const r = await req.ftp.run((c) => c.sendIgnoringError(command));
  res.json({ code: r.code, message: r.message });
}));

// ---------- Log del canal de control ----------

app.get("/api/log", h(async (req, res) => {
  const since = Number(req.query.since ?? 0);
  res.json({ entries: req.ftp.log.filter((e) => e.id > since) });
}));

// ---------- Errores ----------

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const session = (req as Partial<Req>).ftp;
  let status = 500;
  let message = err instanceof Error ? err.message : String(err);
  if (err instanceof HttpError) status = err.status;
  else if (err instanceof FTPError) {
    status = 502;
    message = `El servidor FTP respondió ${err.code}: ${err.message}`;
  } else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Timeout/i.test(message)) {
    status = 504;
  }
  session?.addLog("error", message);
  if (session?.client?.closed) session.close();
  if (res.headersSent) return res.end();
  res.status(status).json({ error: message });
});

// En producción el mismo servidor sirve el frontend compilado.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile("index.html", { root: webDist }));
}

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`Cliente FTP escuchando en http://localhost:${PORT}`));
