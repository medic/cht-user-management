import { ContactProperty } from '../config';
import { IValidator } from '.';
import ValidatorString from './validator-string';

export default class ValidatorName implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean | string {
    // Verify property.parameter is always array
    if (property.parameter && !Array.isArray(property.parameter)) {
      throw Error(`Property '${property.friendly_name}' of type 'name' expects 'parameter' to be an array.`);
    }

    return !!input;
  }

  format(input : string, property : ContactProperty) : string {
    input = input.replace(/\./g, ' ');
    input = input.replace(/\//g, ' / ');
    let toFormat = input;
    if (property.parameter) {
      if (!Array.isArray(property.parameter)) {
        throw Error(`property with type "name": parameter should be an array`);
      }
      
      toFormat = property.parameter.reduce((agg, toRemove) => {
        const regex = new RegExp(toRemove, 'ig');
        return agg.replace(regex, '');
      }, toFormat);
    }
    
    const validatorStr = new ValidatorString();
    return this.titleCase(validatorStr.format(toFormat));
  }

  get defaultError(): string {
    return 'Is Required';
  }

  private titleCase(value: string): string {
    if (!value) {
      return '';
    }

    const titleCase = (word: string) => word[0]?.toUpperCase() + word.slice(1);

    const isRomanNumeral = /^[ivx]+$/i;
    const hasForwardSlash = /\//g;
    const hasApostrophe = /\s*'\s*/g;
    const hasParentheses = /\(([^)]+)\)/g;
    const hasExtraSpaces = /\s+/g;

    const splitAndProcess = (value: string, delimiter: string) => {
      return value
        .split(delimiter)
        .map(word => word.match(isRomanNumeral) ? word.toUpperCase() : titleCase(word))
        .join(delimiter);
    };

    return value.toLowerCase()
      .replace(hasForwardSlash, ' / ')
      .replace(hasApostrophe, '\'')
      .replace(hasParentheses, match => `(${titleCase(match.slice(1, -1))})`)
      .split(' ')
      .filter(Boolean)
      .map(word => splitAndProcess(word, '-'))
      .join(' ')
      .replace(hasExtraSpaces, ' ')
      .trim();
  }
}
