import {ContactProperty} from '../config';
import {IValidator} from './validation';
import ValidatorString from './validator-string';
import ValidatorSelectOne from './validator-select-one';

const DELIMITER = ' ';

export default class ValidatorSelectMultiple implements IValidator {

  isValid(input: string, property: ContactProperty): boolean | string {
    // Verify property.parameter is an object and is not null
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected attribute "parameter" on property ${property.property_name} to be an object.`);
    }

    const selectOneValidator = new ValidatorSelectOne();
    const stringValidator = new ValidatorString();

    const selectedValues = this.parseInput(input, stringValidator); 
    const invalidValues = selectedValues.filter(
      value => !selectOneValidator.isValid(value, property)
    );

    if (invalidValues.length > 0) {
      return `Invalid values for property "${property.friendly_name}": ${invalidValues.join(', ')}`;
    }

    // Check if any values are missing and property is required
    if (selectedValues.length === 0 && property.required) {
      return 'Value is required';
    }

    return true;
  }

  format(input: string): string {
    return Array.isArray(input) ? input.join(DELIMITER) : input;
  }

  get defaultError(): string {
    return `Invalid input. Please use 'space' as delimiter.`;
  }

  private parseInput(input: string|string[], stringValidator: ValidatorString): string[] {
    if (Array.isArray(input)) {
      return input;
    } 

    return input
      .split(DELIMITER)
      .map(value => stringValidator.format(value))
      .filter(Boolean);
  }
}
