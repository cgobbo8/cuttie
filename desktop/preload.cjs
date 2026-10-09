/**
 * What Cuttie's pages can ask the desktop shell (main.mjs): its version,
 * updates, the logs folder, and on the start screen, the setup progress.
 * Pages see it as `window.cuttieDesktop` (absent in a plain browser).
 */

const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel, callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("cuttieDesktop", {
  platform: process.platform,
  info: () => ipcRenderer.invoke("app:info"),
  openLogs: () => ipcRenderer.invoke("app:open-logs"),
  repairPython: () => ipcRenderer.invoke("app:repair-python"),
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdate: (callback) => listen("update:event", callback),
  // Start screen
  onSetupStatus: (callback) => listen("setup:status", callback),
  retrySetup: () => ipcRenderer.invoke("setup:retry"),
  quit: () => ipcRenderer.invoke("app:quit"),
});
