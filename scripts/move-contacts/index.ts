import { queueManager } from '../../shared/queues';
import { Config } from '../../src/config';
import { ChtApi } from '../../src/lib/cht-api';
import ChtSession from '../../src/lib/cht-session';
import MoveLib from '../../src/lib/move';
import SessionCache from '../../src/services/session-cache';

import allPlacesToMove from './nairobi-judy.json';

const username = 'kenn_sippell_medic_user_manager';
const password = '';
const authInfo = Config.getAuthenticationInfo('nairobi.echis.go.ke');
const contactType = Config.getContactType('d_community_health_volunteer_area');
const batchToMove = allPlacesToMove;

(async () => {
  for (const toMove of batchToMove) {
    const [from_SUBCOUNTY, from_CHU, from_replacement_alternate, to_SUBCOUNTY, to_CHU, from_replacement] = toMove as any[];
    const formData = {
      from_SUBCOUNTY,
      from_CHU, 
      from_replacement: from_replacement || from_replacement_alternate,
      to_SUBCOUNTY,
      to_CHU,
    };  
    const session = await ChtSession.create(authInfo, username, password);
    const chtApi = new ChtApi(session);
    const sessionCache = SessionCache.getForSession(session);
    
    try {
      const result = await MoveLib.move(formData, contactType, sessionCache, chtApi, queueManager);
      console.log(JSON.stringify(result));
    } catch (error) {
      console.log(`error: `, error);
    }
  }
})();
