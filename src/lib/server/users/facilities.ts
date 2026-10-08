import type { Cht } from '../cht/client';
import { isChtStatus } from '../errors';

// Ported from the previous version's services/set-user-facilities.ts and lib/disable-users.ts: which
// places a CHT account holds, keyed on its username. Served by /api/v1 (set-user-facilities,
// create-user's exclusiveFacilities, disable-users-at).

// An unconfigured role: CHT doesn't check role names against its settings, and a role with no
// permissions takes all access away. Unlike disabling the account, it keeps the account, its password
// and its SSO link, for when it's given places again
export const DISABLED_ROLE = 'disabled';

export type UnassignedFacilityResult = {
  username: string;
  remaining: string[];
  // left with no places, so given the `disabled` role instead of an empty list, which CHT refuses
  disabled?: boolean;
  error?: string;
};

export type SetUserFacilitiesResult = {
  username: string;
  facilityIds: string[];
  unassigned: UnassignedFacilityResult[];
};

type DisplacedUser = { username: string; placeIds: string[] };

export class UserNotFoundError extends Error {
  constructor(readonly username: string) {
    super(`User "${username}" was not found in this eCHIS instance`);
    this.name = 'UserNotFoundError';
  }
}

// Gives the account exactly these places (and these roles, when given), then takes them from every
// other account that held them
export async function setUserFacilities(
  cht: Cht,
  username: string,
  facilityIds: string[],
  roles?: string[]
): Promise<SetUserFacilitiesResult> {
  // who holds the places now, before the account gets them, so it isn't caught in the sweep
  const displaced = await otherUsersAt(cht, facilityIds, username);

  const patch: { place: string[]; roles?: string[] } = { place: facilityIds };
  if (roles?.length && facilityIds.length > 0) {
    patch.roles = roles;
  }
  try {
    await cht.updateUser(username, patch);
  } catch (e) {
    if (isChtStatus(e, 404)) {
      throw new UserNotFoundError(username);
    }
    throw e;
  }

  const unassigned = await stripFacilitiesFrom(cht, displaced, facilityIds);
  return { username, facilityIds, unassigned };
}

// Takes the places from every account but `excludeUsername`
export async function unassignFacilitiesFromOthers(
  cht: Cht,
  facilityIds: string[],
  excludeUsername: string
): Promise<UnassignedFacilityResult[]> {
  const displaced = await otherUsersAt(cht, facilityIds, excludeUsername);
  return stripFacilitiesFrom(cht, displaced, facilityIds);
}

// Each account keeps whatever is left; one left with nothing gets the `disabled` role. Each is tried
// on its own: a failure is recorded on its entry, and the others still go ahead
async function stripFacilitiesFrom(cht: Cht, displaced: DisplacedUser[], facilityIds: string[]): Promise<UnassignedFacilityResult[]> {
  const reassigned = new Set(facilityIds);
  const unassigned: UnassignedFacilityResult[] = [];
  for (const user of displaced) {
    const remaining = user.placeIds.filter((id) => !reassigned.has(id));
    try {
      if (remaining.length === 0) {
        // CHT requires an account to keep at least one place
        await cht.updateUser(user.username, { roles: [DISABLED_ROLE], place: [user.placeIds[0]] });
        unassigned.push({ username: user.username, remaining, disabled: true });
      } else {
        await cht.updateUser(user.username, { place: remaining });
        unassigned.push({ username: user.username, remaining });
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`Failed to unassign facilities from ${user.username}: ${error}`);
      unassigned.push({ username: user.username, remaining, error });
    }
  }
  return unassigned;
}

async function otherUsersAt(cht: Cht, facilityIds: string[], excludeUsername: string): Promise<DisplacedUser[]> {
  const byUsername = new Map<string, DisplacedUser>();
  for (const facilityId of facilityIds) {
    for (const user of await cht.usersAtPlace(facilityId)) {
      // each account comes with all its places, so the first sighting is enough
      if (user.username !== excludeUsername && !byUsername.has(user.username)) {
        byUsername.set(user.username, { username: user.username, placeIds: user.placeIds });
      }
    }
  }
  return [...byUsername.values()];
}

// The accounts at the first place lose these places; one left with none is disabled. Returns the
// accounts changed
export async function disableUsersAt(cht: Cht, placeIds: string[]): Promise<string[]> {
  const users = await cht.usersAtPlace(placeIds[0]);
  for (const user of users) {
    const remaining = user.placeIds.filter((id) => !placeIds.includes(id));
    if (remaining.length) {
      await cht.updateUser(user.username, { place: remaining });
    } else {
      await cht.disableUser(user.username);
    }
  }
  return users.map((user) => user.username);
}
