import { CountryCode, parsePhoneNumber, isValidNumberForRegion } from 'libphonenumber-js';

import { ContactProperty } from '../config';
import { IValidator } from './validation';

export default class ValidatorPhone implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean | string {
    if (!property.parameter) {
      throw Error(`property of type phone on ${property.friendly_name} missing parameter with locale`);
    }

    try {
      const isValid = isValidNumberForRegion(input, property.parameter as CountryCode);
      if (isValid) {
        return true;
      }

      return `Not a valid phone number for country code ${property.parameter}`;
    } catch (e: any) {
      return e.toString();
    }
  }

  format(input : string, property : ContactProperty) : string {
    if (!property.parameter) {
      throw Error(`property of type phone on ${property.friendly_name} missing parameter with locale`);
    }

    try {
      const phoneNumber = parsePhoneNumber(input, property.parameter as CountryCode);
      return phoneNumber.formatNational();
    } catch {
      return input;
    }
  }

  get defaultError(): string {
    return 'Not a valid regional phone number';
  }
}
