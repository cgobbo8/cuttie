/**
 * Cuttie's desktop shell: a start screen, the Python environment set up on
 * first launch (and again when its dependencies change), then the local stack
 * (API + worker, scripts/launcher.mjs) in a window, and updates from GitHub
 * Releases on request (Settings > Application).
 *
 * Packaged: the app files are in resources/app (api build, frontend/dist,
 * backend, scripts) with uv, node and ffmpeg in resources/bin (see
 * scripts/stage.mjs). In development (`npm run dev` here) it runs the repo as
 * is: api/build and frontend/dist must exist (`npm start` at the root builds them).
 *
 * `--smoke-test[=full] --smoke-report=<file>`: no window; sets up Python, starts
 * the stack, checks the API, the worker and its tools (full: also the GPU and
 * Whisper), writes a JSON report and exits 0 or 1 (CI, scripts/smoke-test.ps1).
 */

import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import electronUpdater from "electron-updater";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { autoUpdater } = electronUpdater;
const here = path.dirname(fileURLToPath(import.meta.url));
const packaged = app.isPackaged;
const isWindows = process.platform === "win32";
const exe = (name) => (isWindows ? `${name}.exe` : name);
const APP_ID = "app.cuttie.desktop";

const smokeArg = process.argv.find((a) => a.startsWith("--smoke-test"));
const reportArg = process.argv.find((a) => a.startsWith("--smoke-report="));
const smoke = smokeArg ? { full: smokeArg === "--smoke-test=full", report: reportArg ? reportArg.slice("--smoke-report=".length) : "smoke-report.json" } : null;

if (!smoke && !app.requestSingleInstanceLock()) app.exit(0);

/* ── Where things are ─────────────────────────────────────────────────────── */

const root = packaged ? path.join(process.resourcesPath, "app") : path.resolve(here, "..");
const bin = packaged ? path.join(process.resourcesPath, "bin") : null;
// Windows: %LOCALAPPDATA%\Cuttie (never roamed). Python and its modules (~5 GB with CUDA), projects and clips
const localDir = isWindows && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Cuttie") : app.getPath("userData");
const dataDir = packaged ? path.join(localDir, "data") : process.env.CUTTIE_DATA_DIR || path.join(root, ".data");
const venvDir = path.join(localDir, "python-env");
const logDir = path.join(dataDir, "logs");

mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, "cuttie.log");
try {
  if (statSync(logFile).size > 5_000_000) renameSync(logFile, path.join(logDir, "cuttie.old.log"));
} catch {}
const logStream = createWriteStream(logFile, { flags: "a" });
logStream.on("error", () => {});
const log = (name, line) => {
  const text = `${new Date().toISOString()} [${name}] ${line}\n`;
  logStream.write(text);
  if (!packaged || smoke) process.stdout.write(text);
};

/* ── Words (the start screen comes before the app and its translations) ───── */

const WORDS = {
  fr: {
    installing: "Installation des modules d'analyse",
    once: "Une seule fois : quelques minutes, plusieurs Go à télécharger.",
    downloading: (what, size) => `Téléchargement de ${what}${size ? ` (${size})` : ""}…`,
    python: "Téléchargement de Python…",
    unpacking: "Installation des modules…",
    starting: "Démarrage de Cuttie…",
    failed: "Cuttie n'a pas pu démarrer",
    stopped: "Cuttie s'est arrêté",
    logsAt: "Journaux :",
    logs: "Ouvrir les journaux",
    retry: "Réessayer",
    restart: "Redémarrer Cuttie",
    quit: "Quitter",
    units: { GiB: "Go", MiB: "Mo", KiB: "Ko" },
    decimal: ",",
  },
  en: {
    installing: "Installing the analysis modules",
    once: "Only once: a few minutes, several GB to download.",
    downloading: (what, size) => `Downloading ${what}${size ? ` (${size})` : ""}…`,
    python: "Downloading Python…",
    unpacking: "Installing the modules…",
    starting: "Starting Cuttie…",
    failed: "Cuttie could not start",
    stopped: "Cuttie stopped",
    logsAt: "Logs:",
    logs: "Open the logs",
    retry: "Try again",
    restart: "Restart Cuttie",
    quit: "Quit",
    units: { GiB: "GB", MiB: "MB", KiB: "KB" },
    decimal: ".",
  },
  es: {
    installing: "Instalando los módulos de análisis",
    once: "Solo una vez: unos minutos, varios GB que descargar.",
    downloading: (what, size) => `Descargando ${what}${size ? ` (${size})` : ""}…`,
    python: "Descargando Python…",
    unpacking: "Instalando los módulos…",
    starting: "Iniciando Cuttie…",
    failed: "Cuttie no pudo iniciarse",
    stopped: "Cuttie se detuvo",
    logsAt: "Registros:",
    logs: "Abrir los registros",
    retry: "Reintentar",
    restart: "Reiniciar Cuttie",
    quit: "Salir",
    units: { GiB: "GB", MiB: "MB", KiB: "KB" },
    decimal: ",",
  },
};
let words = WORDS.fr;

/** A line of `uv sync` as something a streamer can read (null: keep the previous one). */
function uvStep(line) {
  const text = line.trim();
  if (/^Downloading cpython/i.test(text)) return words.python;
  const download = text.match(/^Downloading (\S+) \(([\d.]+)\s*(GiB|MiB|KiB)\)/);
  if (download) return words.downloading(download[1], `${download[2].replace(".", words.decimal)} ${words.units[download[3]]}`);
  if (/^(Prepared|Installed|Uninstalled|Built|Building)\b/.test(text)) return words.unpacking;
  return null;
}

/* ── Start screen ─────────────────────────────────────────────────────────── */

let splash = null;
let mainWindow = null;
let stack = null;
let appOrigin = null;
let quitting = false;
let launching = false;

function status(title, detail = "", error = false) {
  log("setup", `${title}${detail ? ` — ${detail}` : ""}`);
  splash?.webContents.send("setup:status", { title, detail, error, labels: { logs: words.logs, retry: words.retry, quit: words.quit } });
}

function showSplash() {
  if (splash) return Promise.resolve();
  splash = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: "#0b0b0c",
    title: "Cuttie",
    show: false,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  splash.on("closed", () => {
    splash = null;
    // Closed by hand (Alt+F4) before the app opened: nothing left to show
    if (!mainWindow && !quitting) app.quit();
  });
  return new Promise((resolve) => {
    splash.once("ready-to-show", () => {
      splash.show();
      resolve();
    });
    splash.loadFile(path.join(here, "setup.html"));
  });
}

/* ── Python environment (first launch, and when uv.lock changes) ──────────── */

function run(command, args, { env, onLine }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    const forward = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach(onLine);
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}`))));
  });
}

const lockMarker = path.join(venvDir, ".cuttie-lock");
const repairFlag = path.join(localDir, "repair-python");

async function ensurePython() {
  const lock = readFileSync(path.join(root, "backend", "uv.lock"));
  const hash = createHash("sha256").update(lock).digest("hex");
  const repair = existsSync(repairFlag);
  if (!repair && existsSync(lockMarker) && readFileSync(lockMarker, "utf-8") === hash) return;

  const once = existsSync(lockMarker) ? "" : words.once;
  status(words.installing, once);
  const args = ["sync", "--frozen", "--no-dev", "--project", path.join(root, "backend")];
  // Repair (Settings): reinstall every module from uv's cache, in case one got damaged
  if (repair) args.push("--reinstall");
  await run(path.join(bin, exe("uv")), args, {
    env: {
      ...process.env,
      UV_PROJECT_ENVIRONMENT: venvDir,
      // Python itself next to its modules, and never a Python already on this PC
      UV_PYTHON_INSTALL_DIR: path.join(localDir, "python"),
      UV_PYTHON_PREFERENCE: "only-managed",
      UV_NO_PROGRESS: "1",
    },
    onLine: (line) => {
      log("uv", line);
      const step = uvStep(line);
      if (step) splash?.webContents.send("setup:status", { title: words.installing, detail: [once, step].filter(Boolean).join("\n") });
    },
  });
  writeFileSync(lockMarker, hash);
  rmSync(repairFlag, { force: true });
}

/* ── The local stack ──────────────────────────────────────────────────────── */

async function startStack() {
  const { startCuttie } = await import(pathToFileURL(path.join(root, "scripts", "launcher.mjs")).href);
  if (!packaged) {
    return startCuttie({ root, dataDir, nodeBin: "node", onLog: log });
  }
  const python = path.join(venvDir, isWindows ? "Scripts" : "bin", exe("python"));
  return startCuttie({
    root,
    dataDir,
    // A plain Node (better-sqlite3 is built for it, not for Electron's)
    nodeBin: path.join(bin, exe("node")),
    workerCommand: [python, "worker.py"],
    // ffmpeg / ffprobe, and yt-dlp from the Python environment
    env: { PATH: [bin, path.dirname(python), process.env.PATH ?? ""].join(path.delimiter) },
    onLog: log,
  });
}

/** When the API or the worker stops on its own: say so, offer a restart. */
function watch(current) {
  current.exited.then(async (reason) => {
    if (quitting || stack !== current) return;
    log("app", `stopped: ${reason}`);
    for (;;) {
      const options = {
        type: "error",
        title: "Cuttie",
        message: words.stopped,
        detail: `${reason}\n\n${words.logsAt} ${logFile}`,
        buttons: [words.restart, words.logs, words.quit],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      };
      const { response } = await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
      if (response === 1) {
        await shell.openPath(logDir);
        continue;
      }
      if (response === 2) return app.quit();
      break;
    }
    await current.stop();
    await restartStack();
  });
}

async function restartStack() {
  try {
    stack = await startStack();
    appOrigin = new URL(stack.url).origin;
    watch(stack);
    mainWindow?.loadURL(stack.url);
  } catch (err) {
    log("app", `restart failed: ${err?.stack ?? err}`);
    dialog.showErrorBox(words.failed, `${err?.message ?? err}\n\n${words.logsAt} ${logFile}`);
    app.quit();
  }
}

function openMain(url) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(920, height),
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0b0c",
    title: "Cuttie",
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  // Links elsewhere (Twitch, OpenRouter...) open in the browser
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== appOrigin) {
      event.preventDefault();
      if (/^https?:/.test(target)) shell.openExternal(target);
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    splash?.destroy();
  });
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.loadURL(url);
}

async function launch() {
  if (launching) return;
  launching = true;
  try {
    await showSplash();
    if (packaged) await ensurePython();
    status(words.starting);
    stack = await startStack();
    appOrigin = new URL(stack.url).origin;
    watch(stack);
    openMain(stack.url);
  } catch (err) {
    log("app", `start failed: ${err?.stack ?? err}`);
    status(words.failed, `${err?.message ?? err}\n${words.logsAt} ${logFile}`, true);
  } finally {
    launching = false;
  }
}

/* ── Smoke test (CI) ──────────────────────────────────────────────────────── */

async function smokeTest() {
  const report = { version: app.getVersion(), platform: `${process.platform}-${process.arch}`, packaged, data_dir: dataDir, steps: {} };
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const value = await fn();
      report.steps[name] = { ok: true, seconds: (Date.now() - t0) / 1000, value: value ?? null };
      return value;
    } catch (err) {
      report.steps[name] = { ok: false, seconds: (Date.now() - t0) / 1000, error: String(err?.stack ?? err) };
      throw err;
    }
  };
  const get = async (pathname, init) => {
    const res = await fetch(stack.url + pathname, { ...init, signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  };
  let ok = false;
  try {
    if (packaged) await step("python", ensurePython);
    await step("start", async () => {
      stack = await startStack();
      return stack.url;
    });
    await step("app_info", () => get("/api/app/info"));
    await step("diagnostics", async () => {
      let diag = await get("/api/diagnostics");
      // Started but slow to answer (the launcher waits up to 3 min): a little more
      for (let i = 0; !diag.worker && i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        diag = await get("/api/diagnostics");
      }
      const worker = diag.worker;
      if (!worker) throw new Error(`worker unreachable: ${diag.worker_error}`);
      if (!worker.ffmpeg) throw new Error("ffmpeg not found by the worker");
      if (!worker.yt_dlp) throw new Error("yt-dlp not found by the worker");
      return diag;
    });
    if (smoke.full) {
      await step("local_test", async () => {
        const result = await get("/api/diagnostics/local-test", { method: "POST" });
        if (result.gpu?.error) throw new Error(`GPU check: ${result.gpu.error}`);
        if (result.whisper?.error) throw new Error(`Whisper: ${result.whisper.error}`);
        return result;
      });
    }
    ok = true;
  } catch (err) {
    report.error = String(err?.message ?? err);
  } finally {
    quitting = true;
    await stack?.stop().catch(() => {});
    report.ok = ok;
    writeFileSync(smoke.report, JSON.stringify(report, null, 2));
    log("smoke", `${ok ? "passed" : "FAILED"}: ${smoke.report}`);
    logStream.end(() => app.exit(ok ? 0 : 1));
  }
}

/* ── Updates (GitHub Releases) ────────────────────────────────────────────── */

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = { info: (m) => log("update", m), warn: (m) => log("update", m), error: (m) => log("update", m), debug: () => {} };
const sendUpdate = (event) => mainWindow?.webContents.send("update:event", event);
autoUpdater.on("download-progress", (p) => sendUpdate({ state: "downloading", percent: Math.round(p.percent) }));
autoUpdater.on("update-downloaded", (info) => sendUpdate({ state: "ready", version: info.version }));
// Failed checks and downloads reach the page through their own promises (update:check / update:download)
autoUpdater.on("error", (err) => log("update", `error: ${err?.message ?? err}`));

// Release notes come as HTML from GitHub: plain text only, in the page
const plainNotes = (notes) => {
  const text = (Array.isArray(notes) ? notes.map((n) => n.note).join("\n") : notes ?? "")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, 1200) : null;
};

ipcMain.handle("app:info", () => ({ version: app.getVersion(), packaged, dataDir, logDir }));
ipcMain.handle("app:open-logs", () => shell.openPath(logDir));
ipcMain.handle("app:quit", () => app.quit());
ipcMain.handle("app:repair-python", () => {
  if (!packaged) return false;
  writeFileSync(repairFlag, new Date().toISOString());
  app.relaunch();
  app.quit();
  return true;
});
ipcMain.handle("setup:retry", () => launch());
ipcMain.handle("update:check", async () => {
  if (!packaged) return { state: "dev", current: app.getVersion() };
  const result = await autoUpdater.checkForUpdates();
  const info = result?.updateInfo;
  return {
    state: result?.isUpdateAvailable ? "available" : "latest",
    current: app.getVersion(),
    version: info?.version ?? null,
    notes: plainNotes(info?.releaseNotes),
  };
});
ipcMain.handle("update:download", async () => {
  await autoUpdater.downloadUpdate();
  return true;
});
ipcMain.handle("update:install", async () => {
  // Stop the API and the worker first: the installer replaces their files
  quitting = true;
  await stack?.stop().catch(() => {});
  stack = null;
  // Silent install, then Cuttie starts again
  autoUpdater.quitAndInstall(true, true);
  // Still here after a while: the installer did not start, Cuttie carries on
  setTimeout(() => {
    log("update", "the installer did not start");
    quitting = false;
    sendUpdate({ state: "error", message: "The installer did not start" });
    restartStack();
  }, 20_000);
});

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

app.on("second-instance", () => {
  const win = mainWindow ?? splash;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("before-quit", (event) => {
  if (stack && !quitting) {
    event.preventDefault();
    quitting = true;
    // The page's live connection (SSE) would keep the API from closing: blank it first
    mainWindow?.hide();
    mainWindow?.webContents.loadURL("about:blank").catch(() => {});
    stack.stop().finally(() => app.quit());
  }
});
app.on("window-all-closed", () => {
  if (!smoke) app.quit();
});

if (isWindows) app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  words = WORDS[app.getLocale().slice(0, 2)] ?? WORDS.fr;
  log("app", `Cuttie ${app.getVersion()}${packaged ? "" : " (dev)"} — data ${dataDir}`);
  if (smoke) smokeTest();
  else launch();
});
