import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { api, formatSize, join, type Entry } from "./api";

interface Props {
  initialPath: string;
  onLost: () => void;
}

export default function FileBrowser({ initialPath, onLost }: Props) {
  const [pwd, setPwd] = useState(initialPath);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      setError("");
      try {
        await fn();
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("No hay conexión FTP activa")) onLost();
        setError(msg);
      } finally {
        setBusy("");
      }
    },
    [onLost],
  );

  const load = useCallback(
    (path?: string) =>
      handle("Listando...", async () => {
        const r = await api.list(path);
        setPwd(r.pwd);
        setEntries(r.entries);
        setFilter("");
      }),
    [handle],
  );

  useEffect(() => {
    load(initialPath || undefined);
  }, [load, initialPath]);

  const parent = pwd === "/" ? null : pwd.replace(/\/[^/]+\/?$/, "") || "/";
  const crumbs = pwd.split("/").filter(Boolean);

  const open = (e: Entry) => {
    if (e.type === "dir" || e.type === "link") load(join(pwd, e.name));
  };

  const mkdir = () => {
    const name = prompt("Nombre de la nueva carpeta:");
    if (name) handle("Creando carpeta...", async () => {
      await api.mkdir(join(pwd, name));
      await load(pwd);
    });
  };

  const rename = (e: Entry) => {
    const name = prompt("Nuevo nombre:", e.name);
    if (name && name !== e.name) handle("Renombrando...", async () => {
      await api.rename(join(pwd, e.name), join(pwd, name));
      await load(pwd);
    });
  };

  const remove = (e: Entry) => {
    const what = e.type === "dir" ? `la carpeta "${e.name}" y todo su contenido` : `"${e.name}"`;
    if (confirm(`¿Eliminar ${what}?`)) handle("Eliminando...", async () => {
      const path = join(pwd, e.name);
      await (e.type === "dir" ? api.removeDir(path) : api.removeFile(path));
      await load(pwd);
    });
  };

  const upload = (files: File[]) => {
    if (files.length) handle(`Subiendo ${files.length} archivo(s)...`, async () => {
      await api.upload(pwd, files);
      await load(pwd);
    });
  };

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setDragging(false);
    upload(Array.from(ev.dataTransfer.files));
  };

  const visible = entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div
      className={`browser ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="toolbar">
        <button className="btn" disabled={!parent || !!busy} onClick={() => parent && load(parent)} title="CDUP">
          ↑ Subir nivel
        </button>
        <button className="btn" disabled={!!busy} onClick={() => load(pwd)} title="LIST">
          ⟳ Actualizar
        </button>
        <button className="btn" disabled={!!busy} onClick={mkdir} title="MKD">
          + Carpeta
        </button>
        <button className="btn primary" disabled={!!busy} onClick={() => fileInput.current?.click()} title="STOR">
          ⇪ Subir archivos
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <input className="filter" placeholder="Filtrar..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <nav className="crumbs">
        <button onClick={() => load("/")}>/</button>
        {crumbs.map((c, i) => (
          <span key={i}>
            <button onClick={() => load("/" + crumbs.slice(0, i + 1).join("/"))}>{c}</button>
            {i < crumbs.length - 1 && <span className="sep">/</span>}
          </span>
        ))}
        {busy && <span className="busy">{busy}</span>}
      </nav>

      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table className="files">
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="num">Tamaño</th>
              <th>Modificado</th>
              <th>Permisos</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.name} onDoubleClick={() => open(e)}>
                <td>
                  <div className="name">
                    <span className="icon">{e.type === "dir" ? "📁" : e.type === "link" ? "🔗" : "📄"}</span>
                    {e.type === "file" ? e.name : <button className="link" onClick={() => open(e)}>{e.name}</button>}
                  </div>
                </td>
                <td className="num">{e.type === "file" ? formatSize(e.size) : ""}</td>
                <td>{e.modified ? formatDate(e.modified) : ""}</td>
                <td className="mono">{e.permissions ?? ""}</td>
                <td className="actions">
                  {e.type === "file" && (
                    <a className="btn small" href={api.downloadUrl(join(pwd, e.name))} title="RETR">
                      Bajar
                    </a>
                  )}
                  <button className="btn small" onClick={() => rename(e)} title="RNFR / RNTO">Renombrar</button>
                  <button className="btn small danger" onClick={() => remove(e)} title={e.type === "dir" ? "RMD" : "DELE"}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
            {!visible.length && !busy && (
              <tr>
                <td colSpan={5} className="empty">
                  {entries.length ? "Ningún archivo coincide con el filtro" : "Carpeta vacía. Arrastrá archivos acá para subirlos."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {dragging && <div className="drop-hint">Soltá los archivos para subirlos a {pwd}</div>}
    </div>
  );
}

function formatDate(v: string) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}
