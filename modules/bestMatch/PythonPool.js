const { spawn } = require('child_process');
const path = require('path');

class PythonPool {
    constructor({ pythonPath, scriptPath, logger, cwd }) {
        this.pythonPath = pythonPath || 'python3';
        this.scriptPath = scriptPath;
        this.cwd = cwd || path.dirname(scriptPath);
        this.logger = logger || console;

        this.proc = null;
        this.alive = false;
        this.buffer = '';
        this.queue = [];
        this.current = null;
        this.starting = false;
        this.defaultTimeoutMs = 60000;
    }

    async start() {
        if (this.alive || this.starting) {
            return;
        }
        this.starting = true;
        try {
            this.logger.info('[PythonPool] 启动持久 Python 进程...');
            const args = [this.scriptPath, '--daemon'];
            const opts = { cwd: this.cwd };
            this.proc = spawn(this.pythonPath, args, opts);
            this.proc.stdout.setEncoding('utf8');
            this.proc.stderr.setEncoding('utf8');

            this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
            this.proc.stderr.on('data', (chunk) => this._onStderr(chunk));
            this.proc.on('exit', (code, signal) => this._onExit(code, signal));
            this.proc.on('error', (err) => this._onError(err));

            this.alive = true;
            this.logger.info('[PythonPool] Python 进程已就绪');
        } finally {
            this.starting = false;
        }
    }

    async stop() {
        if (!this.proc) return;
        try {
            this.logger.info('[PythonPool] 停止 Python 进程');
            this.proc.kill('SIGTERM');
        } catch (_) {
            // ignore
        } finally {
            this.proc = null;
            this.alive = false;
            // 拒绝队列中的请求
            const err = new Error('Python process stopped');
            if (this.current) {
                const { reject, timeoutId } = this.current;
                clearTimeout(timeoutId);
                reject(err);
                this.current = null;
            }
            while (this.queue.length) {
                const item = this.queue.shift();
                clearTimeout(item.timeoutId);
                item.reject(err);
            }
            this.buffer = '';
        }
    }

    async execute(payload, timeoutMs) {
        const timeout = typeof timeoutMs === 'number' ? timeoutMs : this.defaultTimeoutMs;
        if (!this.alive) {
            await this.start();
        }
        return new Promise((resolve, reject) => {
            const job = { payload, resolve, reject, timeoutId: null };
            job.timeoutId = setTimeout(() => {
                if (this.current === job) this.current = null;
                reject(new Error('Python matcher timeout'));
                this._processNext();
            }, timeout);
            this.queue.push(job);
            this._processNext();
        });
    }

    _processNext() {
        if (!this.alive) return;
        if (this.current) return;
        const job = this.queue.shift();
        if (!job) return;
        this.current = job;
        try {
            const line = JSON.stringify(job.payload) + '\n';
            this.proc.stdin.write(line, 'utf8');
        } catch (err) {
            clearTimeout(job.timeoutId);
            this.current = null;
            job.reject(err);
            this._processNext();
        }
    }

    _onStdout(chunk) {
        this.buffer += chunk;
        let idx;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (!line) continue;
            const job = this.current;
            this.current = null;
            if (!job) {
                this.logger.warn('[PythonPool] 收到意外输出（无当前任务）');
                continue;
            }
            clearTimeout(job.timeoutId);
            try {
                const parsed = JSON.parse(line);
                job.resolve(parsed);
            } catch (e) {
                job.reject(new Error(`Parse output failed: ${e.message}\n${line}`));
            }
            this._processNext();
        }
    }

    _onStderr(chunk) {
        const text = chunk.toString();
        this.logger.warn(`[PythonPool][stderr] ${text.trim()}`);
    }

    _onExit(code, signal) {
        this.logger.warn(`[PythonPool] 进程退出 code=${code} signal=${signal}`);
        this.alive = false;
        // 拒绝当前任务并清理
        if (this.current) {
            const { reject, timeoutId } = this.current;
            clearTimeout(timeoutId);
            reject(new Error('Python process exited'));
            this.current = null;
        }
        while (this.queue.length) {
            const item = this.queue.shift();
            clearTimeout(item.timeoutId);
            item.reject(new Error('Python process exited'));
        }
        this.buffer = '';
    }

    _onError(err) {
        this.logger.error('[PythonPool] 进程错误:', err && err.message ? err.message : String(err));
    }
}

module.exports = PythonPool;
