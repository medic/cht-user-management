import { expect } from 'chai';

import { PlaceUploadState } from '../../src/services/place';
import DirectiveModel from '../../src/services/directive-model';
import SessionCache from '../../src/services/session-cache';

const oneOfEachTypePlace = [
  { id: 'fail', state: PlaceUploadState.FAILURE },
  { id: 'in-progress', state: PlaceUploadState.IN_PROGRESS },
  { id: 'staged', state: PlaceUploadState.STAGED },
  { id: 'scheduled', state: PlaceUploadState.SCHEDULED },
  { id: 'success', state: PlaceUploadState.SUCCESS },
  { id: 'validation-error', state: PlaceUploadState.STAGED, hasValidationErrors: true },
];

describe('services/directive-model.ts', () => {
  it('one place with each state', () => {
    const sessionCache = new SessionCache();
    sessionCache.savePlaces(...oneOfEachTypePlace);

    const progressModel = new DirectiveModel(sessionCache);
    expect(progressModel).to.deep.eq({
      failureCount: 1,
      successCount: 1,
      validationErrorCount: 1,
      completeCount: 2,
      filter: undefined,
      hiddenCount: 0,
      inProgressCount: 2,
      stagedCount: 3,
      totalCount: 6,
      percent: '33%',
    });
  });

  it('success filter yields hidden count', () => {
    const sessionCache = new SessionCache();
    sessionCache.savePlaces(...oneOfEachTypePlace);

    const progressModel = new DirectiveModel(sessionCache, 'success');
    expect(progressModel).to.deep.include({
      filter: 'success',
      hiddenCount: 5,
    });
  });

  it('empty session', () => {
    const sessionCache = new SessionCache();
    const progressModel = new DirectiveModel(sessionCache);
    expect(progressModel).to.deep.eq({
      failureCount: 0,
      successCount: 0,
      validationErrorCount: 0,
      completeCount: 0,
      inProgressCount: 0,
      stagedCount: 0,
      totalCount: 0,
      percent: '0%',
      filter: undefined,
      hiddenCount: 0,
    });
  }); 
});

