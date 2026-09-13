import { test, expect } from 'vitest';
import { assertQualification } from '../../src/sandbox/qualification.js';
import { qualificationPins } from '../../src/sandbox/qualification-pins.js';

test('S35: OS, binary, compiler and lock changes invalidate compatibility proof', () => {
  expect(() => assertQualification(qualificationPins)).not.toThrow();
  for (const key of Object.keys(qualificationPins)) expect(() => assertQualification({ ...qualificationPins, [key]: 'changed' })).toThrow('Compatibility proof invalidated');
});
