import { expect } from 'chai';

import { PlaceUploadState } from '../../src/services/place';
import ProgressModel from '../../src/services/progress-model';
import SessionCache from '../../src/services/session-cache';

describe('services/progress-model.ts', () => {
  it('one place with each state', () => {
    const sessionCache = new SessionCache();
    sessionCache.savePlaces(
      { id: 'fail', state: PlaceUploadState.FAILURE },
      { id: 'in-progress', state: PlaceUploadState.IN_PROGRESS },
      { id: 'staged', state: PlaceUploadState.STAGED },
      { id: 'scheduled', state: PlaceUploadState.SCHEDULED },
      { id: 'success', state: PlaceUploadState.SUCCESS },
      { id: 'validation-error', state: PlaceUploadState.STAGED, hasValidationErrors: true },
    );

    const progressModel = new ProgressModel(sessionCache);
    expect(progressModel).to.deep.eq({
      failureCount: 1,
      successCount: 1,
      validationErrorCount: 1,
      completeCount: 2,
      inProgressCount: 2,
      stagedCount: 3,
      totalCount: 6,
      percent: '33%',
    });
  }); 

  it('empty session', () => {
    const sessionCache = new SessionCache();
    const progressModel = new ProgressModel(sessionCache);
    expect(progressModel).to.deep.eq({
      failureCount: 0,
      successCount: 0,
      validationErrorCount: 0,
      completeCount: 0,
      inProgressCount: 0,
      stagedCount: 0,
      totalCount: 0,
      percent: '0%',
    });
  }); 
});

