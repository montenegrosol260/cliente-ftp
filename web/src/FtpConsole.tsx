import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type LogEntry } from "./api";

const QUICK = ["SYST", "STAT", "FEAT", "HELP", "PWD", "NOOP"];

/** Muestra en vivo el diálogo del canal de control (puerto 21) y permite enviar comandos a mano. */
export default function FtpConsole({ enabled }: { enabled: boolean }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [error, setError] = useState("");
  const lastId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { entries } = await api.log(lastId.current);
        if (entries.length && !stop) {
          lastId.current = entries[entries.length - 1].id;
          setLog((l) => [...l, ...entries].slice(-1000));
        }
      } catch {
        /* backend caído: reintenta en el próximo tick */
      }
    };
    tick();
    const t = setInterval(tick, 700);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const send = async (command: string) => {
    if (!command.trim()) return;
    setError("");
    setHistory((h) => [command, ...h].slice(0, 50));
    setHistIdx(-1);
    setCmd("");
    try {
      await api.raw(command);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(cmd);
  };

  return (
    <div className="console">
      <div className="console-head">
        <h2>Canal de control</h2>
        <button className="btn ghost small" onClick={() => setLog([])}>Limpiar</button>
      </div>
      <div className="console-log">
        {log.map((e) => (
          <div key={e.id} className={`line ${e.dir}`}>
            <span className="time">{e.time.slice(11, 19)}</span>
            <span className="arrow">{e.dir === "out" ? "→" : e.dir === "in" ? "←" : e.dir === "error" ? "✕" : "·"}</span>
            <span className="text">{e.text}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div className="quick">
        {QUICK.map((q) => (
          <button key={q} className="btn small" disabled={!enabled} onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form className="console-input" onSubmit={submit}>
        <span className="prompt">ftp&gt;</span>
        <input
          value={cmd}
          disabled={!enabled}
          placeholder={enabled ? "Comando FTP (ej. SIZE archivo.txt, MDTM, CWD /docs)" : "Conectate para enviar comandos"}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              const i = Math.min(histIdx + 1, history.length - 1);
              setHistIdx(i);
              setCmd(history[i]);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const i = histIdx - 1;
              setHistIdx(Math.max(i, -1));
              setCmd(i >= 0 ? history[i] : "");
            }
          }}
        />
      </form>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
