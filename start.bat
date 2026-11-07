@echo off
REM Double-click this to run the ErgonSite site locally.
REM It serves the pages AND the /api/contact endpoint on ports 3000 and
REM 8080. The enquiry form only works when the page comes from here — a
REM static file server (Live Server, http-server, python -m http.server)
REM will serve the HTML but answer the form POST with 405.
cd /d "%~dp0"

REM If something else already owns 8080, server.js skips that port and
REM the old :8080 URL keeps hitting the wrong server. Name the offender
REM here rather than leaving it a mystery. Reported, never killed — it
REM might be something that matters.
set "PID8080="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080 " ^| findstr "LISTENING"') do set "PID8080=%%p"

if defined PID8080 (
  echo.
  echo ============================================================
  echo  Port 8080 is already taken by PID %PID8080%:
  echo.
  tasklist /fi "pid eq %PID8080%" /nh
  echo.
  echo  Until that program is stopped, http://...:8080 will keep
  echo  serving the OLD static site and the enquiry form will fail
  echo  with 405. Stop it from whatever started it, or force it:
  echo.
  echo      taskkill /PID %PID8080% /F
  echo.
  echo  Then run this file again.
  echo ============================================================
  echo.
)

echo Starting ErgonSite ...
node server.js
echo.
echo The server has stopped. Press any key to close this window.
pause >nul
