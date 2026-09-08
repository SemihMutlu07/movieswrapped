#!/usr/bin/env node
// Cross-platform replacement for the old `dev:backend` shell one-liner, which relied on
// bash-only `${BACKEND_PORT:-8000}` expansion and broke under cmd.exe on Windows.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePort } from './dev-port-utils.mjs';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(frontendDir, '../backend');
const port = parsePort(process.env.BACKEND_PORT);

function pythonBin() {
  const venvUnix = resolve(backendDir, '.venv/bin/python');
  const venvWin = resolve(backendDir, '.venv/Scripts/python.exe');
  if (existsSync(venvUnix)) return venvUnix;
  if (existsSync(venvWin)) return venvWin;
  return 'python';
}

const python = pythonBin();

const check = spawnSync(
  python,
  ['-c', 'import fastapi, uvicorn, aiohttp, aiofiles, dotenv, pydantic_settings, pandas, numpy'],
  { cwd: backendDir, stdio: 'ignore' },
);

if (check.status !== 0) {
  const install = spawnSync(python, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
    cwd: backendDir,
    stdio: 'inherit',
  });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

const uvicorn = spawn(
  python,
  ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(port), '--reload'],
  { cwd: backendDir, stdio: 'inherit' },
);

uvicorn.on('exit', (code) => process.exit(code ?? 0));
