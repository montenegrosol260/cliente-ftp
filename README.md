# Cliente FTP web — TP N°7, punto 4

Redes de Información · UTN FRM

Es un cliente FTP con interfaz web. El backend en Node.js + TypeScript habla FTP con el servidor usando la librería `basic-ftp`, y el frontend en React muestra un explorador de archivos y una **consola en vivo del canal de control**. En esa consola se ve cada comando que el cliente envía (`USER`, `PASV`, `RETR`...) y cada respuesta del servidor (`230`, `226`...).

```
 Navegador (React)  ──HTTP──▶  Backend Node (Express + basic-ftp)  ──FTP──▶  Servidor FTP
                                  │ canal de control: puerto 21
                                  └ canal de datos: puerto pasivo (EPSV/PASV)
```

## Requisitos

- Node.js 18 o más nuevo
- Docker Desktop (opcional, para el servidor de prueba)

## Cómo levantarlo

```bash
npm run setup     # instala dependencias (raíz, server y web)
npm run ftp:up    # levanta el servidor FTP de prueba (usuario demo / demo123)
npm run dev       # backend en :3001 y frontend en http://localhost:5173
```

Abran http://localhost:5173 y conéctense a `localhost`, puerto `21`, usuario `demo`, contraseña `demo123`.

Para la exposición pueden compilar todo y servirlo desde un solo puerto:

```bash
npm run build && npm start   # http://localhost:3001
```

### Sin Docker

Cualquier servidor FTP sirve, por ejemplo FileZilla Server en Windows. Si no, con Python:

```bash
pip install pyftpdlib
python -m pyftpdlib -p 2121 -w -u demo -P demo123 -d carpeta_compartida
```

En ese caso conéctense al puerto `2121`.

## Funcionalidades

| Función en la interfaz | Comandos FTP que se envían |
|---|---|
| Conectar / login | `USER`, `PASS`, `FEAT`, `TYPE I`, `OPTS UTF8 ON` (con FTPS además `AUTH TLS`, `PBSZ`, `PROT`) |
| Listar carpeta | `CWD`, `PWD`, `EPSV`/`PASV` + `MLSD` (o `LIST`) |
| Subir nivel | `CDUP` |
| Crear carpeta | `MKD` |
| Subir archivos (botón o arrastrar y soltar) | `EPSV`/`PASV` + `STOR` |
| Bajar archivo | `SIZE`, `EPSV`/`PASV` + `RETR` |
| Renombrar | `RNFR` + `RNTO` |
| Eliminar archivo | `DELE` |
| Eliminar carpeta (con su contenido) | `DELE` de cada archivo + `RMD` |
| Desconectar | `QUIT` |
| Consola manual | `SYST`, `STAT`, `FEAT`, `HELP`, `NOOP`, `PWD`, `SIZE`, `MDTM`, `CWD`, etc. |

Otras características:

- Acceso anónimo y FTPS explícito (AUTH TLS).
- Las descargas pasan en streaming del servidor FTP al navegador, sin guardarse en el backend.
- Una sesión FTP por navegador (identificada con una cookie). Las operaciones de cada sesión se ejecutan en cola, porque una conexión FTP no admite dos transferencias a la vez.
- La consola tiene historial: con ↑ y ↓ se recorren los comandos ya enviados.

Desde la consola no se pueden mandar comandos que abren canal de datos (`LIST`, `RETR`, `STOR`, `PASV`...). Para eso están los botones, que se encargan de abrir la conexión de datos.

## Estructura

```
server/src/index.ts     API REST (una ruta por operación FTP) y manejo de errores
server/src/session.ts   sesión FTP por usuario, cola de operaciones y captura del log de control
web/src/ConnectForm.tsx formulario de conexión
web/src/FileBrowser.tsx explorador remoto (navegar, subir, bajar, renombrar, eliminar)
web/src/FtpConsole.tsx  consola del canal de control y comandos manuales
docker-compose.yml      servidor FTP de prueba (vsftpd)
```

## Para la exposición: qué mostrar

1. **Login**: en la consola se ve `220` (bienvenida), `USER` → `331`, `PASS` → `230`. La contraseña aparece enmascarada (`PASS ###`), pero viaja en texto plano. Con Wireshark sobre el puerto 21 se puede ver, y por eso existe FTPS.
2. **Dos canales**: al listar una carpeta, el cliente pide `EPSV`, el servidor responde `229 (|||puerto|)` y el listado llega por esa otra conexión. La respuesta `226 Transfer complete` vuelve por el canal de control.
3. **Modo pasivo vs. activo**: en pasivo (el que usamos) el cliente abre las dos conexiones, así que funciona detrás de NAT o firewall. En activo (`PORT`) es el servidor el que se conecta al cliente.
4. **Códigos de respuesta**: la primera cifra indica el resultado (1xx preliminar, 2xx éxito, 3xx falta información, 4xx error transitorio, 5xx error permanente). Prueben con `FOO` en la consola para ver un `500`, o borren un archivo que no existe para ver un `550`.
5. **Modo binario**: el cliente envía `TYPE I` al conectarse para que los archivos se transfieran byte por byte, sin convertir finales de línea.
