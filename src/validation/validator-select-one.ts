import {ContactProperty} from '../config';
import { IValidator } from '.';
import ValidatorString from './validator-string';

export default class ValidatorSelectOne implements IValidator {
  isValid(input: string, property: ContactProperty): boolean|string {
    const stringValidator = new ValidatorString();
    const trimmedInput = stringValidator.format(input); 

    if (trimmedInput.length === 0 && property.required) {
      return `Value is required`;
    }
    // Verify property.parameter is an object
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected attribute "parameter" on property ${property.property_name} to be an object.`);
    }
    
    const validValues = Object.keys(property.parameter);
    return validValues.includes(trimmedInput);
  }

  format(input: string): string {
    return input;
  }

  get defaultError(): string {
    return 'Invalid value selected';
  }
}
