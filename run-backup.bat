@echo off
:: 食堂记录自动备份脚本
:: 由 Windows 计划任务每天 20:00 调用
cd /d "D:\trae\work\canteen-records"
node auto-backup.js >> "D:\trae\work\canteen-local-backups\backup-log.txt" 2>&1
