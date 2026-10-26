import { describe, expect, it } from 'vitest';
import { joinArgs, tokenizeArgs } from '../../../src/shared/tokenize-args';

describe('tokenizeArgs', () => {
  it('splits on whitespace', () => {
    expect(tokenizeArgs('clean install  -DskipTests')).toEqual(['clean', 'install', '-DskipTests']);
    expect(tokenizeArgs('  a\tb\nc ')).toEqual(['a', 'b', 'c']);
  });

  it('groups with double and single quotes and drops the quotes', () => {
    expect(tokenizeArgs('-Dname="meu app" \'x y\' z')).toEqual(['-Dname=meu app', 'x y', 'z']);
  });

  it('keeps the other quote kind inside a group', () => {
    expect(tokenizeArgs(`"it's" '"q"'`)).toEqual(["it's", '"q"']);
  });

  it('turns an empty pair of quotes into an empty argument', () => {
    expect(tokenizeArgs('a "" b')).toEqual(['a', '', 'b']);
  });

  it('runs an unterminated quote to the end of the text', () => {
    expect(tokenizeArgs('a "b c')).toEqual(['a', 'b c']);
  });

  it('never interprets shell characters', () => {
    expect(tokenizeArgs('& calc ; $(x) | y')).toEqual(['&', 'calc', ';', '$(x)', '|', 'y']);
  });

  it('is empty for blank text', () => {
    expect(tokenizeArgs('')).toEqual([]);
    expect(tokenizeArgs('   ')).toEqual([]);
  });
});

describe('joinArgs', () => {
  it('quotes the arguments that need it and round-trips', () => {
    const args = ['clean', 'a b', '', "it's", 'x"y'];
    expect(joinArgs(args)).toBe(`clean "a b" "" "it's" 'x"y'`);
    expect(tokenizeArgs(joinArgs(args))).toEqual(args);
  });
});
