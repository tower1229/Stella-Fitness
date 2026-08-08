export interface ExtractedExerciseSet {
  reps?: number;
  durationSeconds?: number;
}

export interface ExtractedExerciseObservation {
  rawLabel: string;
  normalizedExerciseId?: string;
  loadKg?: number;
  sets?: ExtractedExerciseSet[];
  totalReps?: number;
  confidence: "low" | "medium" | "high";
  uncertainFields: string[];
  notes?: string;
}

export interface TrainingLogExtraction {
  schemaVersion: "stella-fitness/training-log-extraction/v0.1";
  performedAt?: string;
  programWeek?: number;
  programDay?: string;
  exercises: ExtractedExerciseObservation[];
  uncertainFields: string[];
}

export interface TrainingLogExtractor {
  extract(input: {
    imagePath: string;
    supplementalText?: string;
  }): Promise<TrainingLogExtraction>;
}
