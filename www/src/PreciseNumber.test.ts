import { describe, it, expect } from 'vitest';
import { PreciseNumber } from './PreciseNumber';

describe('PreciseNumber', () => {
  it('should create from number', () => {
    const pn = PreciseNumber.fromNumber(1.5);
    expect(pn.toString()).toBe('1.5');
  });

  it('should create from string', () => {
    const pn = PreciseNumber.fromString('1.234');
    expect(pn.toString()).toBe('1.234');
  });

  it('should add numbers', () => {
    const a = PreciseNumber.fromNumber(1.0);
    const b = PreciseNumber.fromNumber(2.5);
    const c = a.add(b);
    expect(c.toString()).toBe('3.5');
  });

  it('should subtract numbers', () => {
    const a = PreciseNumber.fromNumber(5.0);
    const b = PreciseNumber.fromNumber(1.5);
    const c = a.sub(b);
    expect(c.toString()).toBe('3.5');
  });

  it('should multiply by scalar', () => {
    // mul(limit: number) where logic is (value * (limit * 1e9)) / 1e9
    const a = PreciseNumber.fromNumber(2.0);
    const b = a.mul(0.5);
    expect(b.toString()).toBe('1');
  });

  it('should divide by scalar', () => {
    const a = PreciseNumber.fromNumber(10.0);
    const b = a.div(2.0);
    expect(b.toString()).toBe('5');
  });

  it('should handle small division correcty', () => {
    // Regression test for div fix
    const a = PreciseNumber.fromNumber(1.0);
    const b = a.div(0.5);
    expect(b.toString()).toBe('2');
  });

  it('should scale', () => {
    const a = PreciseNumber.fromNumber(1.0);
    const b = a.scale(2.0);
    expect(b.toString()).toBe('2');
  });
});
