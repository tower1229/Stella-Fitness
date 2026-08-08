export interface NutrientRange {
  min?: number;
  max?: number;
}

export interface DietExtraction {
  schemaVersion: "stella-fitness/diet-extraction/v0.1";
  foods: string[];
  proteinGrams: NutrientRange;
  carbsGrams: NutrientRange;
  confidence: "low" | "medium" | "high";
  uncertainties: string[];
}

export interface DietExtractor {
  /**
   * Image-derived nutrition is an estimate. Implementations must use ranges
   * and uncertainty rather than manufacturing point precision.
   */
  extract(input: {
    imagePath?: string;
    text?: string;
  }): Promise<DietExtraction>;
}
