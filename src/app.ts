import { Crt, loadFont } from './crt';
import type { Engine, Turn } from './engine';
import { Pecko, SHOULD_KEEP_ORIGINAL_BUGS } from './pecko';
import {
  blankScreen,
  drawGreetingScreen,
  drawPrompt,
  echoPromptChar,
  erasePromptChar,
  writeAnswer,
} from './screen';

// for mobile phones
const keyboardProxy = document.querySelector<HTMLInputElement>('#keyboard-proxy')!;

// the original's editor buffer is a DOS String[255]
const MAX_INPUT_LENGTH = 255;

function readLine(crt: Crt): Promise<string> {
  let buffer = '';
  return new Promise((resolve) => {
    drawPrompt(crt, buffer);
    keyboardProxy.value = '';
    const onInput = () => {
      buffer = keyboardProxy.value;
      drawPrompt(crt, buffer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        window.removeEventListener('keydown', onKey);
        keyboardProxy.removeEventListener('input', onInput);
        keyboardProxy.value = '';
        crt.isCursorVisible = false;
        resolve(buffer);
      } else if (event.isTrusted && document.activeElement === keyboardProxy) {
        return; // real keystrokes land in the proxy and re-enter via onInput
      } else if (event.key === 'Backspace') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          if (SHOULD_KEEP_ORIGINAL_BUGS) {
            erasePromptChar(crt);
          } else {
            drawPrompt(crt, buffer);
          }
        }
      } else if (event.key.length === 1 && buffer.length < MAX_INPUT_LENGTH) {
        buffer += event.key;
        if (SHOULD_KEEP_ORIGINAL_BUGS) {
          echoPromptChar(crt, event.key);
        } else {
          drawPrompt(crt, buffer);
        }
      }
    };
    keyboardProxy.addEventListener('input', onInput);
    window.addEventListener('keydown', onKey);
  });
}

function waitEnter(): Promise<void> {
  return new Promise((resolve) => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      window.removeEventListener('keydown', onKey);
      resolve();
    };
    window.addEventListener('keydown', onKey);
  });
}

const FAST_TICK_SECONDS = 2048 / 1193182;
let tuneEnd = 0; // seconds on the audio clock; one voice, notes queue in sequence

function playReplyJingle(crt: Crt): void {
  const notesHz = [1500, 1300, 1100, 900, 700, 500, 500, 700, 900, 1100, 1300];
  const noteSeconds = 32 * FAST_TICK_SECONDS;
  let startAt = Math.max(crt.currentAudioTime(), tuneEnd);
  for (const hz of notesHz) {
    crt.beep(hz, noteSeconds * 1000, startAt);
    startAt += noteSeconds;
  }
  tuneEnd = startAt;
}

async function playStrikeBeeps(crt: Crt): Promise<void> {
  const beepSeconds = 320 * FAST_TICK_SECONDS;
  const remaining = tuneEnd - crt.currentAudioTime();
  if (remaining > 0) {
    await Crt.delay(remaining * 1000);
  }
  let startAt = crt.currentAudioTime();
  for (let i = 0; i < 5; i++) {
    crt.beep(1000, beepSeconds * 1000, startAt);
    startAt += beepSeconds;
    await Crt.delay(beepSeconds * 1000);
  }
  tuneEnd = Math.max(tuneEnd, startAt);
}

/** Test/demo hook: ?say=<text> auto-types after the greeting; a newline in
 *  the text presses Enter (empty line = the quit path, so ?say=%0A%0A runs
 *  the quit -> black screen -> restart cycle). Enters are staggered so the
 *  restart listener attaches before the second one arrives. */
function autoType(text: string): void {
  const keys = [...text].map((ch) =>
    ch === '\n' ? 'Enter' : ch === '\b' ? 'Backspace' : ch,
  );
  if (!text.endsWith('\n')) {
    keys.push('Enter');
  }
  setTimeout(() => {
    keys.forEach((key, index) =>
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })), index * 100),
    );
  }, 11000);
}

// iOS keeps the layout viewport full-size under a soft keyboard and only
// shrinks the visual one; Android resizes via the interactive-widget meta,
// which this tracks equally well
function fitToVisualViewport(): void {
  const visualViewport = window.visualViewport;
  if (!visualViewport) {
    return;
  }
  const fit = () => {
    document.documentElement.style.setProperty('--vvh', `${visualViewport.height}px`);
    window.scrollTo(0, 0);
  };
  visualViewport.addEventListener('resize', fit);
  visualViewport.addEventListener('scroll', fit);
  fit();
}

function scheduleDebugHooks(crt: Crt): void {
  const params = new URLSearchParams(window.location.search);
  const dumpMs = Number(params.get('dump'));
  if (dumpMs > 0) {
    setTimeout(() => {
      document.body.setAttribute('data-grid', JSON.stringify(crt.readRows()));
    }, dumpMs);
  }
  const say = params.get('say');
  if (say !== null) {
    autoType(say);
  }
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#crt');
  if (!canvas) {
    throw new Error('#crt canvas missing');
  }
  fitToVisualViewport();
  // focus on click, not pointerdown: the tap's own focus default would
  // overwrite a pointerdown focus before the keystrokes begin
  document.body.addEventListener('click', () => keyboardProxy.focus({ preventScroll: true }));
  // the terminal consumes plain keys in every state: without this,
  // Backspace is history-back in embedded webviews, '/' and '?' open
  // Firefox quick-find, and space scrolls. Modifier combos (Cmd+R, Ctrl+T)
  // keep their browser defaults, and inside the proxy the native editing
  // defaults ARE the mobile input path.
  window.addEventListener('keydown', (event) => {
    const isPlainKey = !event.metaKey && !event.ctrlKey && !event.altKey;
    const isTerminalKey = event.key.length === 1 || event.key === 'Backspace';
    if (isPlainKey && isTerminalKey && document.activeElement !== keyboardProxy) {
      event.preventDefault();
    }
  });

  await loadFont();
  const crt = new Crt(canvas);
  scheduleDebugHooks(crt);
  crt.shouldScroll = false;
  const engine: Engine = new Pecko();

  await drawGreetingScreen(crt, engine);
  for (;;) {
    const line = await readLine(crt);
    const isQuitLine = line.trim() === '';
    const turn: Turn = isQuitLine ? { kind: 'exit' } : await engine.respond(line);

    if (turn.kind === 'exit') {
      blankScreen(crt);
      await waitEnter();
      await drawGreetingScreen(crt, engine);
      continue;
    }

    if (engine.isSoundOn) {
      playReplyJingle(crt);
    }
    await writeAnswer(crt, turn.text);
    if (turn.strike && engine.isSoundOn) {
      await playStrikeBeeps(crt);
    }
  }
}

void main();
