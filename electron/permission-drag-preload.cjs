// The drag guide's own window: it may start a drag of the app bundle, and nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("permissionDrag", {
  start: () => ipcRenderer.send("perm:drag-app"),
});
