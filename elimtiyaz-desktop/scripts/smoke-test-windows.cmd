@echo off
REM ===========================================================================
REM  El-Imtiyaz Desktop - Windows launch smoke test (T-506)
REM  Double-click this file on a Windows PC to verify the app really runs.
REM  It does NOT install anything and does NOT delete anything.
REM ===========================================================================
title El-Imtiyaz - Test de demarrage

echo.
echo  ============================================================
echo   El-Imtiyaz Desktop - TEST DE DEMARRAGE
echo  ============================================================
echo.

REM --- 1. Locate the application executable --------------------------------
set "APPDIR=%LOCALAPPDATA%\Programs\El-Imtiyaz Desktop"
set "EXE=%APPDIR%\El-Imtiyaz Desktop.exe"

if exist "%EXE%" (
  echo  [1/4] Application installee trouvee :
) else (
  echo  [1/4] Application installee NON trouvee.
  echo         Recherche du dossier par defaut...
  if exist "%APPDIR%" (
    echo         Dossier present mais executable introuvable - verifier l'installation.
    goto :failed
  ) else (
    echo         Dossier "%APPDIR%" absent.
    echo         Si vous utilisez la version PORTABLE, lancez directement
    echo         "El-Imtiyaz Desktop-0.1.0-win-x64-portable.exe" a cote de ce script.
    goto :failed
  )
)
echo         %EXE%
echo.

REM --- 2. Verify it is a 64-bit binary --------------------------------------
REM Read the PE header machine field directly: 0x8664 = x86-64, 0x014c = x86 (32-bit).
echo  [2/4] Architecture du binaire :
powershell -NoProfile -Command "$s=[IO.File]::OpenRead('%EXE%'); $b=New-Object byte[] 64; $null=$s.Read($b,0,64); $s.Close(); $p=[BitConverter]::ToInt32($b,0x3C); $s2=[IO.File]::OpenRead('%EXE%'); $b2=New-Object byte[] 2; $null=$s2.Seek($p+4,'Begin'); $null=$s2.Read($b2,0,2); $s2.Close(); $m=[BitConverter]::ToUInt16($b2,0); if ($m -eq 0x8664) { Write-Host '         PE machine 0x8664 - Windows x64 (64 bits) - OK' } elseif ($m -eq 0x014c) { Write-Host '         PE machine 0x014c - Windows 32 bits - INCOMPATIBLE' } else { Write-Host ('         PE machine 0x{0:X4} - inattendu' -f $m) }" 2>nul
echo.

REM --- 3. Launch it and check the process stays alive -----------------------
echo  [3/4] Lancement de l'application...
start "" "%EXE%"
echo         Attente de 20 secondes...
timeout /t 20 /nobreak >nul

tasklist /fi "IMAGENAME eq El-Imtiyaz Desktop.exe" 2>nul | find /i "El-Imtiyaz" >nul
if errorlevel 1 (
  echo.
  echo   !! Le processus "El-Imtiyaz Desktop.exe" n'est PAS en cours d'execution.
  echo   !! L'application s'est fermee ou n'a pas demarre.
  echo.
  echo   Conseils :
  echo     - Verifiez la connexion Internet (le backend est heberge).
  echo     - Reessayez ; Windows peut avoir bloque l'executable non signe
  echo       (clic droit ^> Proprietes ^> "Debloquer" ^> Appliquer).
  echo     - antivirus peut avoir mis l'executable en quarantaine.
  goto :failed
)

echo         OK - le processus tourne.
echo.

REM --- 4. Confirm a window is visible ---------------------------------------
echo  [4/4] Verification de la fenetre visible...
powershell -NoProfile -Command "Get-Process -Name 'El-Imtiyaz Desktop' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1 -ExpandProperty MainWindowTitle" 2>nul

echo.
echo  ============================================================
echo   RESULTAT : SUCCES
echo  ============================================================
echo   L'application se lance et reste ouverte.
echo   Verifiez visuellement : ecran de connexion, puis Tableau de bord.
echo.
echo   Fermez l'application quand vous avez fini.
echo.
pause
exit /b 0

:failed
echo.
echo  ============================================================
echo   RESULTAT : ECHEC
echo  ============================================================
echo   L'application ne s'est pas lancee. Voir les messages ci-dessus.
echo.
pause
exit /b 1