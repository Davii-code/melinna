import { readFileSync } from 'node:fs';
import path from 'path';
import { thing } from '../main/thing';
import { other } from '../core/errors';
import { layout } from '../core/layout/ok';
export const all = [readFileSync, path, thing, other, layout];
