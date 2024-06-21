import Place from './place';

export type ListPage = {
  page: number;
  pageSize: number;
  totalPlaces: number;
  totalPages: number;
  pagePlaces: Place[];
};

export default class Pagination {
  private page: number;
  private pageSize: number;
  private requestContactTypeName: string | undefined;

  constructor(options: { page: number; pageSize?: number; requestContactTypeName?: string }) {
    this.pageSize = options.pageSize ? options.pageSize : 10;
    this.page = options.page || 1;
    this.requestContactTypeName = options.requestContactTypeName;
  }

  public getPageData(places: Place[], contactTypeName: string): ListPage {
    const selectedPageSize = contactTypeName === this.requestContactTypeName ? this.pageSize : 1;
    let currentPage = contactTypeName === this.requestContactTypeName ? this.page : 1;

    const totalPlaces = places.length;
    const totalPages = Math.ceil(totalPlaces / selectedPageSize);
    currentPage = currentPage > totalPages ? totalPages : currentPage;
    const startIndex = (currentPage - 1) * selectedPageSize;
    const endIndex = startIndex + selectedPageSize;

    places.forEach((place, index) => {
      place.placeNumber = index + 1;
    });

    let pagePlaces = places.slice(startIndex, endIndex);
    if (this.requestContactTypeName){
      pagePlaces = pagePlaces.filter(place => place.type.name === this.requestContactTypeName);
    }
    return {
      page: currentPage,
      pageSize: selectedPageSize,
      totalPlaces,
      totalPages,
      pagePlaces
    };
  }

}
