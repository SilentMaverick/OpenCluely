const { spawn } = require('child_process');
const logger = require('../core/logger').createServiceLogger('INSERT');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* already gone */ }
      done(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => done(error));
    child.on('close', (code) => {
      if (code === 0) return done();
      const err = new Error(stderr.trim() || `${command} exited with code ${code}`);
      err.exitCode = code;
      done(err);
    });
  });
}

/**
 * Types dictated text into whichever app currently has keyboard focus by
 * placing it on the clipboard and sending the platform paste shortcut, then
 * restoring what was on the clipboard before. If a keystroke can't be sent
 * (missing tool, missing OS permission) the text is left on the clipboard so
 * nothing the user said is lost.
 */
class TextInserter {
  constructor({ clipboard } = {}) {
    this.clipboard = clipboard || require('electron').clipboard;
  }

  _snapshot() {
    const cb = this.clipboard;
    const snap = {};
    try { snap.text = cb.readText(); } catch (_) { /* ignore */ }
    try { snap.html = cb.readHTML(); } catch (_) { /* ignore */ }
    try {
      const image = cb.readImage();
      if (image && !image.isEmpty()) snap.image = image;
    } catch (_) { /* ignore */ }
    return snap;
  }

  _restore(snap) {
    const cb = this.clipboard;
    const payload = {};
    if (snap.text) payload.text = snap.text;
    if (snap.html) payload.html = snap.html;
    if (snap.image) payload.image = snap.image;
    try {
      if (Object.keys(payload).length) cb.write(payload);
      else cb.clear();
    } catch (error) {
      logger.warn('Failed to restore clipboard', { error: error.message });
    }
  }

  /**
   * @param {string} text
   * @param {{mode?: 'paste'|'clipboard'}} options
   * @returns {Promise<{method: 'pasted'|'clipboard', error?: string}>}
   */
  async insert(text, { mode = 'paste' } = {}) {
    if (mode === 'clipboard') {
      this.clipboard.writeText(text);
      return { method: 'clipboard' };
    }

    const snapshot = this._snapshot();
    this.clipboard.writeText(text);
    await sleep(60);

    try {
      await this._sendPasteKeystroke();
    } catch (error) {
      logger.warn('Auto-paste failed; text left on clipboard', { error: error.message });
      return { method: 'clipboard', error: this._explain(error) };
    }

    // Give the target app time to read the clipboard before we put it back.
    await sleep(500);
    this._restore(snapshot);
    return { method: 'pasted' };
  }

  _explain(error) {
    const msg = String((error && error.message) || error || '');
    if (/not allowed to send keystrokes|1002|assistive access/i.test(msg)) {
      return 'Allow OpenCluely under System Settings > Privacy & Security > Accessibility to auto-paste.';
    }
    if (error && error.code === 'ENOENT') {
      return 'Auto-paste needs xdotool (X11) or wtype (Wayland). Text is on your clipboard.';
    }
    return msg || 'Could not send the paste shortcut.';
  }

  async _sendPasteKeystroke() {
    if (process.platform === 'win32') {
      return run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
      ], 8000);
    }

    if (process.platform === 'darwin') {
      return run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], 8000);
    }

    const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
    const attempts = wayland
      ? [
          ['wtype', ['-M', 'ctrl', 'v', '-m', 'ctrl']],
          ['ydotool', ['key', '29:1', '47:1', '47:0', '29:0']],
          ['xdotool', ['key', '--clearmodifiers', 'ctrl+v']]
        ]
      : [
          ['xdotool', ['key', '--clearmodifiers', 'ctrl+v']],
          ['wtype', ['-M', 'ctrl', 'v', '-m', 'ctrl']]
        ];

    let lastError = null;
    for (const [command, args] of attempts) {
      try {
        await run(command, args);
        return;
      } catch (error) {
        lastError = error;
        if (error.code !== 'ENOENT') break;
      }
    }
    throw lastError || new Error('No tool available to send a paste shortcut');
  }
}

module.exports = TextInserter;
