import type { ColorValue } from './engine';

export const SCREEN_W = 80;
export const SCREEN_H = 25;

const PALETTE = [
  '#000000',
  '#0000aa',
  '#00aa00',
  '#00aaaa',
  '#aa0000',
  '#aa00aa',
  '#aa5500',
  '#aaaaaa',
  '#555555',
  '#5555ff',
  '#55ff55',
  '#55ffff',
  '#ff5555',
  '#ff55ff',
  '#ffff55',
  '#ffffff',
] as const;

const FONT_FAMILY_NAME = 'More Perfect DOS VGA';
const FONT_STACK = `"${FONT_FAMILY_NAME}", "Perfect DOS VGA 437 Win", Consolas, monospace`;

/** Must run before the first frame: canvas ctx.font does not trigger a
 *  webfont load by itself. */
export async function loadFont(): Promise<void> {
  await document.fonts.load(`16px ${FONT_FAMILY_NAME}`);
}

interface Cell {
  ch: string;
  attr: number; // fg | bg<<4 | blink<<7
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number; // 1-based, inclusive
}

export class Crt {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cells: Cell[] = [];
  private cellWidth = 9;
  private cellHeight = 16;

  private textAttr = 0x07;
  private wind: Rect = { x1: 1, y1: 1, x2: SCREEN_W, y2: SCREEN_H };
  private curX = 1;
  private curY = 1;
  isCursorVisible = false;
  /** Cursor shape in scanlines (0-15), VGA default. */
  cursorFrom = 13;
  cursorTo = 14;

  isSoundOn = true;
  private audio: AudioContext | null = null;

  currentAudioTime(): number {
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') {
        void this.audio.resume();
      }
      return this.audio.currentTime;
    } catch {
      return performance.now() / 1000;
    }
  }

  private lastBeepEnd = 0;

  /** One voice: a tone never starts before the previous one has ended. */
  beep(freq = 900, ms = 60, atSeconds?: number): void {
    if (!this.isSoundOn) {
      return;
    }
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') {
        void this.audio.resume();
      }
      const startAt = Math.max(atSeconds ?? this.audio.currentTime, this.lastBeepEnd);
      this.lastBeepEnd = startAt + ms / 1000;
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, startAt);
      gain.gain.setValueAtTime(0.06, startAt + ms / 1000);
      gain.gain.linearRampToValueAtTime(0, startAt + ms / 1000 + 0.01);
      oscillator.connect(gain).connect(this.audio.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + ms / 1000 + 0.02);
    } catch {
      // autoplay is blocked until the first user gesture
    }
  }

  static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2d context unavailable');
    }
    this.ctx = ctx;
    for (let i = 0; i < SCREEN_W * SCREEN_H; i++) {
      this.cells.push({ ch: ' ', attr: 0x07 });
    }
    const frame = (time: number) => {
      this.render(time);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Keeps the backing store at the CSS box times devicePixelRatio; safe to
   *  call every frame — it returns unless the box or ratio changed. */
  resize(): void {
    const devicePixelRatio = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));
    if (width === this.canvas.width && height === this.canvas.height) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.cellWidth = width / SCREEN_W;
    this.cellHeight = height / SCREEN_H;
  }

  textColor(fg: ColorValue): void {
    this.textAttr = (this.textAttr & 0x70) | (fg & 0x0f);
  }
  textBackground(bg: ColorValue): void {
    this.textAttr = (this.textAttr & 0x8f) | (bg << 4);
  }

  window(rect: Rect): void {
    this.wind = rect;
    this.curX = 1;
    this.curY = 1;
  }

  gotoXY(x: number, y: number): void {
    this.curX = Math.min(Math.max(x, 1), this.wind.x2 - this.wind.x1 + 1);
    this.curY = Math.min(Math.max(y, 1), this.wind.y2 - this.wind.y1 + 1);
  }

  whereX(): number { return this.curX; }
  whereY(): number { return this.curY; }

  clrScr(): void {
    for (let y = this.wind.y1; y <= this.wind.y2; y++) {
      for (let x = this.wind.x1; x <= this.wind.x2; x++) {
        this.put(x, y, ' ', this.textAttr);
      }
    }
    this.curX = 1;
    this.curY = 1;
  }

  write(text: string): void {
    for (const ch of text) {
      this.writeChar(ch);
    }
  }

  writeChar(ch: string): void {
    if (ch === '\n') {
      this.newLine();
      return;
    }
    const windowWidth = this.wind.x2 - this.wind.x1 + 1;
    if (this.curX > windowWidth) {
      this.newLine();
    }
    this.put(this.wind.x1 + this.curX - 1, this.wind.y1 + this.curY - 1, ch, this.textAttr);
    this.curX++;
  }

  writeLn(text = ''): void {
    this.write(text);
    this.newLine();
  }

  /** When false, a full window never scrolls; the cursor stays on the last
   *  row and keeps overwriting it. */
  shouldScroll = true;

  private newLine(): void {
    this.curX = 1;
    const windowHeight = this.wind.y2 - this.wind.y1 + 1;
    if (this.curY < windowHeight) {
      this.curY++;
      return;
    }
    if (!this.shouldScroll) {
      return;
    }
    for (let y = this.wind.y1; y < this.wind.y2; y++) {
      for (let x = this.wind.x1; x <= this.wind.x2; x++) {
        this.put(x, y, this.cell(x, y + 1).ch, this.cell(x, y + 1).attr);
      }
    }
    for (let x = this.wind.x1; x <= this.wind.x2; x++) {
      this.put(x, this.wind.y2, ' ', this.textAttr);
    }
  }

  readRows(): string[] {
    const rows: string[] = [];
    for (let y = 0; y < SCREEN_H; y++) {
      let row = '';
      for (let x = 0; x < SCREEN_W; x++) {
        const cell = this.cells[y * SCREEN_W + x];
        row += cell ? cell.ch : ' ';
      }
      rows.push(row.replace(/ +$/, ''));
    }
    return rows;
  }

  private cell(x: number, y: number): Cell {
    return this.cells[(y - 1) * SCREEN_W + (x - 1)] as Cell;
  }

  private put(x: number, y: number, ch: string, attr: number): void {
    const cell = this.cell(x, y);
    cell.ch = ch;
    cell.attr = attr;
  }

  private render(time: number): void {
    this.resize();
    const { ctx } = this;
    const cellWidth = this.cellWidth;
    const cellHeight = this.cellHeight;
    // a 4:3 glass makes grid cells narrower than the 9x16 font cell: draw
    // at cellHeight px and squeeze horizontally to keep the DOS glyph shape
    const squeezeX = cellWidth / 9 / (cellHeight / 16);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const isBlinkOn = Math.floor(time / 400) % 2 === 0;
    ctx.font = `${cellHeight}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < SCREEN_H; y++) {
      for (let x = 0; x < SCREEN_W; x++) {
        const cell = this.cells[y * SCREEN_W + x] as Cell;
        const foreground = PALETTE[cell.attr & 0x0f] as string;
        const background = PALETTE[(cell.attr >> 4) & 0x07] as string;
        const isBlink = (cell.attr & 0x80) !== 0;
        const cellLeft = x * cellWidth;
        const cellTop = y * cellHeight;
        ctx.fillStyle = background;
        ctx.fillRect(cellLeft, cellTop, cellWidth, cellHeight);
        if (isBlink && !isBlinkOn) {
          continue;
        }
        if (cell.ch === ' ') {
          continue;
        }
        ctx.fillStyle = foreground;
        ctx.setTransform(squeezeX, 0, 0, 1, cellLeft + cellWidth / 2, cellTop + cellHeight / 2 + cellHeight / 16);
        ctx.fillText(cell.ch, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    if (this.isCursorVisible && Math.floor(time / 265) % 2 === 0) {
      const cursorX = this.wind.x1 + this.curX - 1;
      const cursorY = this.wind.y1 + this.curY - 1;
      ctx.fillStyle = PALETTE[this.textAttr & 0x0f] as string;
      const from = (this.cursorFrom / 16) * cellHeight;
      const to = (this.cursorTo / 16) * cellHeight;
      ctx.fillRect((cursorX - 1) * cellWidth, (cursorY - 1) * cellHeight + from, cellWidth, Math.max(2, to - from));
    }
  }
}
