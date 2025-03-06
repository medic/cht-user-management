import { Command } from 'commander';

import { AuthenticationInfo, ContactType } from '../../src/config';
import Place from '../../src/services/place';
import RemotePlaceCache, { RemotePlace } from '../../src/lib/remote-place-cache';
import { PropertyValues, UnvalidatedPropertyValue } from '../../src/property-value';
import UserManager from './ke_user_manager.json';
import { UserPayload } from '../../src/services/user-payload';

const { ChtApi } = require('../../src/lib/cht-api'); // require is needed for rewire
const ChtSession = require('../../src/lib/cht-session').default; // require is needed for rewire

const UserManagerContactType: ContactType = UserManager;

type CommandLineArgs = {
  names: string[];
  passwords?: string[];
  county?: string;
  hostname: string;
  adminUsername: string;
  adminPassword: string;
};

export default async function createUserManagers(argv: string[]) {
  const cmdArgs = parseCommandlineArguments(argv);
  const authInfo: AuthenticationInfo = {
    friendly: 'not-useful',
    domain: cmdArgs.hostname,
    useHttp: false,
  };

  const session = await ChtSession.create(authInfo, cmdArgs.adminUsername, cmdArgs.adminPassword);
  const chtApi = new ChtApi(session);
  
  const placeDocId = await getPlaceDocId(cmdArgs.county, chtApi);
  console.log(`Users to be created under ${placeDocId}`);
  const results: Array<UserPayload> = [];
  for (let i = 0; i < cmdArgs.names.length; i++) {
    const username = cmdArgs.names[i];
    const passwordOverride = cmdArgs.passwords?.[i];
    const userPayload = await createUserManager(username, placeDocId, chtApi, cmdArgs.adminUsername, passwordOverride);
    console.log(`username: ${userPayload.username}  password: ${userPayload.password}`);  
    results.push(userPayload);
  }
  
  console.log('===================================================');
  for (const result of results) {
    console.log(`${authInfo.domain}\t${result.username}\t${result.password}`);  
  }
  console.log('===================================================');

  return results;
}

async function createUserManager(username: string, placeDocId: string, chtApi: typeof ChtApi, adminUsername: string, passwordOverride?: string) {
  const place = new Place(UserManagerContactType);
  place.contact.properties.name = new UnvalidatedPropertyValue(`${username} (User Manager)`, 'name');
  place.userRoleProperties.role = new UnvalidatedPropertyValue(UserManagerContactType.user_role.join(' '), 'role');

  const chtPayload = place.asChtPayload(adminUsername);
  chtPayload.contact.role = 'user_manager';
  chtPayload.contact.parent = { _id: placeDocId };

  console.log(`Creating contact with payload ${JSON.stringify(chtPayload.contact)}`);
  const contactDocId = await chtApi.createContact(chtPayload);
  console.log(`Created contact ${contactDocId}`);

  const userPayload = new UserPayload(place, placeDocId, contactDocId);
  if (passwordOverride) {
    userPayload.password = passwordOverride;
  }

  console.log(`Creating user with payload: ${JSON.stringify(userPayload)}`);
  await userPayload.create(chtApi);
  return userPayload;
}

function parseCommandlineArguments(argv: string[]): CommandLineArgs {
  const program = new Command();
  program
    .name('create-user-managers')
    .description('CLI to create User Manager accounts')
    .requiredOption('--names <names...>', 'comma delimited list of names of users to be created')
    .requiredOption('--hostname <hostname>', 'domain on which to create the users')
    .requiredOption('--adminUsername <username>', 'CHT instance admin username')
    .requiredOption('--adminPassword <password>', 'CHT instance admin password')
    .option('--county <name>', 'exact match of the county name for users to manage')
    .option('--passwords <passwords...>', 'comma delimited list of passwords to allow password reuse across instances')
    .parse(argv);

  const cmdArgs = program.opts();
  if (cmdArgs.passwords?.length > 0 && cmdArgs.names.length !== cmdArgs.passwords.length) {
    throw Error(`Provided ${cmdArgs.names.length} users but ${cmdArgs.passwords.length} passwords. There should be an equal count.`);
  }

  return cmdArgs as CommandLineArgs;
}

async function getPlaceDocId(county: string | undefined, chtApi: typeof ChtApi) {
  const counties = await RemotePlaceCache.getRemotePlaces(chtApi, UserManagerContactType, UserManagerContactType.hierarchy[0]);
  const countyMatches = counties.filter((c: RemotePlace) => !county || PropertyValues.isMatch(county, c.name));
  if (countyMatches.length < 1) {
    throw Error(`Could not find county "${county}"`);
  }
  if (countyMatches.length > 1) {
    throw Error(`Found multiple counties. Use the --county option to constrain."`);
  }

  return countyMatches[0].id;
}
