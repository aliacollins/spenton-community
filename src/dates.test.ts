import {describe,expect,it} from 'vitest';
import {dateInputText,parseDateInput} from './dates';

describe('date field input',()=>{
 it('accepts named months and ISO pastes without interpreting ambiguous numeric dates',()=>{
  expect(parseDateInput(' 9 Sep 2026 ')).toBe('2026-09-09');
  expect(parseDateInput('29 fEb 2028')).toBe('2028-02-29');
  expect(parseDateInput('2028-02-29')).toBe('2028-02-29');
  expect(dateInputText('2028-02-29')).toBe('29 Feb 2028');
  expect(parseDateInput('09/10/2026')).toBe('');
 });
 it.each(['31 Feb 2026','29 Feb 2027','32 Jan 2026','1 xyz 2026','10 Sep','2026-02-31','2026-09-10; DROP TABLE budgets','<script>alert(1)</script>'])('keeps invalid input out of date values: %s',value=>expect(parseDateInput(value)).toBe(''));
});
