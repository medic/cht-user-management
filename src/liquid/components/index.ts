import { ContactType, HierarchyConstraint } from '../../config';
import { RemotePlace } from '../../lib/remote-place-cache';
import Place from '../../services/place';


export type SearchInputViewModel = {
  op: string;
  prefix: string;
  type: string;
  hierarchy: HierarchyConstraint;
  required?: boolean;
  disabled?: boolean;
  data: any;
  place?: Place;
};

export type PlaceItemViewModel = {
  place: Place;
  contactType: ContactType;
};

export type SearchResultViewModel = {
  op: string;
  prefix: string;
  div: string;
  searchResults: RemotePlace[];
  level: number;
  place?: Place;
};
