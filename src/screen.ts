import { Crt, SCREEN_W, SCREEN_H } from './crt';
import { Color, type Engine } from './engine';
import { SHOULD_KEEP_ORIGINAL_BUGS } from './pecko';

const FRAME = { x1: 1, y1: 1, x2: SCREEN_W - 1, y2: 19 }; // last column stays empty
const GREETING_WIN = { x1: 3, y1: 3, x2: FRAME.x2 - 1, y2: 18 };
const ANSWER_WIN = { x1: 4, y1: 3, x2: FRAME.x2 - 1, y2: 18 };
const INPUT_FRAME_TOP = 20;
const INPUT_ROW = 21;
// the editor ignores the frame: text runs through the right border and the
// empty last column, wraps onto the left border; String[255] fits four rows
const INPUT_WIN = { x1: 1, y1: INPUT_ROW, x2: SCREEN_W, y2: INPUT_ROW + 3 };
const PROMPT = 'Reci : ';
const PROMPT_COLUMN = 5;
const TITLE_COLUMN = 30;
const TITLE_PAUSE_MS = 400;
const TYPE_DELAY_MS = 14;
const WRAP_SPACE_COLUMN = 63;
const WRAP_HARD_COLUMN = 76;
// the original's editor only ever rewrote row 21 up to this column
const PROMPT_ERASE_COLUMN = 75;
const MAX_INPUT_LENGTH = 255;

export async function drawGreetingScreen(crt: Crt, engine: Engine): Promise<void> {
  crt.window({ x1: 1, y1: 1, x2: SCREEN_W, y2: SCREEN_H });
  crt.clrScr();
  drawFrame(crt, engine.title);
  await Crt.delay(TITLE_PAUSE_MS);
  drawInputFrame(crt);
  crt.window(GREETING_WIN);
  crt.textBackground(Color.Black);
  let row = 1;
  for (const paragraph of engine.greeting) {
    crt.textColor(paragraph.attr);
    crt.gotoXY(1, row);
    crt.write(paragraph.text);
    crt.writeLn();
    row++;
  }
}

export function blankScreen(crt: Crt): void {
  crt.window({ x1: 1, y1: 1, x2: SCREEN_W, y2: SCREEN_H });
  crt.textBackground(Color.Black);
  crt.clrScr();
  crt.isCursorVisible = false;
}

export async function writeAnswer(crt: Crt, text: string): Promise<void> {
  erasePromptArea(crt);
  crt.isCursorVisible = false;
  crt.window(GREETING_WIN);
  crt.clrScr();
  await typewrite(crt, text);
}

export function drawPrompt(crt: Crt, buffer: string): void {
  erasePromptArea(crt);
  crt.window(INPUT_WIN);
  crt.textBackground(Color.Black);
  crt.textColor(Color.LightGreen);
  crt.gotoXY(PROMPT_COLUMN, 1);
  crt.write(PROMPT);
  crt.write(buffer);
  const cursorCell = PROMPT_COLUMN - 1 + PROMPT.length + buffer.length;
  crt.gotoXY((cursorCell % SCREEN_W) + 1, 1 + Math.floor(cursorCell / SCREEN_W));
  crt.isCursorVisible = true;
}

/** One editor keystroke; returns the updated buffer. Authentic mode edits
 *  single cells at the cursor, otherwise the whole line is redrawn. */
export function typePromptKey(crt: Crt, buffer: string, key: string): string {
  if (key === 'Backspace') {
    if (buffer.length === 0) {
      return buffer;
    }
    if (SHOULD_KEEP_ORIGINAL_BUGS) {
      erasePromptChar(crt);
    } else {
      drawPrompt(crt, buffer.slice(0, -1));
    }
    return buffer.slice(0, -1);
  }
  if (key.length !== 1 || buffer.length >= MAX_INPUT_LENGTH) {
    return buffer;
  }
  if (SHOULD_KEEP_ORIGINAL_BUGS) {
    echoPromptChar(crt, key);
  } else {
    drawPrompt(crt, buffer + key);
  }
  return buffer + key;
}

function drawFrame(crt: Crt, title: string): void {
  crt.textColor(Color.White);
  crt.textBackground(Color.LightGray);
  const width = FRAME.x2 - FRAME.x1 + 1;
  crt.gotoXY(FRAME.x1, FRAME.y1);
  crt.write('╔' + '═'.repeat(width - 2) + '╗');
  for (let y = FRAME.y1 + 1; y <= FRAME.y2; y++) {
    crt.gotoXY(FRAME.x1, y);
    crt.writeChar('║');
    crt.gotoXY(FRAME.x2, y);
    crt.writeChar('║');
  }
  crt.textColor(Color.Red);
  crt.gotoXY(TITLE_COLUMN, FRAME.y1);
  crt.write(title);
}

function drawInputFrame(crt: Crt): void {
  drawBorderRow(crt, INPUT_FRAME_TOP, '═', '║');
  drawBorderRow(crt, INPUT_FRAME_TOP + 2, '╚', '╝');
  crt.window({ x1: 1, y1: INPUT_ROW, x2: SCREEN_W, y2: INPUT_ROW });
  crt.textColor(Color.White);
  crt.textBackground(Color.LightGray);
  crt.gotoXY(1, 1);
  crt.writeChar('║');
  crt.gotoXY(FRAME.x2, 1);
  crt.writeChar('║');
}

function drawBorderRow(crt: Crt, y: number, left: string, right: string): void {
  crt.window({ x1: 1, y1: y, x2: SCREEN_W, y2: y });
  crt.textColor(Color.White);
  crt.textBackground(Color.LightGray);
  crt.gotoXY(1, 1);
  crt.write(left + '═'.repeat(FRAME.x2 - 2) + right);
}

// single-cell edits at the prompt cursor, positioned by drawPrompt;
// re-selecting the window would reset that cursor
function echoPromptChar(crt: Crt, ch: string): void {
  crt.writeChar(ch);
}

function erasePromptChar(crt: Crt): void {
  if (crt.whereX() === 1) {
    crt.gotoXY(SCREEN_W, crt.whereY() - 1);
  } else {
    crt.gotoXY(crt.whereX() - 1, crt.whereY());
  }
  crt.writeChar(' ');
  crt.gotoXY(crt.whereX() - 1, crt.whereY());
}

/** The original never redrew the input frame and only erased row 21, short
 *  of its right end: overflow damage and the last five columns persist
 *  until the next full screen draw. */
function erasePromptArea(crt: Crt): void {
  crt.textBackground(Color.Black);
  if (SHOULD_KEEP_ORIGINAL_BUGS) {
    crt.window({ x1: 2, y1: INPUT_ROW, x2: PROMPT_ERASE_COLUMN, y2: INPUT_ROW });
    crt.gotoXY(1, 1);
    crt.write(' '.repeat(PROMPT_ERASE_COLUMN - 1));
    return;
  }
  crt.window(INPUT_WIN);
  for (let row = 1; row <= 4; row++) {
    crt.gotoXY(1, row);
    crt.write(' '.repeat(SCREEN_W));
  }
  drawInputFrame(crt);
}

async function typewrite(crt: Crt, text: string): Promise<void> {
  crt.window(ANSWER_WIN);
  crt.gotoXY(1, 1);
  crt.textColor(Color.LightGreen);
  for (const line of wrapAnswer(text)) {
    for (const ch of line) {
      crt.writeChar(ch);
      await Crt.delay(TYPE_DELAY_MS);
    }
    crt.writeLn();
  }
}

/** Breaks at the first space past WRAP_SPACE_COLUMN (the space is dropped);
 *  hard-wraps mid-word at WRAP_HARD_COLUMN. */
function wrapAnswer(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  let col = 1; // the next character lands at col + 1
  for (const ch of text) {
    col++;
    if (col > WRAP_SPACE_COLUMN && ch === ' ') {
      lines.push(line);
      line = '';
      col = 1;
      continue;
    }
    if (col === WRAP_HARD_COLUMN) {
      line += ch;
      lines.push(line);
      line = '';
      col = 1;
      continue;
    }
    line += ch;
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}
