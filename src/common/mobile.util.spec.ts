import { normalizeMobile } from './mobile.util';

describe('normalizeMobile', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['98765-43210', '9876543210'],
    ['(98765) 43210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['00919876543210', '9876543210'],
    ['  9876543210  ', '9876543210'],
    [9876543210, '9876543210'], // number cell from Excel
    ['9876543210.0', '9876543210'], // numeric cell read as float
  ])('%p -> %p', (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['abc'],
    ['12345'],
    ['98765432101'], // 11 digits not starting with 0
    ['9876543210123'], // too long
    ['+1 415 555 2671'], // foreign number
    ['9.87654321E9'], // Excel scientific notation damage
    [true],
    [{}],
  ])('%p is rejected', (input) => {
    expect(normalizeMobile(input)).toBeNull();
  });

  it('same number typed three ways normalises to one value', () => {
    const set = new Set(
      ['9876543210', '+91 98765 43210', '09876543210'].map(normalizeMobile),
    );
    expect(set.size).toBe(1);
  });
});
