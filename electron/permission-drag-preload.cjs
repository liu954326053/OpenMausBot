// The permission helper's own window: it may start a drag of the app bundle and ask for it in Finder, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("permissionDrag", {
  start: () => ipcRenderer.send("perm:drag-app"),
  reveal: () => ipcRenderer.send("perm:reveal-app"),
});
