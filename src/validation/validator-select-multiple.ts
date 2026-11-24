import {ContactProperty} from '../config';
import { InputSource, IValidator } from '.';
import ValidatorString from './validator-string';
import ValidatorSelectOne from './validator-select-one';

const DELIMITER = ' ';

export default class ValidatorSelectMultiple implements IValidator {

  isValid(input: string, property: ContactProperty, source: InputSource = 'form'): boolean {
    // Verify property.parameter is an object and is not null
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected attribute "parameter" on property ${property.property_name} to be an object.`);
    }

    const selectedValues = this.parseInput(input, new ValidatorString());
    if (selectedValues.length === 0) {
      return !property.required;
    }

    return this.findInvalidValues(selectedValues, property, source).length === 0;
  }

  format(input: string, property: ContactProperty, source: InputSource = 'form'): string {
    const options = this.parseInput(input, new ValidatorString())
      .map(value => ValidatorSelectOne.findOption(value, property, source));
    if (options.length && options.every(Boolean)) {
      return options.join(DELIMITER);
    }

    // leave invalid input as entered so the user can see what to fix
    return Array.isArray(input) ? input.join(DELIMITER) : input;
  }

  defaultError(input: string, property: ContactProperty, source: InputSource = 'form'): string {
    const selectedValues = this.parseInput(input, new ValidatorString());
    const invalidValues = this.findInvalidValues(selectedValues, property, source);
    if (invalidValues.length > 0) {
      const invalidDescription = `Invalid values for property "${property.friendly_name}": ${invalidValues.join(', ')}`;
      const optionsDescription = ValidatorSelectOne.describeOptions(property, source);
      return optionsDescription ? `${invalidDescription}. ${optionsDescription}` : invalidDescription;
    }

    if (selectedValues.length === 0) {
      return 'Value is required';
    }

    return `Invalid input. Please use 'space' as delimiter.`;
  }

  private findInvalidValues(selectedValues: string[], property: ContactProperty, source: InputSource): string[] {
    return selectedValues.filter(value => !ValidatorSelectOne.findOption(value, property, source));
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
