import dataJson from '../data/pecko.json';
import type { Engine, Paragraph, Turn } from './engine';
import { PeckoRng } from './rng';

export type { Turn };

/** Where a rule or a matcher's else goes: a named bucket, or another
 *  named matcher. Everything eventually ends in a bucket. */
export interface Target {
  bucket?: string;
  matcher?: string;
}

export interface Rule extends Target {
  keywords: string[];
  /** earns the strike beeps */
  strike?: boolean;
  /** side effect of the sound-toggle commands */
  sound?: 'on' | 'off';
  /** serve the bucket sequentially with a persistent counter */
  seq?: boolean;
}

export interface Matcher {
  match: Rule[];
  else: Target;
}

/** A pipeline step: prefix rules match the input start, scan rules slide. */
export type Step = { prefix: Rule[] } | { scan: Rule[] };

export interface PeckoData {
  title: string;
  greeting: Paragraph[];
  /** name -> string list; singleton = fixed reply, multiple = random pick */
  buckets: Record<string, string[]>;
  matchers: Record<string, Matcher>;
  pipeline: Step[];
  /** bucket answering when the whole pipeline misses */
  fallback: string;
}

export const DATA = dataJson as unknown as PeckoData;

/** Keep the original's bugs: overflow damage to the input frame persists,
 *  and multi-string buckets answer nothing on 1-in-2N turns. */
export const SHOULD_KEEP_ORIGINAL_BUGS = true;

export class Pecko implements Engine {
  private readonly rng: PeckoRng;

  readonly title = DATA.title;
  readonly greeting = DATA.greeting;
  isSoundOn = true;
  exchanges = 0;
  private work = '';
  private seqCounters = new Map<string, number>();

  constructor(rng: PeckoRng = new PeckoRng()) {
    this.rng = rng;
  }

  respond(rawLine: string): Turn {
    if (rawLine === '') {
      return { kind: 'exit' };
    }

    // line + " "; punctuation gets a space before it so keywords ending
    // in a space match in front of it ("?" doubles, faithfully)
    let input = (rawLine.toLowerCase() + ' ').replace(/[.!?]/g, (c) => (c === '?' ? ' ??' : ' ' + c));
    this.work = input;

    for (const step of DATA.pipeline) {
      const rule = 'prefix' in step ? this.matchPrefix(input, step.prefix) : this.scan(input, step.scan);
      if (rule) {
        if (rule.sound !== undefined) {
          this.isSoundOn = rule.sound === 'on';
        }
        return this.answer(this.resolveSeq(rule, rule.seq === true), rule.strike === true);
      }
    }

    return this.answer(this.resolve({ bucket: DATA.fallback }));
  }

  private matchPrefix(input: string, rules: Rule[]): Rule | null {
    for (const rule of rules) {
      for (const keyword of rule.keywords) {
        if (input.startsWith(keyword)) {
          return rule;
        }
      }
    }
    return null;
  }

  /** First match wins: earliest position, then rule order, then keyword
   *  order. Keywords match inside words. */
  private scan(input: string, rules: Rule[]): Rule | null {
    for (let pos = 0; pos < input.length; pos++) {
      for (const rule of rules) {
        for (const keyword of rule.keywords) {
          if (input.startsWith(keyword, pos)) {
            return rule;
          }
        }
      }
    }
    return null;
  }

  private resolve(target: Target): string {
    if (target.matcher !== undefined) {
      const matcher = DATA.matchers[target.matcher];
      if (matcher === undefined) {
        throw new Error(`unknown matcher "${target.matcher}"`);
      }
      return this.resolve(this.scan(this.work, matcher.match) ?? matcher.else);
    }
    if (target.bucket !== undefined) {
      const lines = DATA.buckets[target.bucket];
      if (lines === undefined) {
        throw new Error(`unknown text bucket "${target.bucket}"`);
      }
      if (lines.length === 1) {
        return lines[0] as string;
      }
      // r := 1 + Round(N * Random()) reaches N+1 with probability 1/2N —
      // that turn answers nothing; buckets are stored in threshold order
      let pickIndex = 1 + Math.round(this.rng.uniform() * lines.length);
      if (pickIndex > lines.length && !SHOULD_KEEP_ORIGINAL_BUGS) {
        pickIndex = lines.length;
      }
      return pickIndex <= lines.length ? (lines[pickIndex - 1] as string) : '';
    }
    throw new Error(`target has neither bucket nor matcher: ${JSON.stringify(target)}`);
  }

  private resolveSeq(target: Target, seq: boolean): string {
    if (!seq || target.bucket === undefined) {
      return this.resolve(target);
    }
    const name = target.bucket;
    const lines = DATA.buckets[name] ?? [];
    const index = Math.min(this.seqCounters.get(name) ?? 0, lines.length - 1);
    this.seqCounters.set(name, (this.seqCounters.get(name) ?? 0) + 1);
    return lines[index] ?? '';
  }

  private answer(text: string, strike = false): Turn {
    this.exchanges++;
    return { kind: 'answer', text, strike };
  }
}
