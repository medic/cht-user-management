import { ContactType } from '../config';
import { ChtApi, UserInfo } from './cht-api';
import { stringify } from 'csv/sync';

export type UserExportRow = {
  username: string;
  fullname: string;
  phone: string;
  roles: string;
  place: string;
};

export type UserExportGroup = {
  contactType: ContactType;
  users: UserExportRow[];
};

export type UserExportData = {
  groups: UserExportGroup[];
  totalCount: number;
};

function getPlaceIds(place: UserInfo['place']): string[] {
  if (!place) {
    return [];
  }
  if (typeof place === 'string') {
    return [place];
  }
  if (Array.isArray(place)) {
    return place.map((p) => (typeof p === 'string' ? p : (p as any)._id)).filter(Boolean);
  }
  if (typeof place === 'object' && '_id' in (place as object)) {
    return [(place as any)._id];
  }
  return [];
}

export async function getUserExportData(
  contactTypes: ContactType[],
  chtApi: ChtApi
): Promise<UserExportData> {
  const [allUsers, ...placesPerType] = await Promise.all([
    chtApi.getAllUsers(),
    ...contactTypes.map((ct) => chtApi.getPlacesWithType(ct.name)),
  ]);

  // Build maps: placeId -> contactTypeName and placeId -> placeName
  const placeToType = new Map<string, string>();
  const placeToName = new Map<string, string>();

  contactTypes.forEach((ct, i) => {
    for (const place of placesPerType[i]) {
      placeToType.set(place._id, ct.name);
      placeToName.set(place._id, place.name || place._id);
    }
  });

  // Group users by contact type based on their assigned place
  const groupMap = new Map<string, UserExportRow[]>(
    contactTypes.map((ct) => [ct.name, []])
  );

  for (const user of allUsers) {
    const placeIds = getPlaceIds(user.place);
    const matchedTypes = new Set(
      placeIds.map((id) => placeToType.get(id)).filter(Boolean) as string[]
    );

    for (const typeName of matchedTypes) {
      const relevantIds = placeIds.filter((id) => placeToType.get(id) === typeName);
      const placeName = relevantIds.map((id) => placeToName.get(id) || id).join(', ');
      groupMap.get(typeName)!.push({
        username: user.username,
        fullname: user.fullname || '',
        phone: user.phone || '',
        roles: (user.roles || []).join(', '),
        place: placeName,
      });
    }
  }

  const groups: UserExportGroup[] = contactTypes
    .map((contactType) => ({
      contactType,
      users: groupMap.get(contactType.name) || [],
    }))
    .filter((g) => g.users.length > 0);

  const totalCount = groups.reduce((sum, g) => sum + g.users.length, 0);

  return { groups, totalCount };
}

export function getUserExportFiles(
  groups: UserExportGroup[]
): { filename: string; content: string }[] {
  return groups.map(({ contactType, users }) => ({
    filename: `${contactType.name}_users.csv`,
    content: stringify(users, {
      header: true,
      columns: [
        { key: 'username', header: 'Username' },
        { key: 'fullname', header: 'Full Name' },
        { key: 'phone', header: 'Phone' },
        { key: 'roles', header: 'Roles' },
        { key: 'place', header: 'Place' },
      ],
    }),
  }));
}
