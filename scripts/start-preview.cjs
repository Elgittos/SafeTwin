const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const stopExistingPreview = () => {
  if (process.platform !== 'win32') {
    return;
  }

  const escapedRoot = root.replaceAll("'", "''");
  const command = `
$currentPid = ${process.pid}
Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $currentPid -and
    $_.Name -match '^(node|electron|SafeTwin)\\.exe$' -and
    $_.CommandLine -like '*${escapedRoot}*'
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
`;

  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true,
  });
};

stopExistingPreview();

if (process.platform === 'win32') {
  const escapedRoot = root.replaceAll("'", "''");
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev') -WorkingDirectory '${escapedRoot}' -WindowStyle Hidden`,
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
} else {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
}

console.log('SafeTwin preview started.');
