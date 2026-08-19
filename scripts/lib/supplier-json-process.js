const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

function runSupplierJsonProcess(script, products, options = {}) {
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
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    child.stdout.on('data', (data) => { stdout += stdoutDecoder.write(data); });
    child.stderr.on('data', (data) => { stderr += stderrDecoder.write(data); });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE' && error.code !== 'EOF') reject(error);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
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

    const stored = script && typeof script === 'object' && !Array.isArray(script) ? script : null;
    const scriptName = stored ? String(stored.name || 'stored_post_process.py').trim() : String(script || '').trim();
    const source = stored ? String(stored.source || '') : '';
    if (source.length > 100_000) {
      reject(new Error('Код post-process не должен превышать 100 000 символов'));
      return;
    }
    child.stdin.end(JSON.stringify({
      script: scriptName,
      source: source || undefined,
      products,
      force_legacy: options.forceLegacy === true,
      validate_only: options.validateOnly === true,
    }));
  });
}

module.exports = { runSupplierJsonProcess };
