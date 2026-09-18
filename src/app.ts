import { Crt, loadFont } from './crt';
import type { Engine, Turn } from './engine';
import { Pecko } from './pecko';
import {
  blankScreen,
  drawGreetingScreen,
  drawPrompt,
  typePromptKey,
  writeAnswer,
} from './screen';

// soft keyboards only open for a focused input, so taps focus this
// invisible proxy and its value becomes the prompt buffer
const keyboardProxy = document.querySelector<HTMLInputElement>('#keyboard-proxy')!;

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
      } else {
        buffer = typePromptKey(crt, buffer, event.key);
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

/** Debug hook: ?say=<text> auto-types after the greeting; \n presses Enter
 *  and \b presses Backspace. Keys are staggered so listeners re-attach
 *  between Enters. */
function autoType(text: string): void {
  const keys = [...text].map((ch) => (ch === '\n' ? 'Enter' : ch === '\b' ? 'Backspace' : ch));
  if (!text.endsWith('\n')) {
    keys.push('Enter');
  }
  setTimeout(() => {
    keys.forEach((key, index) =>
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })), index * 100),
    );
  }, 11000);
}

// a soft keyboard only shrinks the visual viewport on iOS (Android resizes
// the layout via the interactive-widget meta); size the monitor to that
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
  // plain keys are terminal input in every state: without this, Backspace is
  // history-back in embedded webviews, '/' and '?' open Firefox quick-find,
  // and space scrolls. Modifier combos and the proxy's native editing keep
  // their defaults.
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
