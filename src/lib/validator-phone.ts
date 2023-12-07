import { CountryCode, parsePhoneNumber, isValidNumberForRegion } from "libphonenumber-js";

import { ContactProperty } from './config';
import { IValidator } from './validation';

export default class ValidatorPhone implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean {
    if (!property.validator) {
      throw Error(`property of type phone on ${property.csv_name} missing validator with locale`);
    }

    try {
      parsePhoneNumber(input, property.validator as CountryCode);
      return isValidNumberForRegion(input, property.validator as CountryCode);
    } catch {
      return false;
    }
  }

  format(input : string, property : ContactProperty) : string {
    if (!property.validator) {
      throw Error(`property of type phone on ${property.csv_name} missing validator with locale`);
    }

    try {
      const phoneNumber = parsePhoneNumber(input, property.validator as CountryCode);
      return phoneNumber.formatNational();
    } catch {
      return input;
    }
  }
};
