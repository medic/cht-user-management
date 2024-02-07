import { PlaceUploadState } from './place';
import SessionCache from './session-cache';

export default class ProgressModel {
  public completeCount: number;
  public pendingCount: number;
  public percent: string;
  public successCount: number;
  public remainingCount: number;
  public failureCount: number;

  constructor(sessionCache: SessionCache) {
    this.successCount = sessionCache.getPlaces({ state: PlaceUploadState.SUCCESS }).length;
    this.failureCount = sessionCache.getPlaces({ state: PlaceUploadState.FAILURE }).length;
    this.completeCount = this.successCount + this.failureCount;
    this.pendingCount = sessionCache.getPlaces().filter(r => !r.hasValidationErrors).length;
    const percentage = this.pendingCount > 0 ? this.completeCount / this.pendingCount : 0;
    this.remainingCount = this.pendingCount - this.completeCount;
    this.percent = Math.round(percentage * 100.0) + '%'
  }
}
