import { PlaceUploadState } from './place';
import SessionCache from './session-cache';

export default class ProgressModel {
  public completeCount: number;
  public stagedCount: number;
  public percent: string;
  public successCount: number;
  public failureCount: number;
  public inProgressCount: number;
  public validationErrorCount: number;
  public totalCount: number;

  constructor(sessionCache: SessionCache) {
    this.successCount = sessionCache.getPlaces({ state: PlaceUploadState.SUCCESS }).length;
    this.failureCount = sessionCache.getPlaces({ state: PlaceUploadState.FAILURE }).length;
    this.validationErrorCount = sessionCache.getPlaces().filter(r => r.hasValidationErrors).length;

    const inProgressStates = [PlaceUploadState.IN_PROGRESS, PlaceUploadState.SCHEDULED];
    this.inProgressCount = sessionCache.getPlaces().filter(r => inProgressStates.includes(r.state)).length;
    this.totalCount = sessionCache.getPlaces().length;
    
    this.completeCount = this.successCount + this.failureCount;
    this.stagedCount = this.totalCount - this.validationErrorCount - this.completeCount;
    const percentage = this.stagedCount > 0 ? this.completeCount / this.totalCount : 0;
    this.percent = Math.round(percentage * 100.0) + '%';
  }
}
