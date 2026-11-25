import { CountryCode, parsePhoneNumber, isValidNumberForRegion } from 'libphonenumber-js';

import { ContactProperty } from '../config';
import { IValidator } from '.';

export default class ValidatorPhone implements IValidator {
  isValid(input: string, property: ContactProperty): boolean {
    if (!property.parameter) {
      throw Error(`property of type phone on ${property.friendly_name} missing parameter with locale`);
    }

    if (typeof property.parameter !== 'string') {
      throw Error(`property '${property.friendly_name}' of type 'phone' expects 'parameter' to be a string.`);
    }

    try {
      return isValidNumberForRegion(input, property.parameter as CountryCode);
    } catch {
      return false;
    }
  }

  format(input: string, property: ContactProperty): string {
    if (!property.parameter) {
      throw Error(`property of type phone on ${property.friendly_name} missing parameter with locale`);
    }

    try {
      const phoneNumber = parsePhoneNumber(input, property.parameter as CountryCode);
      return phoneNumber.format('E.164');
    } catch {
      return input;
    }
  }

  defaultError(_input: string, property?: ContactProperty): string {
    return `Not a valid ${property?.parameter || 'regional'} phone number`;
  }
}
