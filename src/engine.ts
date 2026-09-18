/** CGA colour numbers, Turbo Pascal style. */
export const Color = {
  Black: 0,
  Blue: 1,
  Green: 2,
  Cyan: 3,
  Red: 4,
  Magenta: 5,
  Brown: 6,
  LightGray: 7,
  DarkGray: 8,
  LightBlue: 9,
  LightGreen: 10,
  LightCyan: 11,
  LightRed: 12,
  LightMagenta: 13,
  Yellow: 14,
  White: 15,
} as const;

export type ColorValue = (typeof Color)[keyof typeof Color];

export interface Paragraph {
  attr: ColorValue;
  text: string;
}

export type Turn = { kind: 'exit' } | { kind: 'answer'; text: string; strike: boolean };

export interface Engine {
  readonly title: string;
  readonly greeting: Paragraph[];
  readonly isSoundOn: boolean;
  /** An empty input line yields the exit turn. */
  respond(input: string): Turn | Promise<Turn>;
}
