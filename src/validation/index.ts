import { ContactProperty } from '../config';
import { Validation } from './validation';

export type ValidationError = {
  property_name: string;
  description: string;
};

/**
 * Where a value was entered.
 * 'form' values come from system-rendered inputs, they are option keys.
 * 'csv' values are typed in CSVs, option labels ideally.
 */
export type InputSource = 'form' | 'csv';

export interface IValidator {
  isValid(input: string, property? : ContactProperty, source?: InputSource) : boolean | string;
  format(input : string, property? : ContactProperty, source?: InputSource) : string;
  get defaultError(): string;
}

export default Validation;
