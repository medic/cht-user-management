import { ContactType, HierarchyConstraint } from '../../config';
import ChtSession from '../../lib/cht-session';
import Place from '../../services/place';
import { NavViewModel } from '../app';

export type MultiplaceNewViewModel = {
  logo: string;
  contactType: ContactType;
  hierarchy: HierarchyConstraint[];
  show_place_form: boolean;
  data?: any;
  contact_id?: string;
  errors: { [key: string]: string };
};

export type MultiplaceEditViewModel = {
  contactType: ContactType;
} & NavViewModel & MultiplaceEditFormViewModel;

export type MultiplaceEditFormViewModel = {
  contactType: ContactType;
  contact_id: string;
  hierarchy: HierarchyConstraint[];
  data: any;
  show_place_form: boolean;
  errors: { [key: string]: string };
};

export type MultiplaceFormFragmentViewModel = {
  contactType: ContactType;
  data?: any;
  errors: { [key:string]: string };
};

export type MultiplaceButtonViewModel = {
  place_type: string;
};

export type MultiplaceNewFormFragment = {
  contactType: ContactType;
  errors: { [key:string]: string };
  data?: any;
};

export type PlaceListViewModel = {
  contactType: ContactType;
  places: Place[];
  can_edit: boolean; 
}

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

export type MultiplaceReassignFormViewModel = {
  session: ChtSession;
  contactType: ContactType;
  hierarchy: HierarchyConstraint[];
  errors: { [key:string]: string };
  places?: {
    place: Place;
    value: string;
  }[];
  data?: any;
};

export type MultiplaceReassignViewModel = {
  contactType: ContactType;
} & NavViewModel & MultiplaceReassignFormViewModel;
