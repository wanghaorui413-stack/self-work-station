// 桌面程序入口（ADR 0003）：独立窗口 + 托盘常驻；数据接口在本进程里直接跑，不再需要单独的后台服务器。
//   electron .            正常启动
//   electron . --hidden   开机自启时用：只进托盘，不弹窗口
//   electron . --install  生成图标、创建桌面和开始菜单快捷方式、打开开机自启，然后退出

import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkbenchServer, dataDir } from "../scripts/serve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconPng = path.join(root, "build", "icon.png");
const iconIco = path.join(root, "build", "icon.ico");
const APP_ID = "SelfWorkStation";
const APP_NAME = "个人工作台";
// 固定端口，页面的来源（origin）不变，浏览器侧存的小状态（已弹过的提醒）才不会丢。
const PREFERRED_PORT = 37800;

const isInstall = process.argv.includes("--install");
const startHidden = process.argv.includes("--hidden");

let mainWindow = null;
let tray = null;
let baseUrl = null;
let quitting = false;

app.setAppUserModelId(APP_ID);
app.setName(APP_NAME);

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function startServer() {
  try {
    return await listen(createWorkbenchServer(), PREFERRED_PORT);
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    return listen(createWorkbenchServer(), 0);
  }
}

// 把 icon.svg 渲染成 256×256 的 PNG，再包成 ICO（ICO 可以直接内嵌 PNG）。
async function ensureIcons() {
  try {
    await fs.access(iconIco);
    return;
  } catch {
    // 还没生成过。
  }
  const svg = await fs.readFile(path.join(root, "icon.svg"), "utf8");
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace(
    "<svg ",
    '<svg width="256" height="256" ',
  )}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const png = (await win.webContents.capturePage()).resize({ width: 256, height: 256 }).toPNG();
  win.destroy();

  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  header.writeUInt8(0, 6); // width 256
  header.writeUInt8(0, 7); // height 256
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bpp
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await fs.mkdir(path.dirname(iconPng), { recursive: true });
  await fs.writeFile(iconPng, png);
  await fs.writeFile(iconIco, Buffer.concat([header, png]));
}

function loginItemOptions() {
  // 从项目文件夹直接运行：exe 是 electron.exe，要把项目路径作为参数带上。
  return { path: process.execPath, args: [app.getAppPath(), "--hidden"] };
}

function getAutoStart() {
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: Boolean(enabled) });
  return getAutoStart();
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: APP_NAME,
    icon: iconIco,
    backgroundColor: "#f4f1e9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(root, "electron", "preload.cjs"),
      contextIsolation: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadURL(`${baseUrl}/`);
  mainWindow.once("ready-to-show", () => {
    if (!startHidden) showWindow();
  });

  // 页面里的外部链接（会议、测评、原邮件）用系统浏览器打开。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // 关窗口只是缩到托盘，提醒照常弹。真正退出走托盘菜单。
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPng).resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开工作台", click: showWindow },
      { label: "打开数据文件夹", click: () => shell.openPath(dataDir) },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

async function install() {
  await ensureIcons();
  const target = process.execPath;
  const options = {
    target,
    args: `"${app.getAppPath()}"`,
    cwd: app.getAppPath(),
    icon: iconIco,
    iconIndex: 0,
    appUserModelId: APP_ID,
    description: "个人工作台",
  };
  const startMenu = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  const links = [
    path.join(app.getPath("desktop"), `${APP_NAME}.lnk`),
    // 开始菜单里的快捷方式带 AppUserModelID，Windows 通知才会显示成“个人工作台”。
    path.join(startMenu, `${APP_NAME}.lnk`),
  ];
  // "create" 会覆盖已有的同名快捷方式；"replace" 则要求文件已存在，第一次安装会失败。
  for (const link of links) {
    if (!shell.writeShortcutLink(link, "create", options)) throw new Error(`创建快捷方式失败：${link}`);
  }

  // 旧版（ADR 0001）的开机自启脚本：会单独起一个 node 服务器，现在不需要了。
  await fs.rm(path.join(startMenu, "Startup", "self-work-station.vbs"), { force: true });
  setAutoStart(true);
  console.log(`已创建快捷方式：\n${links.join("\n")}\n已开启开机自启。`);
}

ipcMain.handle("autostart:get", () => getAutoStart());
ipcMain.handle("autostart:set", (_event, enabled) => setAutoStart(enabled));
ipcMain.handle("window:show", () => showWindow());
ipcMain.handle("data:open", () => shell.openPath(dataDir));
ipcMain.handle("data:path", () => dataDir);

if (isInstall) {
  app.whenReady().then(async () => {
    try {
      await install();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
    app.quit();
  });
} else if (!app.requestSingleInstanceLock()) {
  // 已经开着一个了：把那个窗口叫出来。
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  // 窗口全关了也不退出，留在托盘。
  app.on("window-all-closed", () => {});

  app.whenReady().then(async () => {
    await ensureIcons();
    baseUrl = `http://127.0.0.1:${await startServer()}`;
    createWindow();
    createTray();
  });
}
