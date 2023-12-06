import { ContactProperty } from './config';
import { IValidator } from './validation';

export default class ValidatorString implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean {
    if (!property.validator) {
      return !!input;
    }

    if (Array.isArray(property.validator)) {
      throw Error(`property of type string should not be an array`);
    }

    const regex = new RegExp(property.validator);
    const validatorStr = new ValidatorString();
    const formatted = validatorStr.format(input);
    const match = formatted.match(regex);
    return !!match && match.length > 0;
  }

  format(input : string) : string {
    input = input.replace(/[^a-zA-Z0-9 ()\-']/g, '');
    input = input.replace(/\s\s+/g, ' ');
    return input.trim();
  }
};
