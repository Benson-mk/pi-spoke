import { test, expect } from 'vitest';
import { assertQualification } from '../../src/sandbox/qualification.js';
import { qualificationPins, linuxQualificationPins } from '../../src/sandbox/qualification-pins.js';

test('S35: OS, binary, compiler and lock changes invalidate compatibility proof', () => {
  for (const pins of [qualificationPins, linuxQualificationPins]) {
    expect(() => assertQualification(pins)).not.toThrow();
    for (const key of Object.keys(pins)) expect(() => assertQualification({ ...pins, [key]: 'changed' })).toThrow('Compatibility proof invalidated');
  }
});
