const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function runSupplierJsonProcess(scriptName, products, options = {}) {
  const runnerPath = path.join(process.cwd(), 'scripts', 'parser', 'json_postprocess_runner.py');
  const workspacePython = process.platform === 'win32'
    ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
    : path.join(process.cwd(), '.venv', 'bin', 'python');
  const python = process.env.PYTHON_PATH || (fs.existsSync(workspacePython) ? workspacePython : 'python');

  return new Promise((resolve, reject) => {
    const child = spawn(python, [runnerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE' && error.code !== 'EOF') reject(error);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Post-process exited with ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) throw new Error('Скрипт должен вернуть массив товаров');
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Некорректный JSON от post-process скрипта: ${error.message}`));
      }
    });

    child.stdin.end(JSON.stringify({ script: scriptName, products, force_legacy: options.forceLegacy === true }));
  });
}

module.exports = { runSupplierJsonProcess };
