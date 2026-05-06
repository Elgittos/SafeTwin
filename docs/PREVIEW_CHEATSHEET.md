cd C:\Users\LuisDev\Desktop\SafeTwin
npm.cmd start
npm.cmd run smoke:setup
npm.cmd run package
.\out\SafeTwin-win32-x64\SafeTwin.exe
npm.cmd run make
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
