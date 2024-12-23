import { ChtApi, UserInfo } from './cht-api';

export class DisableUsers {
  public static async disableUsersAt(placeId: string, chtApi: ChtApi): Promise<string[]> {
    const affectedUsers = await getAffectedUsers(placeId, chtApi);
    if (affectedUsers.length === 0) {
      console.log('No users found needing an update.');
      return [];
    }

    const usernames = affectedUsers.map(userDoc => userDoc.username).join(', ');
    console.log(`Updating users: ${usernames}`);

    await updateAffectedUsers(affectedUsers, chtApi);

    return affectedUsers.map(user => user.username);
  }

  public static deactivateUsersAt(placeId: string, chtApi: ChtApi): void {
  }
}

async function getAffectedUsers(facilityId: string, chtApi: ChtApi) {
  const toPostApiFormat = (apiResponse: UserInfo) => {
    const places = Array.isArray(apiResponse.place) ? apiResponse.place.filter(Boolean) : [apiResponse.place];
    const placeIds = places.map(place => place?._id);
    return {
      username: apiResponse.username,
      place: placeIds,
    };
  };

  const knownUserDocs: { [key: string]: UserInfo } = {};
  const fetchedUserInfos = await chtApi.getUsersAtPlace(facilityId);
  for (const fetchedUserInfo of fetchedUserInfos) {
    const userDoc = knownUserDocs[fetchedUserInfo.username] || toPostApiFormat(fetchedUserInfo);
    removeUserFromPlace(userDoc, facilityId);
    knownUserDocs[userDoc.username] = userDoc;
  }

  return Object.values(knownUserDocs);
}

async function updateAffectedUsers(affectedUsers: UserInfo[], chtApi: ChtApi) {
  for (const userDoc of affectedUsers) {
    const shouldDisable = !userDoc.place || userDoc.place?.length === 0;
    if (shouldDisable) {
      console.log(`Disabling ${userDoc.username}`);
      await chtApi.disableUser(userDoc.username);
    } else {
      console.log(`Updating ${userDoc.username}`);
      await chtApi.updateUser(userDoc);
    }
  }
}

function removeUserFromPlace(userDoc: UserInfo, placeId: string) {
  if (Array.isArray(userDoc.place)) {
    userDoc.place = userDoc.place.filter(id => id !== placeId);
  } else {
    delete userDoc.place;
  }
}