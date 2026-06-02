import { ChtApi, CouchDoc, UserInfo } from '../lib/cht-api';

export type SetUserFacilitiesResult = {
  username: string;
  facilityIds: string[];
  unassigned: { username: string; remaining: string[] }[];
};

// Sets a CHT user's facilities to exactly `facilityIds` (keyed on username), treating
// facilities as exclusive to a single user: any other user currently holding one of these
// facilities has it removed. A displaced user left with no facilities keeps an empty list
// (they are not disabled) — see /api/v1/set-user-facilities.
export class SetUserFacilities {
  public static async setFacilities(
    username: string,
    facilityIds: string[],
    chtApi: ChtApi,
  ): Promise<SetUserFacilitiesResult> {
    // Capture who currently holds these facilities *before* reassigning, so the target user
    // (once assigned) isn't caught in the unassignment sweep.
    const displaced = await this.getOtherUsersAt(facilityIds, username, chtApi);

    // Assign the requested facilities to the target user. This replaces their facility list.
    await chtApi.updateUser({ username, place: facilityIds });

    // Strip the reassigned facilities from every other user that held them.
    const reassigned = new Set(facilityIds);
    const unassigned: { username: string; remaining: string[] }[] = [];
    for (const user of displaced) {
      const remaining = user.placeIds.filter(id => !reassigned.has(id));
      await chtApi.updateUser({ username: user.username, place: remaining });
      unassigned.push({ username: user.username, remaining });
    }

    return { username, facilityIds, unassigned };
  }

  private static async getOtherUsersAt(
    facilityIds: string[],
    excludeUsername: string,
    chtApi: ChtApi,
  ): Promise<{ username: string; placeIds: string[] }[]> {
    const byUsername = new Map<string, { username: string; placeIds: string[] }>();
    for (const facilityId of facilityIds) {
      const usersAtPlace = await chtApi.getUsersAtPlace(facilityId);
      for (const user of usersAtPlace) {
        // getUsersAtPlace returns each user's full facility list, so the first sighting of a
        // user captures everything we need; skip the target and any user already seen.
        if (user.username === excludeUsername || byUsername.has(user.username)) {
          continue;
        }
        byUsername.set(user.username, {
          username: user.username,
          placeIds: normalizePlaceIds(user.place),
        });
      }
    }
    return [...byUsername.values()];
  }
}

// UserInfo.place comes back from the CHT API in several shapes (CouchDoc[] | CouchDoc |
// string[] | string); normalize it to a flat list of place ids.
function normalizePlaceIds(place: UserInfo['place']): string[] {
  const places = Array.isArray(place) ? place : [place];
  return places
    .map(p => (typeof p === 'string' ? p : (p as CouchDoc)?._id))
    .filter(Boolean) as string[];
}
