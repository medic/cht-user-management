import { DateTime } from 'luxon';
import { IValidator } from './validation';

export default class ValidatorDateOfBirth implements IValidator {
  isValid(input: string) : boolean | string {
    try {
      const parsed = parse(input);
      return parsed.isValid && parsed.diffNow('hours').hours <= 0;
    } catch (e) {
      return false;
    }
  }

  format(input : string) : string {
    const parsed = parse(input);
    const asISODate = parsed.toISODate();
    if (!asISODate) {
      return input;
    }

    return asISODate;
  }

  get defaultError(): string {
    return 'Not a valid Date of Birth (eg. 1990-02-26 or 26/2/1985)';
  }
}

const parse = (input: string) => {
  const strippedInput = input.replace(/ /ig, '');
  const hasSlash = strippedInput.includes('/');
  return hasSlash ?
    DateTime.fromFormat(strippedInput, 'd/M/yyyy') 
    : DateTime.fromISO(strippedInput);
};
