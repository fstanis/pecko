export class PeckoRng {
  private seed: number;

  constructor(seed: number = Date.now()) {
    this.seed = seed >>> 0;
  }

  private nextUint(): number {
    this.seed = (Math.imul(this.seed, 0x08088405) + 1) >>> 0;
    return this.seed;
  }

  /** Uniform real in [0, 1). */
  uniform(): number {
    return (this.nextUint() >>> 1) / 0x8000_0000;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.uniform() * n);
  }
}
