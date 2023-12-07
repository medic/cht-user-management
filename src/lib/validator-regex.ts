import { ContactProperty } from './config';
import { IValidator } from './validation';

import ValidatorString from './validator-string';

export default class ValidatorRegex implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean {
    if (!property.validator) {
      throw Error(`property of type regex on ${property.csv_name} missing validator`);
    }

    if (Array.isArray(property.validator)) {
      throw Error(`property of type name's validator should be an array`);
    }

    const regex = new RegExp(property.validator);
    const validatorStr = new ValidatorString();
    const altered = validatorStr.format(input);
    const match = altered.match(regex);
    return !!match && match.length > 0;
  }

  format(input : string) : string {
    const validatorStr = new ValidatorString();
    return validatorStr.format(input);
  }
};
