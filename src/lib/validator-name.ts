import { CountryCode, parsePhoneNumber, isValidNumberForRegion } from "libphonenumber-js";

import { ContactProperty } from './config';
import { IValidator } from './validation';
import ValidatorString from "./validator-string";

export default class ValidatorSkip implements IValidator {
  isValid(input: string) : boolean {
    return !!input;
  }

  format(input : string, property : ContactProperty) : string {
    const validatorStr = new ValidatorString();
    let toFormat = input;
    if (property.validator) {
      if (!Array.isArray(property.validator)) {
        throw Error(`property of type name's validator should be an array`);
      }

      toFormat = property.validator.reduce((agg, toRemove) => {
        const regex = new RegExp(toRemove, 'ig');
        return agg.replace(regex, '');
      }, toFormat);
    }

    return this.titleCase(validatorStr.format(toFormat));
  }

  private titleCase(value: string): string {
    let titleCased = value.toLowerCase()
    const doTitleCase = (separator: string) => {
      const words = titleCased.split(separator);
      return words.map(word => word[0].toUpperCase() + word.slice(1)).join(separator);
    };

    titleCased = doTitleCase(' ');
    titleCased = doTitleCase('-');
    return titleCased.replace(/ '/g, "'");
  }
};
