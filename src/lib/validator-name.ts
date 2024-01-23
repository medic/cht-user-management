import { ContactProperty } from '../config';
import { IValidator } from './validation';
import ValidatorString from './validator-string';

export default class ValidatorName implements IValidator {
  isValid(input: string) : boolean | string {
    return !!input;
  }

  format(input : string, property : ContactProperty) : string {
    const validatorStr = new ValidatorString();
    let toAlter = input;
    if (property.parameter) {
      if (!Array.isArray(property.parameter)) {
        throw Error(`property of type name's parameter should be an array`);
      }

      toAlter = property.parameter.reduce((agg, toRemove) => {
        const regex = new RegExp(toRemove, 'ig');
        return agg.replace(regex, '');
      }, toAlter);
    }

    return this.titleCase(validatorStr.format(toAlter));
  }

  get defaultError(): string {
    return 'Is Required';
  }

  private titleCase(value: string): string {
    const words = value.toLowerCase().split(' ');
    const titleCased = words.map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
    return titleCased.replace(/ '/g, '\'');
  }
}
