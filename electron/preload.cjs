// 给页面开放的几个桌面能力。页面里用 window.desktop 判断自己是不是跑在桌面程序里。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getAutoStart: () => ipcRenderer.invoke("autostart:get"),
  setAutoStart: (enabled) => ipcRenderer.invoke("autostart:set", enabled),
  showWindow: () => ipcRenderer.invoke("window:show"),
  openDataFolder: () => ipcRenderer.invoke("data:open"),
  getDataPath: () => ipcRenderer.invoke("data:path"),
});
