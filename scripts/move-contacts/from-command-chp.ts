import { queueManager } from '../../src/shared/queues';
import { Config } from '../../src/config';
import { ChtApi } from '../../src/lib/cht-api';
import ChtSession from '../../src/lib/cht-session';
import MoveLib from '../../src/lib/move';
import SessionCache from '../../src/services/session-cache';

import allPlacesToMove from './nairobi-ids.json';
import RemotePlaceCache from '../../src/lib/remote-place-cache';

import { config } from 'dotenv';
config();

const { username, password } = process.env;

if (!username || !password) {
  throw 'invalid env';
}

const authInfo = Config.getAuthenticationInfo('nairobi-echis.health.go.ke');
const contactTypeString = 'd_community_health_volunteer_area';
const contactType = Config.getContactType(contactTypeString);
const batchToMove = allPlacesToMove.slice(0, 10000);

(async () => {
  const session = await ChtSession.create(authInfo, username, password);
  const chtApi = new ChtApi(session);
  const sessionCache = SessionCache.getForSession(session);
  
  for (const toMove of batchToMove) {
    const [command, x, movingId, y, toId] = toMove as any[];
    
    const chus = await RemotePlaceCache.getPlacesWithType(chtApi, 'c_community_health_unit');
    const chps = await RemotePlaceCache.getPlacesWithType(chtApi, 'd_community_health_volunteer_area');

    const from_replacement = chps.find(chp => chp.id === movingId);
    const from_CHU = chus.find(chu => chu.id === from_replacement?.lineage[0])?.name;
    const to_CHU = chus.find(chu => toId === chu.id)?.name;

    const formData = {
      from_CHU, 
      from_replacement: from_replacement?.name,
      to_CHU,
    };
    
    
    try {
      const result = await MoveLib.move(formData, contactType, sessionCache, chtApi, queueManager);
      console.log('scheduled', formData.from_replacement);
    } catch (error: any) {
      console.log(`error: `, error?.message || '');
    }
  }
})();
