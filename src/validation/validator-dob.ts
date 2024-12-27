import { DateTime } from 'luxon';
import { IValidator } from '.';

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
    if (!this.isValid(input)) {
      return input;
    }

    const asISODate = parsed.toISODate();
    return asISODate ?? input;
  }

  get defaultError(): string {
    return 'Not a valid Date of Birth (eg. 1990-02-26 or 26/2/1985 or 38)';
  }

  private parse(input: string): DateTime {
    const strippedInput = input.replace(/\s/ig, '');
    const asNumber = Number(strippedInput);
    if (!isNaN(asNumber) && asNumber > 0) {
      return DateTime.now().minus({ years: asNumber });
    }

    const hasSlash = strippedInput.includes('/');
    return hasSlash ?
      DateTime.fromFormat(strippedInput, 'd/M/yyyy') 
      : DateTime.fromISO(strippedInput);
  }
}
