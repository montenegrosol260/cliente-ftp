import { useState, type FormEvent } from "react";
import { api } from "./api";

interface Props {
  onConnected: (s: { host: string; user: string; pwd: string }) => void;
}

export default function ConnectForm({ onConnected }: Props) {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(21);
  const [user, setUser] = useState("demo");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.connect({
        host,
        port,
        user: anonymous ? "anonymous" : user,
        password: anonymous ? "anonymous@" : password,
        secure,
      });
      onConnected(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="connect" onSubmit={submit}>
      <h2>Conectarse a un servidor</h2>
      <div className="row">
        <label className="grow">
          Servidor
          <input value={host} onChange={(e) => setHost(e.target.value)} required />
        </label>
        <label className="port">
          Puerto
          <input type="number" value={port} min={1} max={65535} onChange={(e) => setPort(Number(e.target.value))} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        Acceso anónimo
      </label>
      {!anonymous && (
        <div className="row">
          <label className="grow">
            Usuario
            <input value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label className="grow">
            Contraseña
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
        Usar FTPS (AUTH TLS)
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>
        {busy ? "Conectando..." : "Conectar"}
      </button>
    </form>
  );
}
