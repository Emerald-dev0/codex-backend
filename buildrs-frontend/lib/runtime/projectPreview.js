import { loadSandboxRuntime } from './bootManager';

let webContainerPromise = null;
let activeProcess = null;

async function getWebContainer() {
  if (!webContainerPromise) {
    webContainerPromise = loadSandboxRuntime()
      .then(({ WebContainer }) => WebContainer.boot())
      .catch((error) => {
        webContainerPromise = null;
        throw error;
      });
  }
  return webContainerPromise;
}

function abortError() {
  const error = new Error('Project preview was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function createFileTree(files) {
  const tree = {};
  files.forEach(({ path, content }) => {
    const segments = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/');
    if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) return;

    let directory = tree;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        if (directory[segment]?.directory) {
          throw new Error(`Cannot preview project: "${path}" conflicts with a directory.`);
        }
        directory[segment] = { file: { contents: content } };
        return;
      }

      const current = directory[segment];
      if (current?.file) {
        throw new Error(`Cannot preview project: "${path}" conflicts with a file.`);
      }
      if (!current) directory[segment] = { directory: {} };
      directory = directory[segment].directory;
    });
  });
  return tree;
}

async function streamOutput(process, onOutput) {
  const reader = process.output.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      onOutput(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function getPackageManager(packageJson, files) {
  const declared = String(packageJson.packageManager || '').split('@')[0];
  if (['pnpm', 'yarn', 'npm'].includes(declared)) return declared;
  if (files.some((file) => file.path === 'pnpm-lock.yaml')) return 'pnpm';
  if (files.some((file) => file.path === 'yarn.lock')) return 'yarn';
  return 'npm';
}

async function runInstall(container, packageManager, signal, onOutput) {
  throwIfAborted(signal);
  const installCommand = packageManager === 'pnpm'
    ? ['pnpm', ['install', '--reporter=append-only', '--no-frozen-lockfile']]
    : packageManager === 'yarn'
      ? ['yarn', ['install', '--non-interactive', '--no-progress']]
      : ['npm', ['install', '--no-progress', '--no-audit', '--no-fund', '--color=false']];
  const process = await container.spawn(installCommand[0], installCommand[1], {
    env: {
      CI: 'true',
      TERM: 'dumb',
      NO_COLOR: '1',
      npm_config_progress: 'false',
      npm_config_color: 'false',
      YARN_ENABLE_PROGRESS_BARS: '0',
    },
  });
  activeProcess = process;
  const stop = () => process.kill();
  signal?.addEventListener('abort', stop, { once: true });
  let timeout;
  try {
    const output = streamOutput(process, onOutput).catch((error) => {
      onOutput(`Dependency output stream ended: ${error.message}`);
    });
    const exitCode = await Promise.race([
      process.exit,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          process.kill();
          reject(new Error('Dependency installation timed out after three minutes.'));
        }, 180000);
      }),
    ]);
    await output;
    throwIfAborted(signal);
    if (exitCode !== 0) throw new Error(`Dependency installation failed (exit code ${exitCode}).`);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
    if (activeProcess === process) activeProcess = null;
  }
}

function waitForServer(container, script, signal, onOutput) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let process = null;
    let readyUrl = null;
    let unsubscribe = null;
    const cleanup = () => {
      clearTimeout(timeout);
      unsubscribe?.();
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onReady = (_port, url) => {
      readyUrl = url;
      finish(resolve, url);
    };
    const onAbort = () => {
      process?.kill();
      finish(reject, abortError());
    };
    const timeout = setTimeout(() => {
      process?.kill();
      finish(reject, new Error('The project server did not become ready within two minutes.'));
    }, 120000);

    unsubscribe = container.on('server-ready', onReady);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    container.spawn('npm', ['run', script]).then((startedProcess) => {
      process = startedProcess;
      activeProcess = process;
      process.exit.then(() => {
        if (activeProcess === process) activeProcess = null;
      }, () => {
        if (activeProcess === process) activeProcess = null;
      });
      streamOutput(process, onOutput).catch((error) => {
        if (!signal?.aborted) onOutput(`Preview output stream ended: ${error.message}`);
      });
      if (signal?.aborted) {
        process.kill();
        finish(reject, abortError());
      } else if (settled && !readyUrl) {
        process.kill();
      }
      process.exit.then((exitCode) => {
        if (!settled) finish(reject, new Error(`The project server exited before becoming ready (exit code ${exitCode}).`));
      }).catch((error) => {
        if (!settled) finish(reject, error);
      });
    }).catch((error) => finish(reject, error));
  });
}

export async function startProjectPreview(files, { signal, onOutput = () => {}, onStatus = () => {} } = {}) {
  throwIfAborted(signal);
  if (typeof window === 'undefined' || !window.crossOriginIsolated) {
    throw new Error('Project preview requires a cross-origin isolated browser. Open the editor in a supported browser and try again.');
  }

  const manifest = files.find((file) => file.path === 'package.json');
  if (!manifest) throw new Error('This project has no root package.json.');
  let packageJson;
  try {
    packageJson = JSON.parse(manifest.content);
  } catch (error) {
    throw new Error(`Could not read package.json: ${error.message}`);
  }
  const script = ['dev', 'start'].find((name) => typeof packageJson.scripts?.[name] === 'string');
  if (!script) throw new Error('Add a "dev" or "start" script to package.json to preview this app.');

  onStatus('Starting browser runtime…');
  const container = await getWebContainer();
  throwIfAborted(signal);
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
  }

  const existingFiles = await container.fs.readdir('.');
  for (const name of existingFiles) {
    await container.fs.rm(name, { recursive: true, force: true });
  }
  await container.mount(createFileTree(files));
  const dependencies = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
  ].some((group) => group && Object.keys(group).length > 0);
  if (dependencies) {
    onStatus(`Installing dependencies with ${getPackageManager(packageJson, files)}…`);
    await runInstall(container, getPackageManager(packageJson, files), signal, onOutput);
  }
  throwIfAborted(signal);

  onStatus('Starting the project server…');
  const url = await waitForServer(container, script, signal, onOutput);
  if (typeof url !== 'string' || !url) throw new Error('The project server started without a preview URL.');
  return url;
}

export function stopProjectPreview() {
  if (!activeProcess) return;
  activeProcess.kill();
  activeProcess = null;
}
