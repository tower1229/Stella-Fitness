import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StellaFitnessDatabase = DatabaseSync;

/**
 * Uses Node's built-in node:sqlite module so ClawHub/OpenClaw installation does
 * not depend on native npm postinstall scripts.
 */
export function openDatabase(databasePath: string): StellaFitnessDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");

  return database;
}
