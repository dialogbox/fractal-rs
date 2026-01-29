export class PreciseNumber {
  private value: bigint;
  private static SCALE = 1_000_000_000_000_000_000n; // 18 decimals
  private static SCALE_F = 1e18;

  constructor(val: bigint) {
    this.value = val;
  }

  static fromNumber(n: number): PreciseNumber {
    return new PreciseNumber(BigInt(Math.round(n * PreciseNumber.SCALE_F)));
  }

  static fromString(s: string): PreciseNumber {
    const isNeg = s.startsWith('-');
    if (isNeg) s = s.substring(1);
    const scale = PreciseNumber.SCALE;

    const dot = s.indexOf('.');
    let big: bigint;
    if (dot === -1) {
      big = BigInt(s) * scale;
    } else {
      const intS = s.substring(0, dot);
      const fracS = s
        .substring(dot + 1)
        .padEnd(18, '0')
        .slice(0, 18);
      big = BigInt(intS) * scale + BigInt(fracS);
    }
    return new PreciseNumber(isNeg ? -big : big);
  }

  toString(): string {
    // const s = this.value.toString(); // unused
    const isNeg = this.value < 0n;
    const abs = isNeg ? -this.value : this.value;
    const str = abs.toString().padStart(19, '0');
    const dotPos = str.length - 18;
    const intPart = str.slice(0, dotPos);
    const fracPart = str.slice(dotPos);
    let res = `${intPart}.${fracPart}`;
    res = res.replace(/\.?0+$/, '');
    if (res === '') res = '0';
    if (isNeg) res = '-' + res;
    return res;
  }

  toExponential(digits: number): string {
    return Number(this.toString()).toExponential(digits);
  }

  toNumber(): number {
    return Number(this.value) / PreciseNumber.SCALE_F;
  }

  add(other: PreciseNumber): PreciseNumber {
    return new PreciseNumber(this.value + other.value);
  }

  sub(other: PreciseNumber): PreciseNumber {
    return new PreciseNumber(this.value - other.value);
  }

  mul(limit: number): PreciseNumber {
    const scalar = BigInt(Math.round(limit * 1e9));
    const res = (this.value * scalar) / 1_000_000_000n;
    return new PreciseNumber(res);
  }

  scale(factor: number): PreciseNumber {
    const f = BigInt(Math.round(factor * 1e6));
    return new PreciseNumber((this.value * f) / 1_000_000n);
  }

  div(val: number): PreciseNumber {
    // Fix: Handle floating point divisors by scaling
    // We want result = (this / val)
    // Representation: (value / scale) / val = (value / (val * scale)) * scale? No.
    // We want R such that R/SCALE = (V/SCALE) / val
    // R = V / val
    // Since we do integer math: R = (V * MUL) / (val * MUL)
    // Let's use MUL = 1e9 to capture fractional val
    const mul = 1_000_000_000n;
    const divScaled = BigInt(Math.round(val * 1_000_000_000)); // val * 1e9
    if (divScaled === 0n) throw new Error('Division by zero');

    return new PreciseNumber((this.value * mul) / divScaled);
  }

  lt(other: PreciseNumber): boolean {
    return this.value < other.value;
  }
  gt(other: PreciseNumber): boolean {
    return this.value > other.value;
  }

  split(): [number, number] {
    const valF = Number(this.value) / 1e18;
    const hi = Math.fround(valF);
    // Re-calculate the exact hi part as a BigInt scaled by 1e18.
    // We use a 10^9 * 10^9 approach to avoid floating point precision loss
    // during the intermediate multiplication (10^9 < 2^53).
    const hiBigScaled = BigInt(Math.round(hi * 1000000000)) * 1000000000n;
    const loBig = this.value - hiBigScaled;
    const lo = Number(loBig) / 1e18;
    return [hi, lo];
  }
}
