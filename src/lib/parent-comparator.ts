import { ParentDetails } from "./cht-api";

export default class ParentComparator {
  public static readonly NoResult: ParentDetails = { id: "na", type: "dne", name: "Place Not Found" };
  public static readonly Multiple: ParentDetails = { id: 'multiple', name: 'multiple places', type: 'collision' };

  public static areEqual(parentName1: string, parentName2: string) : boolean {
    if (!parentName1 || !parentName2) {
      return false;
    }

    return parentName1 === parentName2;
  }

  public static isParentIdValid(parentId: string | undefined): boolean {
    if (!parentId) {
      return false;
    }

    return ![ParentComparator.Multiple.id, ParentComparator.NoResult.id].includes(parentId);
  }
}
