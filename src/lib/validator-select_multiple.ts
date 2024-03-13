import {ContactProperty} from '../config';
import {IValidator} from './validation';

export default class ValidatorSelectMultiple implements IValidator {
  isValid(input: string, property: ContactProperty): boolean {
    // Verify property.parameter is an object and is not null
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected property "parameter" to be an object.`);
    }
    const validValues = Object.keys(property.parameter);
    let selectedValues;
    if (Array.isArray(input)) {
      selectedValues = input;
    } else {
      selectedValues = input.split(' ').map(value => value.trim()).filter(value => value !== '');
    }
    const invalidValues = selectedValues.filter(value => !validValues.includes(value));
    if (invalidValues.length > 0) {
      throw new Error(`Invalid values: ${invalidValues.join(', ')}`);
    }
    if (selectedValues.length === 0 && property.required) {
      throw new Error('Value is required');
    }
    return true;
  }

  format(input: string): string {
    return Array.isArray(input) ? input.join(' ') : input;
  }

  get defaultError(): string {
    return 'Invalid input';
  }

}
