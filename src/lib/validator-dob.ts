import { DateTime } from 'luxon';
import { IValidator } from './validation';

export class ValidatorDateOfBirth implements IValidator {
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
    return 'Not a valid Date of Birth (eg. 1990-02-26)';
  }
}

const parse = (input: string) => {
  const strippedInput = input.replace(/ /ig, '');
  return DateTime.fromISO(strippedInput);
};

export class ValidatorAge implements IValidator {
  private trimSpace(input: string): string {
    return input.replace(/\s/g, '');
  }

  isValid(input: string): boolean {
    const age = parseInt(this.trimSpace(input));
    return !isNaN(age) && age > 18 && age < 200;
  }

  format(input: string): string {
    const age = parseInt(this.trimSpace(input));
    if (isNaN(age)) {
      return input;
    }
    return `${age} years`;
  }

  get defaultError(): string {
    return 'Age should be a number between 18 and 200';
  }
}
