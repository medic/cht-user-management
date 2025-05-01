import { ContactType, HierarchyConstraint } from '../../config';

export type MultiplaceNewViewModel = {
  logo: string;
  contactType: ContactType;
  hierarchy: HierarchyConstraint[];
  show_place_form: boolean;
  data?: any;
  contact_id?: string;
  errors: { [key:string]: string };
};

export type MultiplaceEditViewModel = {
  logo: string;
  contactType: ContactType;
  hierarchy: HierarchyConstraint[];
  show_place_form: boolean;
  data?: any;
  contact_id?: string;
  errors: { [key:string]: string };
};

export type MultiplaceFormFragmentViewModel = {
  contactType: ContactType;
  data?: any;
  errors: { [key:string]: string };
};

export type MultiplaceButtonViewModel = {
  place_type: string;
};

export type PlaceListFragmentViewModel = {
  contactType: ContactType;
  item: {
    id: string;
    name: string;
    value: string;
  };
  data?: any;
  errors: { [key:string]: string };
};
