@echo off
rem 个人工作台：一次性安装。装依赖、生成图标、创建桌面和开始菜单快捷方式、开启开机自启。
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."
where node >nul 2>nul || (echo 需要先安装 Node.js 18 或以上版本。& pause & exit /b 1)
if not exist node_modules\electron\dist\electron.exe call npm install
rem GitHub 下载不下来时改用国内镜像；下载的文件仍按 npm 包里自带的校验值核对。
if not exist node_modules\electron\dist\electron.exe (
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  node node_modules\electron\install.js
)
if not exist node_modules\electron\dist\electron.exe (echo Electron 下载失败，请检查网络后重试。& pause & exit /b 1)
call npm run install-desktop
echo.
echo 完成。双击桌面上的“个人工作台”打开。
pause
