import { DateTime } from 'luxon';
import { IValidator } from './validation';

class ValidatorDateOfBirth implements IValidator {
  isValid(input: string) : boolean {
    try {
      const parsed = parse(input);
      return parsed.isValid && parsed < DateTime.now();
    } catch (e) {
      return false;
    }
  }

  format(input : string) : string {
    const parsed = parse(input);
    const asISODate = parsed.toISODate();
    if (!this.isValid(input) || !asISODate) {
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

export default class ValidatorAge implements IValidator {
  private dobValidator = new ValidatorDateOfBirth();

  private isAgeValid(age: number): boolean {
    return !isNaN(age) && age > 0;
  }

  private trimSpace(input: string): string {
    return input.replace(/\s/g, '');
  }

  isValid(input: string): boolean {
    const age = Number(this.trimSpace(input));
    return this.isAgeValid(age) || this.dobValidator.isValid(input);
  }

  format(input: string): string {
    const age = Number(this.trimSpace(input));
    if (this.isAgeValid(age)) {
      return DateTime.now().minus({years: age}).toISODate();
    }
    if (this.dobValidator.isValid(input)) {
      return this.dobValidator.format(input);
    }
    return input;
  }

  get defaultError(): string {
    return 'Age should be a number between 18 and 200 or a valid date (eg. 1990-02-26)';
  }
}
