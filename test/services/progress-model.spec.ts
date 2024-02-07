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
      { id: 'pending', state: PlaceUploadState.PENDING },
      { id: 'scheduled', state: PlaceUploadState.SCHEDULED },
      { id: 'success', state: PlaceUploadState.SUCCESS },
      { id: 'validation-error', state: PlaceUploadState.PENDING, hasValidationErrors: true },
    );

    const progressModel = new ProgressModel(sessionCache);
    expect(progressModel).to.deep.eq({
      failureCount: 1,
      successCount: 1,
      remainingCount: 3,
      completeCount: 2,
      pendingCount: 5,
      percent: '40%',
    });
  }); 

  it('empty session', () => {
    const sessionCache = new SessionCache();
    const progressModel = new ProgressModel(sessionCache);
    expect(progressModel).to.deep.eq({
      failureCount: 0,
      successCount: 0,
      completeCount: 0,
      remainingCount: 0,
      pendingCount: 0,
      percent: '0%',
    });
  }); 
});

