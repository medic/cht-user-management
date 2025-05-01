import { ContactType } from '../../config';
import { BulkCreateFormViewModel, CreateFormViewModel, DirectiveViewModel, ListLazyViewModel, ManageHierarchyFormViewModel } from '../place';

type NavViewModel = {
  op: string;
  logo: string;
  contactTypes: ContactType[];
};

type FormSwitchViewModel = {
  op: string;
  contactType: ContactType;
} & (BulkCreateFormViewModel | CreateFormViewModel | ManageHierarchyFormViewModel);

type FragmentHomeViewModel = DirectiveViewModel & ListLazyViewModel;
export type AppViewModel = { 
  view: 'add' | 'edit' | 'list' | 'manage-hierarchy';
} & NavViewModel & (FragmentHomeViewModel | FormSwitchViewModel);
