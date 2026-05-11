@echo off
set NODE_ENV=development
set NODE_OPTIONS=--max-old-space-size=1024
.\node_modules\.bin\tsx.cmd watch server/_core/index.ts
