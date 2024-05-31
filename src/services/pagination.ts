import Place from './place';

export type ListPage = {
  page: number;
  pageSize: number;
  totalPlaces: number;
  totalPages: number;
  pagePlaces: Place[];
};

export default class Pagination {
  private page;
  private pageSize;
  private cookiePageSize;
  private cookieCurrentPage;
  private contactTypeName;
  private clearCookie;

  constructor(options: { page: number; pageSize?: number; cookie: {}; contactTypeName?: string; clearCookie: (n: string) => any }) {
    this.pageSize = options.pageSize ? options.pageSize : 10;
    this.page = options.page;
    this.cookiePageSize = this.getPaginationCookie(options.cookie, 'pageSize');
    this.cookieCurrentPage = this.getPaginationCookie(options.cookie, 'currentPage');
    this.contactTypeName = options.contactTypeName;
    this.clearCookie = options.clearCookie;
  }

  public getPageData(places: Place[], contactTypeName: string): ListPage {
    const selectedPageSize = this.cookiePageSize[contactTypeName] ? parseInt(this.cookiePageSize[contactTypeName], 10) : this.pageSize;
    const currentPage = this.cookieCurrentPage[contactTypeName] ? parseInt(this.cookieCurrentPage[contactTypeName], 10) : 1;
    let selectedPage = this.contactTypeName === contactTypeName ? this.page : currentPage;

    const totalPlaces = places.length;
    const totalPages = Math.ceil(totalPlaces / selectedPageSize);
    selectedPage = totalPages === 1 ? totalPages : selectedPage;
    const startIndex = (selectedPage - 1) * selectedPageSize;
    const endIndex = startIndex + selectedPageSize;

    places.forEach((place, index) => {
      place.placeNumber = index + 1;
    });
    const pagePlaces = places.slice(startIndex, endIndex);
    return {
      page: selectedPage,
      pageSize: selectedPageSize,
      totalPlaces,
      totalPages,
      pagePlaces
    };
  }

  private getPaginationCookie(cookies: {[key: string]: any }, cookieName: string): {[key: string]: any } {
    const result:{[key: string]: any } = {};
    const cookieSubstr = `_${cookieName}`;
    for (const [name, value] of Object.entries(cookies)) {
      if (name.includes(cookieSubstr)) {
        const cookieName = name.substring(0, name.indexOf(cookieSubstr));
        result[cookieName] = value;
      }
    }
    return result;
  }

}
