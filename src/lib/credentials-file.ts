import { Config, ContactType } from '../config';
import SessionCache from '../services/session-cache';
import { stringify } from 'csv/sync';
import { UploadLogRecord } from '../services/upload-log';

type File = {
  filename: string;
  content: string;
};

export function getCredentialsFilesFromLog(records: UploadLogRecord[], contactTypes: ContactType[]): File[] {
  const files: File[] = [];
  for (const contactType of contactTypes) {
    const users = records.filter(r => r.contactType === contactType.name);
    if (users.length <= 0) {
      continue;
    }
    const rows = users.map(record => [
      ...Object.values(record.hierarchy),
      record.place,
      record.person,
      record.phone,
      record.credentials.username,
      record.credentials.password
    ]);
    const content = stringify(rows, {
      header: true,
      columns: [
        ...Object.keys(users[0].hierarchy),
        contactType.friendly,
        'name',
        'phone',
        'username',
        'password',
      ]
    });
    files.push({
      filename: `${contactType.name}.csv`,
      content,
    });
  }
  return files;
}

export default function getCredentialsFiles(sessionCache: SessionCache, contactTypes: ContactType[]): File[] {
  const files: File[] = [];
  for (const contactType of contactTypes) {
    const places = sessionCache.getPlaces({ type: contactType.name });
    if (!places.length) {
      continue;
    }

    const rows = places.map((place) => [
      ...Object.values(place.hierarchyProperties).map(prop => prop.formatted),
      place.name,
      place.contact.properties.name?.formatted,
      place.contact.properties.phone?.formatted,
      place.userRoles.join(' '),
      place.creationDetails.username,
      place.creationDetails.password,
    ]);

    const constraints = Config.getHierarchyWithReplacement(contactType);
    const props = Object.keys(places[0].hierarchyProperties)
      .map(prop => constraints.find(c => c.property_name === prop)!.friendly_name);
    const columns = [
      ...props,
      contactType.friendly,
      'name',
      'phone',
      'role',
      'username',
      'password',
    ];

    const content = stringify(rows, {
      columns,
      header: true,
    });
    files.push({
      filename: `${contactType.name}.csv`,
      content,
    });
  }

  return files;
}
