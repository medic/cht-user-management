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
  constructor(options: { page: number; pageSize: number } ) { 
    this.pageSize = options.pageSize;
    this.page = options.page;
  }

  public getPageData(places: Place[]): ListPage {
    const totalPlaces = places.length;
    const totalPages = Math.ceil(totalPlaces / this.pageSize);
    const startIndex = (this.page - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    
    places.forEach((place, index) => {
      place.placeNumber = index + 1;
    });
    const pagePlaces = places.slice(startIndex, endIndex);
    return {
      page: this.page,
      pageSize: this.pageSize,
      totalPlaces,
      totalPages,
      pagePlaces
    };
  }

}
