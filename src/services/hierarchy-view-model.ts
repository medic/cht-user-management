import _ from 'lodash';
import { Config, ContactType } from '../config';
import ManageHierarchyLib from '../lib/manage-hierarchy';

export function hierarchyViewModel(action: string, contactType: ContactType) {
  const parentTypeName = contactType.hierarchy.find(h => h.level === 1)?.contact_type;
  if (!parentTypeName) {
    throw Error('Parent type name not found in config');
  }

  const sourceHierarchy = Config.getHierarchyWithReplacement(contactType, 'desc');
  sourceHierarchy[sourceHierarchy.length - 1].friendly_name = contactType.friendly;
  const hierarchyAction = ManageHierarchyLib.parseHierarchyAction(action);
  const destinationHierarchy = getDestinationHierarchy();
  const sourceDescription = hierarchyAction === 'move' ? 'Move This Contact' : 'Delete This Contact';
  const destinationDescription = hierarchyAction === 'move' ? 'To Have This Parent' : 'After Moving Data Into';
  
  return {
    sourceDescription,
    destinationDescription,

    sourceHierarchy,
    destinationHierarchy,
  };

  function getDestinationHierarchy() {
    if (hierarchyAction === 'delete') {
      return [];
    }

    if (hierarchyAction === 'merge') {
      return sourceHierarchy;
    }

    return _.orderBy(contactType.hierarchy, 'level', 'desc');
  }
}
