import { HierarchyPropertyValue, ContactPropertyValue, SupersetPropertyValue } from './validated-property-values';
import UnvalidatedPropertyValue from './unvalidated-property-value';
import { RemotePlacePropertyValue } from './remote-place-property-value';

export class PropertyValues {
  public static includes(searchWithin?: string | IPropertyValue, searchFor?: string | IPropertyValue): boolean {
    const insensitiveMatch = (within: string, toFind: string) => within.includes(toFind);
    return PropertyValues.compare(insensitiveMatch, searchWithin, searchFor);
  }

  public static isMatch(searchWithin?: string | IPropertyValue, searchFor?: string | IPropertyValue): boolean {
    const insensitiveMatch = (within: string, toFind: string) => within === toFind;
    return PropertyValues.compare(insensitiveMatch, searchWithin, searchFor);
  }

  private static compare(
    comparator: (a: string, b: string) => boolean,
    a?: string | IPropertyValue,
    b?: string | IPropertyValue,
  ): boolean {
    if (a === undefined || b === undefined) {
      return false;
    }

    const normalize = (str: string) => str.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const valueAsArray = (val: string | IPropertyValue): string[] => {
      const values = typeof val === 'string' ? [val] : [val.formatted, val.original];
      return values
        .filter(Boolean)
        .map(normalize);
    };

    const withinArray: string[] = valueAsArray(a);
    const forArray: string[] = valueAsArray(b);

    // all things have "empty" in them
    if (!forArray.length) {
      return true;
    }

    return withinArray.some(within => forArray.some(forX => comparator(within, forX)));
  }
}

export interface IPropertyValue {
  get original(): string;
  get formatted(): string;
  get propertyNameWithPrefix(): string;

  validationError?: string;

  validate(): void;
  toString(): string;
}

/**
 * For validating levels of the hierarchy
*/
export { HierarchyPropertyValue };

/**
 * For validating ContactProperty values
 */
export { ContactPropertyValue };

/**
 * When storing a Name, and don't need access to an underlying Place
 */
export { RemotePlacePropertyValue };

/**
 * When storing something that doesn't need validation
 */
export { UnvalidatedPropertyValue };


/**
 * For validating superset integeration config of the hierarchy
*/
export { SupersetPropertyValue };
