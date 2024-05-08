import { Config } from '../config';
import JSZip from 'jszip';
import SessionCache from './session-cache';
import { stringify } from 'csv/sync';

export default function createZip(sessionCache: SessionCache): JSZip {
  const zip = new JSZip();
  for (const contactType of Config.contactTypes()) {
    const places = sessionCache.getPlaces({ type: contactType.name });
    if (!places.length) {
      continue;
    }

    const rows = places.map((place) => [
      ...Object.values(place.hierarchyProperties).map(hierarchy => hierarchy.formatted),
      place.name,
      place.contact.properties.name?.formatted,
      place.contact.properties.phone?.formatted,
      place.userRoles.join(' '),
      place.creationDetails.username,
      place.creationDetails.password,
    ]);

    const constraints = Config.getHierarchyWithReplacement(contactType);
    const props = Object.keys(places[0].hierarchyProperties).map(prop => constraints.find(c => c.property_name === prop)!.friendly_name);
    const columns = [
      ...props,
      contactType.friendly,
      'name',
      'phone',
      'role',
      'username',
      'password',
    ];

    zip.file(
      `${contactType.name}.csv`,
      stringify(rows, {
        columns,
        header: true,
      }),
    );
  }

  return zip;
};
