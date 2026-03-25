\# JSAVIOR Clean Deploy to gold4x.in



Use this to replace old site files/data with the new JSAVIOR frontend.



\## FTP Credentials and Targets



\- Primary host: `ftp://145.79.213.128`

\- Fallback host: `ftp://gold4x.in`

\- Username: `u165332974`



\## One-Command Clean Deploy (Windows PowerShell)



From `c:\\Users\\stndr\\gold4x`:



```powershell

.\\deploy.ps1 -Password "YOUR\_FTP\_PASSWORD"

```



The script will:



1\. Build static export (`out/`) using Next.js.

2\. Connect to FTP (IP first, then domain fallback).

3\. Remove previous files from remote `public\_html`.

4\. Upload fresh JSAVIOR site files.



\## Optional Parameters



```powershell

.\\deploy.ps1 -Password "YOUR\_FTP\_PASSWORD" -RemotePath /public\_html

.\\deploy.ps1 -Password "YOUR\_FTP\_PASSWORD" -SkipBuild

.\\deploy.ps1 -Password "YOUR\_FTP\_PASSWORD" -SkipCleanup

```



\## NPM Shortcut



```powershell

npm run deploy:ftp -- -Password "YOUR\_FTP\_PASSWORD"

```



