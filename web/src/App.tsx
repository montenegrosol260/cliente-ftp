import { useEffect, useState } from "react";
import { api } from "./api";
import ConnectForm from "./ConnectForm";
import FileBrowser from "./FileBrowser";
import FtpConsole from "./FtpConsole";

export default function App() {
  const [session, setSession] = useState<{ host: string; user: string; pwd: string } | null>(null);
  const [checking, setChecking] = useState(true);

  // Si el backend ya tiene una conexión abierta para esta cookie (ej. recargaste la página), la retomamos.
  useEffect(() => {
    api
      .status()
      .then((s) => s.connected && setSession({ host: s.host, user: s.user, pwd: "" }))
      .finally(() => setChecking(false));
  }, []);

  const disconnect = async () => {
    await api.disconnect().catch(() => undefined);
    setSession(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Cliente FTP</h1>
        {session && (
          <div className="session-info">
            <span className="dot" /> {session.user}@{session.host}
            <button className="btn ghost" onClick={disconnect}>Desconectar</button>
          </div>
        )}
      </header>
      <main className="layout">
        <section className="panel main-panel">
          {checking ? null : session ? (
            <FileBrowser initialPath={session.pwd} onLost={() => setSession(null)} />
          ) : (
            <ConnectForm onConnected={setSession} />
          )}
        </section>
        <section className="panel console-panel">
          <FtpConsole enabled={!!session} />
        </section>
      </main>
    </div>
  );
}
