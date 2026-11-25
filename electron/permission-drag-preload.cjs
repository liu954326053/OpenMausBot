// The permission guide's own window: it may start a drag of the app bundle, reopen the privacy panes, and close itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("permissionDrag", {
  start: () => ipcRenderer.send("perm:drag-app"),
  openSettings: () => ipcRenderer.send("perm:open-panes"),
  reveal: () => ipcRenderer.send("perm:reveal-app"),
  close: () => ipcRenderer.send("perm:close-helper"),
});
