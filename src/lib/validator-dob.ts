import { DateTime } from 'luxon';
import { IValidator } from './validation';

export default class ValidatorDateOfBirth implements IValidator {
  isValid(input: string) : boolean {
    try {
      const parsed = this.parse(input);
      return parsed.isValid && parsed < DateTime.now();
    } catch (e) {
      return false;
    }
  }

  format(input : string) : string {
    const parsed = this.parse(input);
    const asISODate = parsed.toISODate();
    if (!this.isValid(input) || !asISODate) {
      return input;
    }

    return asISODate;
  }

  get defaultError(): string {
    return 'Not a valid Date of Birth (eg. 1990-02-26 or 25)';
  }

  private parse(input: string): DateTime {
    const strippedInput = input.replace(/\s/ig, '');
    const asNumber = Number(strippedInput);
    if (!isNaN(asNumber) && asNumber > 0) {
      return DateTime.now().minus({ years: asNumber });
    }

    return DateTime.fromISO(strippedInput);
  };
}
