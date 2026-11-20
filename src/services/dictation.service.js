const EventEmitter = require('events');
const logger = require('../core/logger').createServiceLogger('DICTATION');
const { formatDictation } = require('./dictation-format');

const PROCESSING_TIMEOUT_MS = 90000;

/**
 * Press-to-talk dictation that works in any app (Wispr Flow style, fully
 * local): start recording with a shortcut, speak, press it again, and the
 * cleaned-up transcript is pasted where your cursor is.
 *
 * It reuses the speech service's recorder and local Whisper in "dictate"
 * intent, so audio never leaves the machine and nothing is sent to the LLM.
 *
 * States emitted on 'state': idle | listening | processing | done | error
 */
class DictationService extends EventEmitter {
  constructor({ speechService, inserter = null, ownWindowFocused = () => false } = {}) {
    super();
    this.speech = speechService;
    this.inserter = inserter;
    this.ownWindowFocused = ownWindowFocused;
    this.state = 'idle';
    this.fragments = [];
    this.lastError = null;
    this._watchdog = null;
    this._idleTimer = null;
    this._starting = false;

    this.speech.on('dictation-transcription', (text) => {
      if (this.state === 'listening' || this.state === 'processing') {
        this.fragments.push(String(text || '').trim());
      }
    });

    this.speech.on('capture-finished', ({ intent } = {}) => {
      if (intent === 'dictate' && this.state !== 'idle') {
        this._finalize().catch((error) => {
          logger.error('Dictation finalize failed', { error: error.message });
          this._set('error', { message: error.message });
        });
      }
    });

    this.speech.on('error', (message) => {
      if (this.state === 'idle' || this.state === 'done' || this.state === 'error') return;
      this.lastError = String(message || 'Speech error');
      if (this._starting) return;
      if (this.speech.isRecording) {
        this.speech.stopRecording();
      } else if (!this.speech.isProcessingAudio) {
        this._set('error', { message: this.lastError });
      }
    });
  }

  isEnabled() {
    return String(process.env.DICTATION_ENABLED || 'true').toLowerCase() !== 'false';
  }

  isActive() {
    return this.state === 'listening' || this.state === 'processing';
  }

  getState() {
    return { state: this.state };
  }

  toggle() {
    if (this.state === 'listening') return this.stop();
    if (this.state === 'processing') {
      this._set('processing', { message: 'Still transcribing…' });
      return;
    }
    return this.start();
  }

  start() {
    if (!this.isEnabled()) {
      this._set('error', { message: 'Dictation is turned off in Settings.' });
      return;
    }
    if (!this.speech.isAvailable()) {
      this._set('error', { message: 'Speech is not set up. Configure local Whisper in Settings.' });
      return;
    }
    if (this.speech.isRecording) {
      this._set('error', { message: 'Stop voice capture first, then start dictation.' });
      return;
    }
    if (this.speech.isProcessingAudio) {
      this._set('error', { message: 'Still processing previous audio. Try again in a moment.' });
      return;
    }

    this.fragments = [];
    this.lastError = null;
    this._clearTimers();
    this.state = 'listening';
    this._starting = true;
    try {
      this.speech.startRecording({ intent: 'dictate' });
    } finally {
      this._starting = false;
    }

    if (!this.speech.isRecording) {
      // startRecording reports its own reason through the 'error' event.
      this._set('error', { message: this.lastError || 'Could not start the microphone.' });
      return;
    }
    if (this.lastError) {
      // Recorder started but the microphone could not be opened.
      this._set('processing');
      this.speech.stopRecording();
      return;
    }
    this._set('listening');
  }

  stop() {
    if (this.state !== 'listening') return;
    this._set('processing');
    this._watchdog = setTimeout(() => {
      logger.warn('Dictation timed out while processing');
      this._set('error', { message: 'Transcription took too long. Try a shorter dictation.' });
    }, PROCESSING_TIMEOUT_MS);
    this.speech.stopRecording();
  }

  async _finalize() {
    clearTimeout(this._watchdog);
    this._watchdog = null;
    this.state = 'processing';

    const raw = this.fragments.join(' ').trim();
    this.fragments = [];

    const formatted = formatDictation(raw, {
      removeFillers: String(process.env.DICTATION_REMOVE_FILLERS || 'true').toLowerCase() !== 'false',
      dictionary: this.speech._getDictionaryTerms ? this.speech._getDictionaryTerms() : [],
      trailingSpace: String(process.env.DICTATION_TRAILING_SPACE || 'true').toLowerCase() !== 'false'
    });

    if (!formatted.trim()) {
      if (this.lastError) {
        this._set('error', { message: this.lastError });
      } else {
        this._set('done', { message: 'No speech detected.', chars: 0 });
      }
      return;
    }

    const wantsPaste = String(process.env.DICTATION_OUTPUT || 'paste').toLowerCase() !== 'clipboard';
    // If one of our own windows has focus (e.g. dictation was started from the
    // overlay button), a paste would land in OpenCluely, not in the user's app.
    const ownFocused = wantsPaste && this.ownWindowFocused();
    const mode = wantsPaste && !ownFocused ? 'paste' : 'clipboard';

    const result = await this.inserter.insert(formatted, { mode });
    let message;
    if (result.method === 'pasted') {
      message = 'Inserted.';
    } else if (result.error) {
      message = `Copied to clipboard. ${result.error}`;
    } else if (ownFocused) {
      message = 'Copied. Click where you want it and paste (Ctrl/Cmd+V).';
    } else {
      message = 'Copied to clipboard.';
    }
    logger.info('Dictation complete', { chars: formatted.length, method: result.method });
    this._set('done', { message, method: result.method, chars: formatted.length });
  }

  _set(state, extra = {}) {
    this.state = state;
    this.emit('state', { state, ...extra });
    if (state === 'done' || state === 'error') {
      clearTimeout(this._watchdog);
      this._watchdog = null;
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        if (this.state === 'done' || this.state === 'error') {
          this.state = 'idle';
          this.emit('state', { state: 'idle' });
        }
      }, state === 'error' ? 4000 : 2000);
    }
  }

  _clearTimers() {
    clearTimeout(this._watchdog);
    clearTimeout(this._idleTimer);
    this._watchdog = null;
    this._idleTimer = null;
  }
}

module.exports = DictationService;
