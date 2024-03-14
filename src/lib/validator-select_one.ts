import {ContactProperty} from '../config';
import {IValidator} from './validation';

export default class ValidatorSelectOne implements IValidator {
  isValid(input: string, property: ContactProperty): boolean {
    if (input.trim().length === 0 && property.required) {
      throw new Error('Value is required');
    }
    // Verify property.parameter is an object
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected property "parameter" to be an object.`);
    }
    const validValues = Object.keys(property.parameter);
    return validValues.includes(input.trim());
  }

  format(input: string): string {
    return input;
  }

  get defaultError(): string {
    return 'Invalid value selected';
  }

}
