
export class PageView {
  public method: string = '';
  public path: string = '';
  public statusCode: number = 0;
}

export const pageViewMetricsData: PageView[] = [];

export function setRequestDataMetrics(req: any, resp: any){
  const metric = new PageView();
  metric.method = req.routeOptions.method;
  metric.path = req.url;
  metric.statusCode = resp.statusCode;
  pageViewMetricsData.push(metric);
}
