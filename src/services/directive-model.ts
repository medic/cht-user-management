import { PlaceUploadState } from './place';
import SessionCache from './session-cache';

const PlaceFilterCookieValues = ['staged', 'invalid', 'success', 'failure', 'warning', undefined] as const;
export type DirectiveFilter = typeof PlaceFilterCookieValues[number]; 

export default class DirectiveModel {
  public readonly completeCount: number;
  public readonly stagedCount: number;
  public readonly percent: string;
  public readonly successCount: number;
  public readonly failureCount: number;
  public readonly inProgressCount: number;
  public readonly validationErrorCount: number;
  public readonly warningCount: number;
  public readonly totalCount: number;
  public readonly hiddenCount: number;

  public readonly filter?: DirectiveFilter;

  constructor(sessionCache: SessionCache, filterCookie?: string) {
    this.successCount = sessionCache.getPlaces({ filter: 'success' }).length;
    this.failureCount = sessionCache.getPlaces({ filter: 'failure' }).length;
    this.validationErrorCount = sessionCache.getPlaces({ filter: 'invalid' }).length;
    this.warningCount = sessionCache.getPlaces({ filter: 'warning' }).length;

    const inProgressStates = [PlaceUploadState.IN_PROGRESS, PlaceUploadState.SCHEDULED];
    this.inProgressCount = sessionCache.getPlaces().filter(r => inProgressStates.includes(r.state)).length;
    this.totalCount = sessionCache.getPlaces().length;
    
    this.completeCount = this.successCount + this.failureCount;
    this.stagedCount = sessionCache.getPlaces({ filter: 'staged' }).length;
    const percentage = this.stagedCount > 0 ? this.completeCount / this.totalCount : 0;
    this.percent = Math.round(percentage * 100.0) + '%';

    this.filter = this.stringToDirectiveFilter(filterCookie);
    this.hiddenCount = this.totalCount - sessionCache.getPlaces({ filter: this.filter }).length;
  }

  private stringToDirectiveFilter(filterString: string | undefined): DirectiveFilter {
    const placeFilter = filterString as DirectiveFilter;
    if (!PlaceFilterCookieValues.includes(placeFilter)) {
      return undefined;
    }
  
    return placeFilter;
  } 
}
