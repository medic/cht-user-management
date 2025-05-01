import { ContactProperty, ContactType, HierarchyConstraint } from '../../config';
import ChtSession from '../../lib/cht-session';
import { WarningInformation } from '../../lib/manage-hierarchy';
import DirectiveModel from '../../services/directive-model';

export type BulkCreateFormViewModel = {
  contactType: ContactType;
  userRoleProperty: ContactProperty;
  errors?: {
    message: string;
  };
};

export type CreateFormViewModel = {
  op: string;
  contactType: ContactType;
  hierarchy: HierarchyConstraint[];
  userRoleProperty: ContactProperty;
  backend?: string;
};

export type DirectiveViewModel = {
  session: ChtSession;
  contactTypes: ContactType[];
  directiveModel: DirectiveModel;
};

export type ListLazyViewModel = {
  contactTypes: ContactType[];
  userRoleProperty: ContactProperty;
};

export type ListViewModel = {
  contactTypes: ContactType[];
  userRoleProperty: ContactProperty;
};

export type ManageHierarchyFormContentViewModel = {
  op: string;
  contactType: ContactType;
  data: any;
  
  sourceDescription: string;
  sourceHierarchy: HierarchyConstraint[];
  
  destinationDescription: string;
  destinationHierarchy: HierarchyConstraint[];
  
  isPermanent: boolean;
  success: boolean;
  confirm: boolean;
  warningInfo?: WarningInformation;
  error?: string;
};

export type ManageHierarchyFormViewModel = {
  op: string;
} & ManageHierarchyFormContentViewModel;

