@echo off
:: 食堂记录同步服务器 - 开机自启动脚本
:: 由 Windows 计划任务在用户登录时调用
cd /d "D:\trae\work\6a85a8c7728c7ab17b749665"
node sync-server.js
